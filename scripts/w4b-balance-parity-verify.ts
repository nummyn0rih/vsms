// audit-w4b: сверка эквивалентности агрегации складских балансов.
// Запуск: npx tsx scripts/w4b-balance-parity-verify.ts
//
// Свёртка Σ движений переехала из JS (findMany по всему леджеру + Map) в БД
// (prisma.groupBy + _sum, server/inventory/cells.ts). Баланс кормит решения о деньгах
// и остатках, поэтому «примерно так же» не годится: считаем СТАРОЙ формулой (её копия
// живёт здесь, ниже) и НОВОЙ по одним и тем же данным и сверяем ячейки через
// Prisma.Decimal.equals — не через ==, quantity это Decimal(15,6) с микродозами.
//
// Три модуля подменяются resolve-хуками Node (стабы в scripts/_stubs): `@/auth` — сессия,
// `next/cache` — ревалидация (вне Next её звать нельзя), `@/lib/prisma` — настоящий
// клиент под Proxy-счётчиком (нужен, чтобы проверить ФОРМУ обращений к БД: groupBy
// вместо findMany и «при нуле правил к леджеру не ходим»). Сам server-код не меняется.
//
// Read-only, кроме фазы 4: если в dev-БД нет ни одного AlertRule, скрипт создаёт пару
// временных и удаляет их в finally (dev-ветка Neon, данные одноразовые — CLAUDE.md).
import "dotenv/config";
import nodeModule from "node:module";
import { pathToFileURL } from "node:url";
// Сгенерированный клиент стабами НЕ подменяется (нужен только тип Decimal и его
// конструктор), поэтому его можно тянуть статически — до регистрации хуков.
import { Prisma } from "../lib/generated/prisma/client";

// registerHooks — Node 22.15+/24; в @types/node ^20 его ещё нет, отсюда локальный тип.
type ResolveResult = { url: string; shortCircuit?: boolean; format?: string };
type ResolveHook = (
  spec: string,
  context: unknown,
  next: (spec: string, context: unknown) => ResolveResult,
) => ResolveResult;
const registerHooks = (
  nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void }
).registerHooks;

type TestUser = { id: string; role: "admin" | "operator" | "user" };
declare global {
  var __TEST_USER__: TestUser | null;
}
globalThis.__TEST_USER__ = { id: "1", role: "admin" };

const stub = (name: string) =>
  pathToFileURL(new URL(`_stubs/${name}`, import.meta.url).pathname).href;
const STUB_AUTH = stub("auth.ts");
const STUB_CACHE = stub("next-cache.ts");
const STUB_PRISMA = stub("prisma-spy.ts");

registerHooks({
  resolve(spec, context, next) {
    if (spec === "@/auth") return { url: STUB_AUTH, shortCircuit: true, format: "module" };
    if (spec === "next/cache")
      return { url: STUB_CACHE, shortCircuit: true, format: "module" };
    if (spec === "@/lib/prisma")
      return { url: STUB_PRISMA, shortCircuit: true, format: "module" };
    return next(spec, context);
  },
});

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  // Динамические импорты — после регистрации хуков.
  const { prisma, spyCalls, spyCount, spyReset, spyForceEmpty } = await import(
    "./_stubs/prisma-spy"
  );
  const { aggregateStockCells } = await import("../server/inventory/cells");
  const { getTareBalances, getIngredientBalances } = await import(
    "../server/inventory/balances"
  );
  const { getActiveAlerts, computePackagingAlerts, computeIngredientAlerts } =
    await import("../server/alert-rules/alerts");
  const { listAlertRules } = await import("../server/alert-rules/actions");

  const ZERO = () => new Prisma.Decimal(0);
  type Cells = Map<string, Prisma.Decimal>;

  // ===== СТАРАЯ формула (копия свёртки из balances.ts до audit-w4b) =====
  async function oldPackagingFold(): Promise<Cells> {
    const movements = await prisma.stockMovement.findMany({
      where: { kind: "packaging" },
      select: {
        packaging_type_id: true,
        quantity: true,
        from_location_id: true,
        to_location_id: true,
        from_state: true,
        to_state: true,
      },
    });
    const balances: Cells = new Map();
    const add = (
      loc: number | null,
      type: number | null,
      state: "good" | "scrap" | null,
      delta: Prisma.Decimal,
    ) => {
      if (loc == null || type == null || state == null) return;
      const k = `${loc}:${type}:${state}`;
      balances.set(k, (balances.get(k) ?? ZERO()).plus(delta));
    };
    for (const m of movements) {
      add(m.to_location_id, m.packaging_type_id, m.to_state, m.quantity);
      add(m.from_location_id, m.packaging_type_id, m.from_state, m.quantity.neg());
    }
    return balances;
  }

  async function oldIngredientFold(): Promise<Cells> {
    const movements = await prisma.stockMovement.findMany({
      where: { kind: "ingredient" },
      select: {
        ingredient_id: true,
        quantity: true,
        from_location_id: true,
        to_location_id: true,
      },
    });
    const balances: Cells = new Map();
    const add = (loc: number | null, ing: number | null, delta: Prisma.Decimal) => {
      if (loc == null || ing == null) return;
      const k = `${loc}:${ing}`;
      balances.set(k, (balances.get(k) ?? ZERO()).plus(delta));
    };
    for (const m of movements) {
      add(m.to_location_id, m.ingredient_id, m.quantity);
      add(m.from_location_id, m.ingredient_id, m.quantity.neg());
    }
    return balances;
  }

  // Сверка покомпонентно по ОБЪЕДИНЕНИЮ ключей: ячейка, потерянная одной из формул,
  // тоже расхождение (сравнивается с нулём).
  function diff(oldM: Cells, newM: Cells) {
    const keys = [...new Set([...oldM.keys(), ...newM.keys()])].sort();
    const mismatches: string[] = [];
    for (const k of keys) {
      const a = oldM.get(k) ?? ZERO();
      const b = newM.get(k) ?? ZERO();
      if (!a.equals(b)) mismatches.push(`${k}: старое ${a.toFixed()} ≠ новое ${b.toFixed()}`);
    }
    return { compared: keys.length, mismatches };
  }

  function report(label: string, r: { compared: number; mismatches: string[] }) {
    console.log(
      `  ${label}: сверено ячеек ${r.compared}, расхождений ${r.mismatches.length}`,
    );
    for (const m of r.mismatches.slice(0, 10)) console.log(`      ${m}`);
    check(`${label}: 0 расхождений`, r.mismatches.length === 0);
    check(`${label}: сверялось не вхолостую (ячеек > 0)`, r.compared > 0);
  }

  const createdRuleIds: number[] = [];

  try {
    // ===== 0. Куда подключились =====
    console.log("=== 0. Подключение ===");
    const dbUrl = new URL(process.env.DATABASE_URL ?? "postgresql://none/none");
    const dbName = dbUrl.pathname.replace(/^\//, "");
    console.log(`  host=${dbUrl.hostname} db=${dbName}`);
    check(
      "рабочая dev-база, не остаточная shadow",
      !dbName.startsWith("prisma_migrate_shadow_db"),
      `db=${dbName}`,
    );
    const ledgerRows = await prisma.stockMovement.count();
    console.log(`  StockMovement: ${ledgerRows} строк`);
    if (ledgerRows === 0) {
      throw new Error("В StockMovement нет строк — сверка была бы бессмысленной");
    }

    // ===== 1. Parity самой агрегации (Decimal ↔ Decimal) =====
    console.log("\n=== 1. aggregateStockCells vs старая JS-свёртка ===");
    const [oldPack, newPack, oldIng, newIng] = await Promise.all([
      oldPackagingFold(),
      aggregateStockCells("packaging"),
      oldIngredientFold(),
      aggregateStockCells("ingredient"),
    ]);
    report("тара (loc:type:state)", diff(oldPack, newPack));
    report("ингредиенты (loc:ing)", diff(oldIng, newIng));

    // ===== 2. End-to-end: витрины отдают те же ячейки =====
    console.log("\n=== 2. getTareBalances / getIngredientBalances ===");
    const [tareBal, ingBal] = await Promise.all([
      getTareBalances(),
      getIngredientBalances(),
    ]);

    const tareFromView: Cells = new Map(
      tareBal.cells.map((c) => [
        `${c.locationId}:${c.packagingTypeId}:${c.state}`,
        new Prisma.Decimal(c.quantity),
      ]),
    );
    const oldPackNonZero: Cells = new Map(
      [...oldPack].filter(([, v]) => !v.isZero()),
    );
    report("витрина тары", diff(oldPackNonZero, tareFromView));

    const ingFromView: Cells = new Map(
      ingBal.cells.map((c) => [
        `${c.locationId}:${c.ingredientId}`,
        new Prisma.Decimal(c.quantity),
      ]),
    );
    const oldIngNonZero: Cells = new Map([...oldIng].filter(([, v]) => !v.isZero()));
    report("витрина ингредиентов", diff(oldIngNonZero, ingFromView));

    // Деактивированные позиции не должны выпадать из колонок.
    const ledgerTypeIds = new Set(
      [...oldPack.keys()].map((k) => Number(k.split(":")[1])),
    );
    const viewTypeIds = new Set(tareBal.types.map((t) => t.id));
    check(
      "все типы тары из леджера присутствуют в колонках (в т.ч. неактивные)",
      [...ledgerTypeIds].every((id) => viewTypeIds.has(id)),
      `нет: ${[...ledgerTypeIds].filter((id) => !viewTypeIds.has(id)).join(", ")}`,
    );
    const ledgerIngIds = new Set([...oldIng.keys()].map((k) => Number(k.split(":")[1])));
    const viewIngIds = new Set(ingBal.columns.map((c) => c.id));
    check(
      "все ингредиенты из леджера присутствуют в колонках",
      [...ledgerIngIds].every((id) => viewIngIds.has(id)),
      `нет: ${[...ledgerIngIds].filter((id) => !viewIngIds.has(id)).join(", ")}`,
    );

    // Порядок ячеек детерминирован (карточка поставщика рендерит их «как пришли»).
    const sortedTare = [...tareBal.cells].sort(
      (a, b) =>
        a.locationId - b.locationId ||
        a.packagingTypeId - b.packagingTypeId ||
        a.state.localeCompare(b.state),
    );
    check(
      "cells тары отдаются в детерминированном порядке",
      JSON.stringify(sortedTare) === JSON.stringify(tareBal.cells),
    );

    // Фермеры с ненулевым балансом не потерялись из locations.
    const farmerLocs = new Set(
      tareBal.locations.filter((l) => l.kind === "farmer").map((l) => l.id),
    );
    const farmersWithBalance = new Set(
      tareBal.cells.filter((c) => c.locationId > 0).map((c) => c.locationId),
    );
    check(
      "фермеры с остатком присутствуют в locations (в т.ч. архивные)",
      [...farmersWithBalance].every((id) => farmerLocs.has(id)),
      `нет: ${[...farmersWithBalance].filter((id) => !farmerLocs.has(id)).join(", ")}`,
    );

    // ===== 3. Гард алертов: нет правил → к леджеру не ходим =====
    console.log("\n=== 3. getActiveAlerts при НУЛЕ правил ===");
    spyReset();
    spyForceEmpty("alertRule", "findMany", true);
    const zero = await getActiveAlerts().finally(() =>
      spyForceEmpty("alertRule", "findMany", false),
    );
    check(
      "нулевой результат нужной формы",
      zero.total === 0 &&
        zero.tareCount === 0 &&
        zero.ingredientCount === 0 &&
        zero.tare.length === 0 &&
        zero.ingredient.length === 0,
    );
    check(
      "к StockMovement не обращались ни разу",
      spyCount("stockMovement") === 0,
      `вызовы: ${spyCalls().join(", ") || "—"}`,
    );
    const guardOps = [...new Set(spyCalls())].join(", ") || "—";
    console.log(`  всего запросов на этой ветке: ${spyCalls().length} (${guardOps})`);

    // ===== 4. С правилами: форма запросов + сужение не меняет смысла =====
    console.log("\n=== 4. getActiveAlerts при НАЛИЧИИ правил ===");
    let rules = await listAlertRules();
    console.log(`  правил в БД: ${rules.length}`);

    async function addTempRule(
      kind: "packaging" | "ingredient",
      itemId: number,
      scope: number | null,
      threshold: number,
    ) {
      const r = await prisma.alertRule.create({
        data: {
          item_kind: kind,
          item_id: itemId,
          location_scope: scope,
          threshold: new Prisma.Decimal(threshold),
        },
        select: { id: true },
      });
      createdRuleIds.push(r.id);
    }

    // Сверка «сужение не изменило смысла» имеет силу только на НЕПУСТЫХ списках, а
    // dev-данные могут не давать дефицита. Чего не хватает — доливаем временными
    // правилами. Обязательно и с location_scope=фермер, и с null: второй случай
    // разворачивается по фермерам, «у которых есть ячейка», и именно его легко
    // сломать сужением выборки.
    const anchorTare = tareBal.cells.find((c) => c.locationId > 0 && c.state === "good");
    const anchorIng = ingBal.cells.find((c) => c.locationId > 0);
    if (computePackagingAlerts(rules, tareBal).length === 0) {
      if (!anchorTare) throw new Error("Нет ячеек тары у фермеров — правило не на что вешать");
      await addTempRule(
        "packaging",
        anchorTare.packagingTypeId,
        anchorTare.locationId,
        anchorTare.quantity + 1000,
      );
      await addTempRule(
        "packaging",
        anchorTare.packagingTypeId,
        null,
        anchorTare.quantity + 1000,
      );
    }
    if (computeIngredientAlerts(rules, ingBal).length === 0) {
      if (!anchorIng) throw new Error("Нет ячеек ингредиентов у фермеров");
      await addTempRule("ingredient", anchorIng.ingredientId, null, anchorIng.quantity + 1000);
    }
    if (createdRuleIds.length > 0) {
      console.log(`  добавлено временных правил: ${createdRuleIds.length}`);
      rules = await listAlertRules();
    }

    spyReset();
    const narrowed = await getActiveAlerts();
    const ledgerCalls = spyCalls().filter((c) => c.startsWith("stockMovement."));
    console.log(`  обращения к леджеру: ${ledgerCalls.join(", ") || "—"}`);
    check(
      "Σ движений считает groupBy",
      spyCount("stockMovement", "groupBy") > 0,
      `groupBy: ${spyCount("stockMovement", "groupBy")}`,
    );
    check(
      "findMany по всему леджеру больше не выполняется",
      spyCount("stockMovement", "findMany") === 0,
      `findMany: ${spyCount("stockMovement", "findMany")}`,
    );

    // Сужение по item_id обязано дать тот же ответ, что полные балансы.
    const [fullTare, fullIng] = await Promise.all([
      getTareBalances(),
      getIngredientBalances(),
    ]);
    const expectedTare = computePackagingAlerts(rules, fullTare);
    const expectedIng = computeIngredientAlerts(rules, fullIng);
    check(
      `дефицит тары совпал с расчётом на полном балансе (${expectedTare.length} шт.)`,
      JSON.stringify(narrowed.tare) === JSON.stringify(expectedTare),
      `сужено ${JSON.stringify(narrowed.tare)} / полно ${JSON.stringify(expectedTare)}`,
    );
    check(
      `дефицит ингредиентов совпал с расчётом на полном балансе (${expectedIng.length} шт.)`,
      JSON.stringify(narrowed.ingredient) === JSON.stringify(expectedIng),
      `сужено ${JSON.stringify(narrowed.ingredient)} / полно ${JSON.stringify(expectedIng)}`,
    );
    check(
      "сверялось не вхолостую: дефицит есть и по таре, и по ингредиентам",
      expectedTare.length > 0 && expectedIng.length > 0,
      `тара ${expectedTare.length}, ингредиенты ${expectedIng.length}`,
    );
  } finally {
    if (createdRuleIds.length > 0) {
      await prisma.alertRule.deleteMany({ where: { id: { in: createdRuleIds } } });
      console.log(`\n  временные правила удалены: ${createdRuleIds.length}`);
    }
    await prisma.$disconnect();
  }

  console.log(`\n${fail === 0 ? "✓" : "✗"} Итог: ${pass} пройдено, ${fail} провалено`);
  if (fail > 0) process.exitCode = 1;
}

main();
