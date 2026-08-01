// ingredients-factory-source: сверка витрины ингредиентов после того, как завод стал
// внешним безлимитным источником.
// Запуск: npx tsx scripts/ingredients-factory-source-verify.ts
//
// Проверяем на РЕАЛЬНЫХ данных dev-ветки: завода нет в витрине, «забрано со склада»
// сходится с леджером, а сводка пары (поставщик × ингредиент) сходится с ячейкой
// баланса по тождеству. Сравнения через Prisma.Decimal.equals — не через ==,
// quantity это Decimal(15,6) с микродозами (аскорбинка ~0,00005).
//
// Read-only полностью: ничего не создаём и не удаляем. Фаза 6 — не проверка, а отчёт
// по историческим данным (opening завода, AlertRule на заводе), которые задача
// осознанно НЕ удаляет, а только перестаёт показывать.
//
// Стабы (scripts/_stubs) подменяются resolve-хуками Node: `@/auth` — сессия,
// `next/cache` — ревалидация (вне Next её звать нельзя). Сам server-код не меняется.
import "dotenv/config";
import dns from "node:dns";
import nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
// Сгенерированный клиент стабами НЕ подменяется (нужен тип Decimal и конструктор).
import { Prisma, PrismaClient } from "../lib/generated/prisma/client";

dns.setDefaultResultOrder("ipv4first");

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

registerHooks({
  resolve(spec, context, next) {
    if (spec === "@/auth") return { url: STUB_AUTH, shortCircuit: true, format: "module" };
    if (spec === "next/cache")
      return { url: STUB_CACHE, shortCircuit: true, format: "module" };
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

const FACTORY = 0;
const TRANSIT_TO_FARMER = -2;
const TRANSFER_TRANSIT = -3;

async function main() {
  // Prisma 7 — клиент без нативного движка, обязателен driver adapter (как lib/prisma).
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const { aggregateStockCells, aggregateFactoryOutflow } = await import(
    "../server/inventory/cells"
  );
  const {
    getIngredientBalances,
    getIngredientMovements,
    getIngredientFactoryOutflow,
  } = await import("../server/inventory/balances");
  const { summarizeIngredientLedger } = await import(
    "../server/inventory/ingredient-ledger"
  );
  const { computeIngredientAlerts } = await import("../server/alert-rules/alerts");
  const { listAlertRules } = await import("../server/alert-rules/actions");
  const { getOpeningBalances } = await import("../server/inventory/opening");

  const ZERO = () => new Prisma.Decimal(0);

  try {
    // ===== 1. Завод исключён из витрины, транзит остался =====
    console.log("\n1. Витрина /ingredients: завод исключён, транзит на месте");
    const data = await getIngredientBalances();

    check(
      "локации не содержат завод (id=0)",
      !data.locations.some((l) => l.id === FACTORY),
      `locations: ${data.locations.map((l) => `${l.id}:${l.name}`).join(", ")}`,
    );
    check(
      "ячейки не содержат завод (id=0)",
      !data.cells.some((c) => c.locationId === FACTORY),
      `${data.cells.filter((c) => c.locationId === FACTORY).length} ячеек завода просочилось`,
    );
    check(
      "kind=\"factory\" в локациях отсутствует",
      !data.locations.some((l) => (l.kind as string) === "factory"),
    );

    const rawCells = await aggregateStockCells("ingredient");
    const factoryCells = [...rawCells].filter(
      ([k, v]) => Number(k.split(":")[0]) === FACTORY && !v.isZero(),
    );
    console.log(
      `     (в леджере завод по-прежнему есть: ${factoryCells.length} ненулевых ячеек — данные не тронуты)`,
    );

    const transitRow = data.locations.find((l) => l.id === TRANSIT_TO_FARMER);
    check("строка «В пути с завода» (−2) присутствует", transitRow != null);
    const hasTransferLedger = [...rawCells].some(
      ([k, v]) => Number(k.split(":")[0]) === TRANSFER_TRANSIT && !v.isZero(),
    );
    check(
      "строка «В пути между фермерами» (−3) — по наличию переносов",
      hasTransferLedger === data.locations.some((l) => l.id === TRANSFER_TRANSIT),
    );

    // «Итого у поставщиков» = Σ по отдаваемым локациям (фермеры + транзит), без завода.
    for (const col of data.columns) {
      const uiTotal = data.locations.reduce((sum, l) => {
        const cell = data.cells.find(
          (c) => c.locationId === l.id && c.ingredientId === col.id,
        );
        return sum + (cell?.quantity ?? 0);
      }, 0);
      let ledgerTotal = ZERO();
      for (const [k, v] of rawCells) {
        const [loc, ing] = k.split(":").map(Number);
        if (ing !== col.id || loc === FACTORY) continue;
        ledgerTotal = ledgerTotal.plus(v);
      }
      // Матрица суммирует колонку в JS (number) и печатает с maximumFractionDigits: 6,
      // поэтому сверяем на точности показа: Σ float даёт хвосты вида 472.85000000000036,
      // которые до экрана не доходят. Точность самой агрегации проверяет фаза 3 (Decimal).
      check(
        `«Итого у поставщиков» ${col.name} = Σ леджера без завода (${ledgerTotal.toString()})`,
        ledgerTotal.toDecimalPlaces(6).equals(
          new Prisma.Decimal(uiTotal.toFixed(6)),
        ),
        `UI ${uiTotal} ≠ леджер ${ledgerTotal.toString()}`,
      );
    }

    // ===== 2. «Забрано со склада за сезон» =====
    console.log("\n2. KPI «Забрано со склада за сезон»");
    const outflow = await getIngredientFactoryOutflow();
    console.log(`     сезон ${outflow.seasonYear}/${outflow.seasonYear + 1}`);

    // Независимый пересчёт: нетто плеча отправки с завода, границы сезона в FACTORY_TZ.
    const { zonedDayRange } = await import("../server/changelog/labels");
    const range = zonedDayRange(
      `${outflow.seasonYear}-06-01`,
      `${outflow.seasonYear + 1}-05-31`,
    );
    const rawSent = await prisma.stockMovement.findMany({
      where: {
        kind: "ingredient",
        movement_type: "delivery",
        date: range,
        OR: [{ from_location_id: FACTORY }, { to_location_id: FACTORY }],
      },
      select: {
        ingredient_id: true,
        quantity: true,
        from_location_id: true,
        to_location_id: true,
      },
    });
    const expected = new Map<number, Prisma.Decimal>();
    for (const m of rawSent) {
      if (m.ingredient_id == null) continue;
      const cur = expected.get(m.ingredient_id) ?? ZERO();
      // Ушло с завода — плюс; сторно отправки (−2 → 0) — минус.
      expected.set(
        m.ingredient_id,
        m.from_location_id === FACTORY ? cur.plus(m.quantity) : cur.minus(m.quantity),
      );
    }

    const ingNames = new Map(
      (await prisma.ingredient.findMany({ select: { id: true, name: true, unit: true } })).map(
        (i) => [i.id, `${i.name} (${i.unit === "l" ? "л" : "кг"})`],
      ),
    );
    const actual = new Map(
      outflow.byIngredient.map((r) => [r.ingredientId, new Prisma.Decimal(r.quantity)]),
    );
    const allIds = new Set([...expected.keys(), ...actual.keys()]);
    if (allIds.size === 0) {
      console.log("     (доставок ингредиентов за сезон нет — сверять нечего)");
    }
    for (const id of allIds) {
      const exp = expected.get(id) ?? ZERO();
      const act = actual.get(id) ?? ZERO();
      check(
        `забрано ${ingNames.get(id) ?? `#${id}`}: ${act.toString()}`,
        exp.equals(act),
        `SQL ${exp.toString()} ≠ витрина ${act.toString()}`,
      );
    }

    // groupBy-агрегат без границ дат = за всё время (для сверки порядка величин).
    const allTime = await aggregateFactoryOutflow();
    for (const [id, qty] of allTime) {
      console.log(
        `     за всё время: ${ingNames.get(id) ?? `#${id}`} = ${qty.toString()}`,
      );
    }

    // ===== 3. Сводка пары (поставщик × ингредиент) =====
    console.log("\n3. Сводка леджера: начало + поступило + перенос − расход = остаток");
    const pairs: { loc: number; ing: number }[] = [];
    for (const [k, v] of rawCells) {
      const [loc, ing] = k.split(":").map(Number);
      if (loc <= 0) continue; // только поставщики
      if (v.isZero()) continue;
      pairs.push({ loc, ing });
    }
    if (pairs.length === 0) console.log("     (ненулевых пар нет)");

    const farmerNames = new Map(
      (await prisma.farmer.findMany({ select: { id: true, name: true } })).map((f) => [
        f.id,
        f.name,
      ]),
    );
    for (const { loc, ing } of pairs) {
      const { totals } = await getIngredientMovements(loc, ing);
      const cell = rawCells.get(`${loc}:${ing}`) ?? ZERO();
      const sum =
        totals.openingQty + totals.receivedQty + totals.transferNet + totals.otherNet -
        totals.consumedQty;
      const label = `${farmerNames.get(loc) ?? `#${loc}`} × ${ingNames.get(ing) ?? `#${ing}`}`;
      console.log(
        `     ${label}: начало ${totals.openingQty} + поступило ${totals.receivedQty}` +
          (totals.transferNet !== 0 ? ` + перенос ${totals.transferNet}` : "") +
          (totals.otherNet !== 0 ? ` + прочее ${totals.otherNet}` : "") +
          ` − расход ${totals.consumedQty} = ${sum} (остаток ${cell.toString()})`,
      );
      check(
        `тождество сводки: ${label}`,
        cell.equals(new Prisma.Decimal(totals.balance.toString())) &&
          Math.abs(sum - totals.balance) < 1e-9,
        `сводка ${sum} / balance ${totals.balance} ≠ ячейка ${cell.toString()}`,
      );
    }

    // ===== 4. Микродозы не схлопываются =====
    console.log("\n4. Микродозы (Decimal(15,6))");
    // Самые мелкие ненулевые движения в БД: дробная часть обязана дожить до витрины.
    const micro = await prisma.stockMovement.findMany({
      where: { kind: "ingredient", quantity: { gt: 0, lt: new Prisma.Decimal("1") } },
      select: { id: true, quantity: true, ingredient_id: true, from_location_id: true },
      orderBy: { quantity: "asc" },
      take: 5,
    });
    if (micro.length === 0) {
      console.log("     (дробных движений < 1 в БД нет — покрыто юнит-тестами ядра)");
    }
    for (const m of micro) {
      const pairTotals =
        m.from_location_id != null && m.from_location_id > 0 && m.ingredient_id != null
          ? (await getIngredientMovements(m.from_location_id, m.ingredient_id)).totals
          : null;
      console.log(
        `     движение #${m.id} = ${m.quantity.toString()} ` +
          `(${ingNames.get(m.ingredient_id ?? -1) ?? "?"})` +
          (pairTotals ? ` → расход пары ${pairTotals.consumedQty}` : ""),
      );
      check(
        `дробная величина #${m.id} (${m.quantity.toString()}) не схлопнулась в 0`,
        pairTotals == null || pairTotals.consumedQty !== 0,
        `расход пары = ${pairTotals?.consumedQty}`,
      );
    }
    // Свёртка ядра на настоящей микродозе аскорбинки (в dev-БД таких движений нет).
    const microSummary = summarizeIngredientLedger(
      [
        {
          from_location_id: TRANSIT_TO_FARMER,
          to_location_id: 42,
          movement_type: "delivery",
          quantity: new Prisma.Decimal("0.001"),
        },
        {
          from_location_id: 42,
          to_location_id: null,
          movement_type: "consumption",
          quantity: new Prisma.Decimal("0.00005"),
        },
      ],
      42,
    );
    check(
      "микродоза 0,00005 (аскорбинка) не схлопывается в расходе",
      microSummary.consumedQty.equals(new Prisma.Decimal("0.00005")),
      microSummary.consumedQty.toString(),
    );

    // ===== 5. Откат доставки уменьшает «поступило» по НЕТТО =====
    console.log("\n5. Нетто откатов (на чистом ядре, без записи в БД)");
    const D = (v: string) => new Prisma.Decimal(v);
    const F = 42;
    const delivered = {
      from_location_id: TRANSIT_TO_FARMER,
      to_location_id: F,
      movement_type: "delivery" as const,
      quantity: D("12"),
    };
    const reverted = {
      from_location_id: F,
      to_location_id: TRANSIT_TO_FARMER,
      movement_type: "delivery" as const,
      quantity: D("12"),
    };
    const afterRevert = summarizeIngredientLedger([delivered, reverted], F);
    const afterRedeliver = summarizeIngredientLedger(
      [delivered, reverted, delivered],
      F,
    );
    check(
      "откат доставки обнуляет «поступило»",
      afterRevert.receivedQty.isZero(),
      afterRevert.receivedQty.toString(),
    );
    check(
      "повторная доставка после отката снова даёт 12 (нетто, не «по существованию»)",
      afterRedeliver.receivedQty.equals(D("12")),
      afterRedeliver.receivedQty.toString(),
    );

    // ===== 6. Отчёт по историческим данным (ничего не удаляем) =====
    console.log("\n6. Отчёт: исторические данные, которые скрыты, но сохранены");
    const factoryOpening = await prisma.stockMovement.findMany({
      where: { kind: "ingredient", movement_type: "opening", to_location_id: FACTORY },
      select: { id: true, ingredient_id: true, quantity: true },
    });
    console.log(
      `     opening завода по ингредиентам: ${factoryOpening.length} движ.` +
        (factoryOpening.length > 0
          ? ` → ${factoryOpening
              .map(
                (m) =>
                  `${ingNames.get(m.ingredient_id ?? -1) ?? `#${m.ingredient_id}`} ${m.quantity.toString()}`,
              )
              .join(", ")}`
          : ""),
    );
    console.log("     (не удалены — только скрыты в /settings/opening-stock)");

    const opening = await getOpeningBalances("ingredient");
    check(
      "в /settings/opening-stock (ингредиенты) строки «Завод» нет",
      !opening.locations.some((l) => l.isFactory),
    );
    const openingTare = await getOpeningBalances("packaging");
    check(
      "в /settings/opening-stock (тара) строка «Завод» ОСТАЛАСЬ",
      openingTare.locations.some((l) => l.isFactory),
    );

    const factoryRules = await prisma.alertRule.findMany({
      where: { location_scope: FACTORY },
      select: { id: true, item_kind: true, item_id: true, threshold: true },
    });
    console.log(
      `     AlertRule с location_scope=0 (завод): ${factoryRules.length}` +
        (factoryRules.length > 0
          ? ` → ${factoryRules.map((r) => `#${r.id} ${r.item_kind} item=${r.item_id} порог=${r.threshold}`).join(", ")}`
          : ""),
    );
    if (factoryRules.length > 0) {
      const rows = await listAlertRules();
      const shown = rows.filter((r) => r.location_scope === FACTORY);
      console.log(
        `     показываются как: ${shown.map((r) => `«${r.location_name}»`).join(", ")}`,
      );
      check(
        "правило на заводе больше не рисуется как «#0»",
        shown.every((r) => r.location_name === "Завод"),
      );
    }

    // ===== 7. Сквозной инвариант: KPI и матрица согласованы =====
    // Σ остатков у поставщиков (включая транзит) = Σ opening поставщиков
    //   + забрано со склада (за всё время) − Σ расхода в производство.
    // Переносы между поставщиками в сумме по всем локациям взаимно гасятся, поэтому
    // в тождество не входят. Это и есть ответ на «сходится ли KPI с леджером».
    console.log("\n7. Сквозной инвариант витрины: поставщики = opening + забрано − расход");
    const farmerOpening = await prisma.stockMovement.groupBy({
      by: ["ingredient_id"],
      where: {
        kind: "ingredient",
        movement_type: "opening",
        to_location_id: { gt: 0 },
      },
      _sum: { quantity: true },
    });
    const openingByIng = new Map(
      farmerOpening.map((r) => [r.ingredient_id!, r._sum.quantity ?? ZERO()]),
    );
    const consumptionRows = await prisma.stockMovement.findMany({
      where: { kind: "ingredient", movement_type: "consumption" },
      select: { ingredient_id: true, quantity: true, to_location_id: true },
    });
    const consumedByIng = new Map<number, Prisma.Decimal>();
    for (const m of consumptionRows) {
      if (m.ingredient_id == null) continue;
      const cur = consumedByIng.get(m.ingredient_id) ?? ZERO();
      // Оригинал: to=null (расход) — плюс; сторно: to=фермер — минус.
      consumedByIng.set(
        m.ingredient_id,
        m.to_location_id == null ? cur.plus(m.quantity) : cur.minus(m.quantity),
      );
    }
    for (const col of data.columns) {
      let atFarmers = ZERO();
      for (const [k, v] of rawCells) {
        const [loc, ing] = k.split(":").map(Number);
        if (ing !== col.id || loc === FACTORY) continue;
        atFarmers = atFarmers.plus(v);
      }
      const op = openingByIng.get(col.id) ?? ZERO();
      const taken = allTime.get(col.id) ?? ZERO();
      const cons = consumedByIng.get(col.id) ?? ZERO();
      const expectedTotal = op.plus(taken).minus(cons);
      console.log(
        `     ${col.name}: opening ${op} + забрано ${taken} − расход ${cons} = ${expectedTotal} (витрина ${atFarmers})`,
      );
      check(
        `${col.name}: «Итого у поставщиков» сходится с KPI и расходом`,
        expectedTotal.equals(atFarmers),
        `расчёт ${expectedTotal.toString()} ≠ витрина ${atFarmers.toString()}`,
      );
    }

    // Алерты не сломались от исчезновения завода из витрины.
    const rules = await listAlertRules();
    const alerts = computeIngredientAlerts(rules, data);
    check(
      "computeIngredientAlerts отрабатывает на витрине без завода",
      Array.isArray(alerts),
      `${alerts.length} строк дефицита`,
    );
    console.log(`     активных строк дефицита по ингредиентам: ${alerts.length}`);
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} pass=${pass} fail=${fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
