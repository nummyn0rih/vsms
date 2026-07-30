// w5a-weight-edit-FIX: вес позиции С АКТОМ — read-only (правка только через откат).
// Запуск: npx tsx scripts/w5a-weight-edit-verify.ts
//
//   W1 — позиция БЕЗ акта: ввод и правка веса работают как раньше (BR-25 не ослаблен).
//   W2 — приёмка: расход ингредиентов списан по фактическому весу.
//   W3 — правка веса при существующем акте отклоняется СЕРВЕРОМ, вес в БД не меняется.
//   W4 — очистка веса (null) при акте отклоняется тем же текстом.
//   W5 — пересохранение акта БЕЗ смены веса (брак/settlement) продолжает работать.
//   W6 — полный цикл: откат → правка веса → повторная приёмка → расход по НОВОМУ весу.
//
// Server Actions требуют сессию (requireRole) и Next-контекст (revalidatePath), поэтому
// подменяем ДВА модуля через loader-хуки Node: `@/auth` и `next/cache` (тот же приём, что
// в scripts/w5a-verify.ts). Сам server-код НЕ трогаем: выполняется настоящая логика
// setActualWeight/saveAct/revertAct, включая RBAC, транзакцию и ChangeLog.
//
// Сценарий проходит через несколько независимых транзакций, поэтому не заворачивается в
// один rolled-back $transaction: данные создаются реально и удаляются в finally
// (dev-ветка Neon, данные одноразовые — правило проекта).
import "dotenv/config";
import nodeModule from "node:module";
import { pathToFileURL } from "node:url";

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
globalThis.__TEST_USER__ = null;

const STUB_AUTH = pathToFileURL(new URL("_stubs/auth.ts", import.meta.url).pathname).href;
const STUB_CACHE = pathToFileURL(
  new URL("_stubs/next-cache.ts", import.meta.url).pathname,
).href;

registerHooks({
  resolve(spec, context, next) {
    if (spec === "@/auth") return { url: STUB_AUTH, shortCircuit: true, format: "module" };
    if (spec === "next/cache") return { url: STUB_CACHE, shortCircuit: true, format: "module" };
    return next(spec, context);
  },
});

const W_FIRST = 6850; // первая перевеска
const W_SECOND = 7000; // правка ДО приёмки — должна проходить
const W_BLOCKED = 6000; // попытка правки ПОСЛЕ приёмки — должна отклоняться
const W_AFTER_REVERT = 5000; // правка после отката — должна проходить
const BRAK = 1.4;
// Микродоза ингредиента — проверяет Decimal(15,6) и ROUND_HALF_UP до 6 знаков.
const QTY_PER_KG = "0.000500"; // 7000 × 0,0005 = 3,5 · 5000 × 0,0005 = 2,5

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
  const { prisma } = await import("../lib/prisma");
  const { Prisma } = await import("../lib/generated/prisma/client");
  const { setActualWeight } = await import("../server/acceptance/actions");
  const { saveAct, revertAct } = await import("../server/acceptance/act");
  const { seasonYearOf } = await import("../server/shipments/workdays");

  // Гард подключения: работаем против рабочей dev-БД, а не пустой/чужой.
  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "StockMovement"
  `;
  console.log(`БД: StockMovement = ${count} движ.`);
  if (Number(count) <= 0) {
    throw new Error("StockMovement пуст — это не рабочая dev-БД, выходим");
  }

  const W = new Date("2026-07-15T00:00:00Z");
  const season = seasonYearOf(W);
  const cleanup: (() => Promise<unknown>)[] = [];

  try {
    // ------------------------------------------------------------------ seed
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: "admin", active: true },
    });
    const tc = await prisma.transportCompany.create({ data: { name: "WE TC" } });
    const driver = await prisma.driver.create({
      data: { full_name: "WE driver", transport_company_id: tc.id },
    });
    const farmer = await prisma.farmer.create({ data: { name: "WE farmer" } });
    // simple-культура: приёмка одной строкой, % брака — достаточно для сценария.
    const culture = await prisma.culture.create({
      data: { name: "WE томаты", color: "#E03131", acceptance_type: "simple" },
    });
    const ingredient = await prisma.ingredient.create({
      data: { name: "WE аскорбинка", unit: "kg" },
    });
    const recipe = await prisma.ingredientRecipe.create({
      data: {
        culture_id: culture.id,
        ingredient_id: ingredient.id,
        qty_per_kg_product: QTY_PER_KG,
      },
    });
    const contract = await prisma.contract.create({
      data: { farmer_id: farmer.id, season_year: season },
    });
    const line = await prisma.contractLine.create({
      data: {
        contract_id: contract.id,
        culture_id: culture.id,
        label: "томаты",
        volume_tons: "20",
        price_per_kg: "25",
      },
    });
    const shipment = await prisma.shipment.create({
      data: {
        code: `WE-${Date.now()}`,
        status: "arrived",
        departure_date: W,
        arrival_date: W,
        driver_id: driver.id,
      },
    });
    const item = await prisma.shipmentItem.create({
      data: {
        shipment_id: shipment.id,
        farmer_id: farmer.id,
        culture_id: culture.id,
        planned_weight_kg: String(W_FIRST),
      },
    });

    cleanup.push(
      () =>
        prisma.changeLog.deleteMany({
          where: { entity: "AcceptanceAct", entity_id: item.id },
        }),
      () =>
        prisma.changeLog.deleteMany({
          where: { entity: "ShipmentItem", entity_id: item.id },
        }),
      () => prisma.changeLog.deleteMany({ where: { entity: "Shipment", entity_id: shipment.id } }),
      () =>
        prisma.stockMovement.deleteMany({
          where: { kind: "ingredient", ingredient_id: ingredient.id },
        }),
      () => prisma.acceptanceAct.deleteMany({ where: { shipment_item_id: item.id } }),
      () => prisma.shipmentItem.deleteMany({ where: { shipment_id: shipment.id } }),
      () => prisma.shipment.delete({ where: { id: shipment.id } }),
      () => prisma.contractLine.deleteMany({ where: { contract_id: contract.id } }),
      () => prisma.contract.delete({ where: { id: contract.id } }),
      () => prisma.ingredientRecipe.delete({ where: { id: recipe.id } }),
      () => prisma.ingredient.delete({ where: { id: ingredient.id } }),
      () => prisma.culture.delete({ where: { id: culture.id } }),
      () => prisma.farmer.delete({ where: { id: farmer.id } }),
      () => prisma.driver.delete({ where: { id: driver.id } }),
      () => prisma.transportCompany.delete({ where: { id: tc.id } }),
    );

    globalThis.__TEST_USER__ = { id: String(admin.id), role: "admin" };

    const actInput = (extra: Record<string, unknown> = {}) => ({
      shipmentItemId: item.id,
      actNumber: `WE-${item.id}`,
      brakPercent: BRAK,
      contractLineId: line.id,
      ...extra,
    });

    const weightOf = async () =>
      (
        await prisma.shipmentItem.findUniqueOrThrow({
          where: { id: item.id },
          select: { actual_weight_kg: true },
        })
      ).actual_weight_kg;
    const actIdOf = async () =>
      (
        await prisma.acceptanceAct.findUnique({
          where: { shipment_item_id: item.id },
          select: { id: true },
        })
      )?.id ?? null;
    const weightLogCount = async () =>
      prisma.changeLog.count({
        where: { entity: "ShipmentItem", entity_id: item.id, field: "actual_weight_kg" },
      });
    // Нетто группы движений акта по ключу ingredient×фермер (та же свёртка, что в гарде
    // saveAct и в сторно revertActItemWithin): оригинал (to=null) плюс, сторно минус.
    const groupState = async (actId: number) => {
      const ms = await prisma.stockMovement.findMany({
        where: { source_doc_type: "acceptance_act", source_doc_id: actId, kind: "ingredient" },
      });
      let net = new Prisma.Decimal(0);
      for (const m of ms) {
        if (m.ingredient_id !== ingredient.id) continue;
        net = m.to_location_id == null ? net.plus(m.quantity) : net.minus(m.quantity);
      }
      return { net, rows: ms.length };
    };

    const LOCKED = "Откатите приёмку позиции";

    // ============================================ W1. до приёмки — регресса нет
    console.log("\nW1. Позиция БЕЗ акта — ввод и правка веса (BR-25 не ослаблен)");

    let res = await setActualWeight({ shipmentItemId: item.id, actualWeightKg: W_FIRST });
    check(`W1 первая перевеска ${W_FIRST} кг`, res.ok, JSON.stringify(res));
    check(`W1 вес в БД = ${W_FIRST}`, (await weightOf())?.toNumber() === W_FIRST);

    res = await setActualWeight({ shipmentItemId: item.id, actualWeightKg: W_SECOND });
    check(`W1 правка на ${W_SECOND} кг до приёмки`, res.ok, JSON.stringify(res));
    check(`W1 вес в БД = ${W_SECOND}`, (await weightOf())?.toNumber() === W_SECOND);

    // ============================================ W2. приёмка
    console.log("\nW2. Приёмка — расход ингредиентов по фактическому весу");
    console.log(`   рецептура ${QTY_PER_KG} на 1 кг · факт ${W_SECOND} кг → ожидаем 3.5`);

    res = await saveAct(actInput());
    check("W2 акт сохранён", res.ok, JSON.stringify(res));
    const actId = (await actIdOf())!;
    let g = await groupState(actId);
    console.log(`     нетто=${g.net} · движений=${g.rows}`);
    check("W2 расход списан: нетто 3.5, 1 движение", g.net.equals("3.5") && g.rows === 1);

    // ============================================ W3. правка веса при акте
    console.log("\nW3. Правка веса при существующем акте — отказ сервера");
    const logBefore = await weightLogCount();

    res = await setActualWeight({ shipmentItemId: item.id, actualWeightKg: W_BLOCKED });
    check("W3 правка отклонена", !res.ok, JSON.stringify(res));
    const msg = !res.ok ? (res.error ?? "") : "";
    console.log(`     текст: ${msg}`);
    check("W3 текст называет выход из ситуации", msg.includes(LOCKED), msg);
    check(`W3 вес в БД не изменился (${W_SECOND})`, (await weightOf())?.toNumber() === W_SECOND);
    check("W3 ChangeLog не вырос", (await weightLogCount()) === logBefore);
    g = await groupState(actId);
    check("W3 расход не тронут: нетто 3.5, 1 движение", g.net.equals("3.5") && g.rows === 1);

    // ============================================ W4. очистка веса при акте
    console.log("\nW4. Очистка веса (null) при акте — тот же отказ");

    res = await setActualWeight({ shipmentItemId: item.id, actualWeightKg: null });
    check("W4 очистка отклонена", !res.ok, JSON.stringify(res));
    check("W4 тот же текст", !res.ok && (res.error ?? "").includes(LOCKED), !res.ok ? res.error : "");
    check(`W4 вес на месте (${W_SECOND})`, (await weightOf())?.toNumber() === W_SECOND);

    // ============================================ W5. пересохранение акта
    console.log("\nW5. Пересохранение акта БЕЗ смены веса — работает");

    res = await saveAct(actInput({ brakPercent: 3.2, settlementPercent: 98 }));
    check("W5 акт пересохранён (брак 3.2% + settlement 98%)", res.ok, JSON.stringify(res));
    const saved = await prisma.acceptanceAct.findUniqueOrThrow({
      where: { shipment_item_id: item.id },
      select: { brak_percent: true, settlement_percent: true },
    });
    check(
      "W5 новые значения в БД",
      saved.brak_percent?.equals("3.2") === true &&
        saved.settlement_percent?.equals("98") === true,
      `brak=${saved.brak_percent} settlement=${saved.settlement_percent}`,
    );
    g = await groupState(actId);
    console.log(`     нетто=${g.net} · движений=${g.rows}`);
    check("W5 расход не продублирован: нетто 3.5, 1 движение", g.net.equals("3.5") && g.rows === 1);

    // ============================================ W6. полный цикл
    console.log("\nW6. Цикл: откат → правка веса → повторная приёмка");

    res = await revertAct({ shipmentItemId: item.id });
    check("W6 откат приёмки", res.ok, JSON.stringify(res));
    g = await groupState(actId);
    console.log(`     после отката: нетто=${g.net} · движений=${g.rows} (оригинал не удаляется)`);
    check("W6 нетто-сторно обнулило группу", g.net.isZero() && g.rows === 2);
    check("W6 акт удалён", (await actIdOf()) === null);

    res = await setActualWeight({ shipmentItemId: item.id, actualWeightKg: W_AFTER_REVERT });
    check(`W6 правка веса после отката (${W_AFTER_REVERT} кг)`, res.ok, JSON.stringify(res));
    check(`W6 вес в БД = ${W_AFTER_REVERT}`, (await weightOf())?.toNumber() === W_AFTER_REVERT);

    res = await saveAct(actInput());
    check("W6 повторная приёмка", res.ok, JSON.stringify(res));
    const actId2 = (await actIdOf())!;
    g = await groupState(actId2);
    console.log(`     новый акт #${actId2}: нетто=${g.net} · движений=${g.rows} (ожидаем 2.5)`);
    check(
      `W6 расход пересчитан по НОВОМУ весу (${W_AFTER_REVERT} × ${QTY_PER_KG} = 2.5)`,
      g.net.equals("2.5") && g.rows === 1,
    );

    await revertAct({ shipmentItemId: item.id });
  } finally {
    globalThis.__TEST_USER__ = null;
    for (const fn of cleanup) {
      try {
        await fn();
      } catch (e) {
        console.log(`  ! уборка: ${(e as Error).message}`);
      }
    }
    await prisma.$disconnect();
  }

  console.log(`\nИтог: ${pass} ✓ / ${fail} ✗`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
