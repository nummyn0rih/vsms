// acceptance-ux-2: правка акта БЕЗ отката — RBAC, диф ChangeLog, инварианты приёмки.
// Запуск: npx tsx scripts/acceptance-ux-2-verify.ts
//
// Как в settlement-rbac-verify: server-код НЕ трогаем, подменяем только `@/auth`
// (сессия) и `next/cache` (revalidatePath вне Next) resolve-хуками Node. Проверяется
// настоящий saveAct — requireRole, гард статуса машины, транзакция, logChange.
//
// Тестовая БД: данные создаются и удаляются в конце (dev-ветка Neon, данные одноразовые).
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
    if (spec === "next/cache")
      return { url: STUB_CACHE, shortCircuit: true, format: "module" };
    return next(spec, context);
  },
});

const ACTUAL = 5000; // факт обеих позиций
const QTY_PER_KG = 0.00005; // микродоза ингредиента (как аскорбинка, C2)

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
  const { prisma } = await import("../lib/prisma");
  const { saveAct } = await import("../server/acceptance/act");
  const { setActualWeight } = await import("../server/acceptance/actions");
  const { seasonYearOf } = await import("../server/shipments/workdays");

  const W = new Date("2026-07-15T00:00:00Z");
  const season = seasonYearOf(W);
  const stamp = Date.now();
  const created: (() => Promise<unknown>)[] = [];

  try {
    // --- Данные: калибр-культура с рецептурой, машина arrived с ДВУМЯ позициями ---
    const operator = await prisma.user.create({
      data: { login: `ux2-op-${stamp}`, password_hash: "x", role: "operator" },
    });
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: "admin", active: true },
    });
    const tc = await prisma.transportCompany.create({ data: { name: `UX2 TC ${stamp}` } });
    const driver = await prisma.driver.create({
      data: { full_name: "UX2 driver", transport_company_id: tc.id },
    });
    const farmer = await prisma.farmer.create({ data: { name: `UX2 farmer ${stamp}` } });
    const culture = await prisma.culture.create({
      data: { name: `UX2 огурцы ${stamp}`, color: "#2F9E44", acceptance_type: "calibre" },
    });
    const ingredient = await prisma.ingredient.create({
      data: { name: `UX2 аскорбинка ${stamp}`, unit: "kg" },
    });
    const recipe = await prisma.ingredientRecipe.create({
      data: {
        culture_id: culture.id,
        ingredient_id: ingredient.id,
        qty_per_kg_product: String(QTY_PER_KG),
      },
    });
    const scheme = await prisma.calibreScheme.create({ data: { culture_id: culture.id } });
    const rStd = await prisma.calibreRange.create({
      data: { scheme_id: scheme.id, label: "6–9", min_cm: "6", max_cm: "9", is_accepted: true },
    });
    const rNs = await prisma.calibreRange.create({
      data: { scheme_id: scheme.id, label: ">12", min_cm: "12", is_accepted: false },
    });
    const contract = await prisma.contract.create({
      data: { farmer_id: farmer.id, season_year: season },
    });
    const line = await prisma.contractLine.create({
      data: {
        contract_id: contract.id,
        culture_id: culture.id,
        label: "6–9 см",
        volume_tons: "20",
        price_per_kg: "30",
      },
    });
    const shipment = await prisma.shipment.create({
      data: {
        code: `UX2-${stamp}`,
        status: "arrived",
        departure_date: W,
        arrival_date: W,
        driver_id: driver.id,
      },
    });
    const mkItem = () =>
      prisma.shipmentItem.create({
        data: {
          shipment_id: shipment.id,
          farmer_id: farmer.id,
          culture_id: culture.id,
          planned_weight_kg: String(ACTUAL),
          actual_weight_kg: String(ACTUAL),
        },
      });
    const item1 = await mkItem();
    const item2 = await mkItem();

    created.push(
      () =>
        prisma.changeLog.deleteMany({
          where: { entity_id: { in: [item1.id, item2.id] } },
        }),
      () =>
        prisma.changeLog.deleteMany({
          where: { entity: "Shipment", entity_id: shipment.id },
        }),
      () =>
        prisma.stockMovement.deleteMany({
          where: { source_doc_type: "acceptance_act", from_location_id: farmer.id },
        }),
      () =>
        prisma.stockMovement.deleteMany({
          where: { source_doc_type: "acceptance_act", to_location_id: farmer.id },
        }),
      () =>
        prisma.acceptanceAct.deleteMany({
          where: { shipment_item_id: { in: [item1.id, item2.id] } },
        }),
      () =>
        prisma.shipmentItem.deleteMany({ where: { id: { in: [item1.id, item2.id] } } }),
      () => prisma.shipment.delete({ where: { id: shipment.id } }),
      () => prisma.contractLine.deleteMany({ where: { contract_id: contract.id } }),
      () => prisma.contract.delete({ where: { id: contract.id } }),
      () => prisma.calibreRange.deleteMany({ where: { scheme_id: scheme.id } }),
      () => prisma.calibreScheme.delete({ where: { id: scheme.id } }),
      () => prisma.ingredientRecipe.delete({ where: { id: recipe.id } }),
      () => prisma.ingredient.delete({ where: { id: ingredient.id } }),
      () => prisma.culture.delete({ where: { id: culture.id } }),
      () => prisma.farmer.delete({ where: { id: farmer.id } }),
      () => prisma.driver.delete({ where: { id: driver.id } }),
      () => prisma.transportCompany.delete({ where: { id: tc.id } }),
      () => prisma.user.delete({ where: { id: operator.id } }),
    );

    const asUser = (u: { id: number; role: string }) => {
      globalThis.__TEST_USER__ = { id: String(u.id), role: u.role as TestUser["role"] };
    };
    // Базовый акт: 90% принято (6–9 см), 8% нестандарт без строки, 2% брак.
    const actOf = (itemId: number, actNumber: string, std = 90, ns = 8, brak = 2) => ({
      shipmentItemId: itemId,
      actNumber,
      brakPercent: brak,
      calibres: [
        { calibreRangeId: rStd.id, percent: std, contractLineId: line.id },
        { calibreRangeId: rNs.id, percent: ns, contractLineId: null },
      ],
    });
    const statusOf = async () =>
      (
        await prisma.shipment.findUniqueOrThrow({
          where: { id: shipment.id },
          select: { status: true },
        })
      ).status;
    // Нетто расхода ингредиента у фермера: оригинал (to=null) плюс, сторно минус.
    const netIngredient = async () => {
      const rows = await prisma.stockMovement.findMany({
        where: { kind: "ingredient", ingredient_id: ingredient.id },
        select: { quantity: true, from_location_id: true, to_location_id: true },
      });
      return rows.reduce((s, m) => {
        if (m.to_location_id == null && m.from_location_id === farmer.id) {
          return s + m.quantity.toNumber();
        }
        if (m.from_location_id == null && m.to_location_id === farmer.id) {
          return s - m.quantity.toNumber();
        }
        return s;
      }, 0);
    };

    console.log("A. Зона 2: оператор принимает и правит свой акт (флоу не сломан)");
    asUser(operator);

    let res = await saveAct(actOf(item1.id, `UX2-${stamp}-1`));
    check("operator принял позицию 1", res.ok, JSON.stringify(res));
    check("машина осталась arrived (позиция 2 не принята, BR-13)", (await statusOf()) === "arrived");

    res = await saveAct(actOf(item1.id, `UX2-${stamp}-1`, 88, 8, 4));
    check(
      "operator ПЕРЕСОХРАНИЛ акт, пока машина arrived — разрешено",
      res.ok,
      JSON.stringify(res),
    );

    console.log("\nB. Зона 3: машина принята — правка только admin");
    asUser(admin);
    res = await saveAct(actOf(item2.id, `UX2-${stamp}-2`));
    check("admin принял позицию 2", res.ok, JSON.stringify(res));
    check("машина стала accepted (BR-13)", (await statusOf()) === "accepted");

    const actBefore = await prisma.acceptanceAct.findUniqueOrThrow({
      where: { shipment_item_id: item1.id },
      select: { id: true, brak_percent: true },
    });
    const netBefore = await netIngredient();

    asUser(operator);
    res = await saveAct(actOf(item1.id, `UX2-${stamp}-1`, 85, 8, 7));
    check(
      "operator НЕ может править акт принятой машины — серверный отказ",
      !res.ok && res.error === "Правка акта принятой машины — только администратор",
      JSON.stringify(res),
    );
    const brakAfterOp = await prisma.acceptanceAct.findUniqueOrThrow({
      where: { shipment_item_id: item1.id },
      select: { brak_percent: true },
    });
    check(
      "значение в БД не изменилось (брак 4)",
      brakAfterOp.brak_percent?.toString() === "4",
      String(brakAfterOp.brak_percent),
    );

    console.log("\nC. admin правит акт БЕЗ отката");
    asUser(admin);
    res = await saveAct({
      ...actOf(item1.id, `UX2-${stamp}-1r`, 85, 9, 6),
      settlementPercent: 92,
    });
    check("правка принята", res.ok, JSON.stringify(res));
    check("статус машины НЕ изменился (accepted)", (await statusOf()) === "accepted");

    const actAfter = await prisma.acceptanceAct.findUniqueOrThrow({
      where: { shipment_item_id: item1.id },
      select: { id: true, act_number: true, brak_percent: true, settlement_percent: true },
    });
    check("акт тот же (upsert, не пересоздан)", actAfter.id === actBefore.id);
    check(
      "новые значения в БД: № акта, брак, % к оплате",
      actAfter.act_number === `${season}-UX2-${stamp}-1r` &&
        actAfter.brak_percent?.toString() === "6" &&
        actAfter.settlement_percent?.toString() === "92",
      JSON.stringify(actAfter),
    );

    console.log("\nD. Диф в ChangeLog (BR-16, та же транзакция)");
    const log = await prisma.changeLog.findMany({
      where: { entity: "AcceptanceAct", entity_id: item1.id },
      orderBy: { id: "asc" },
      select: { field: true, old_value: true, new_value: true, user_id: true },
    });
    const last = (field: string) => [...log].reverse().find((l) => l.field === field);
    check(
      "act_number: old→new",
      last("act_number")?.old_value === `${season}-UX2-${stamp}-1` &&
        last("act_number")?.new_value === `${season}-UX2-${stamp}-1r`,
      JSON.stringify(last("act_number")),
    );
    check(
      "brak_percent: 4 → 6",
      last("brak_percent")?.old_value === "4" && last("brak_percent")?.new_value === "6",
      JSON.stringify(last("brak_percent")),
    );
    const cal = last("calibres");
    check(
      "calibres: сводка называет обе изменённые категории",
      cal?.new_value != null &&
        cal.new_value.includes("88 %→85 %") &&
        cal.new_value.includes("8 %→9 %"),
      JSON.stringify(cal),
    );
    check(
      "settlement_percent: null → 92",
      last("settlement_percent")?.old_value === null &&
        last("settlement_percent")?.new_value === "92",
      JSON.stringify(last("settlement_percent")),
    );
    check("записи привязаны к admin", last("brak_percent")?.user_id === admin.id);

    console.log("\nE. Инварианты склада и веса");
    check(
      "расход ингредиента не задвоился (нетто-гард)",
      Math.abs((await netIngredient()) - netBefore) < 1e-9,
      `${netBefore} → ${await netIngredient()}`,
    );

    const weightRes = await setActualWeight({
      shipmentItemId: item1.id,
      actualWeightKg: ACTUAL + 100,
    });
    check(
      "вес позиции с актом по-прежнему read-only (гард w5a)",
      !weightRes.ok && weightRes.error.startsWith("Позиция уже принята"),
      JSON.stringify(weightRes),
    );

    console.log("\nF. BR-33 × C3d-2 продолжает работать на правке");
    res = await saveAct({
      ...actOf(item1.id, `UX2-${stamp}-1r`, 85, 9, 6),
      // нестандарт со СВОЕЙ строкой + процент к оплате = двойной счёт
      calibres: [
        { calibreRangeId: rStd.id, percent: 85, contractLineId: line.id },
        { calibreRangeId: rNs.id, percent: 9, contractLineId: line.id },
      ],
      settlementPercent: 92,
    });
    check(
      "нестандарт со строкой + % к оплате отклонён и на правке",
      !res.ok && res.error.includes("оплачивается по строке контракта"),
      JSON.stringify(res),
    );
  } finally {
    globalThis.__TEST_USER__ = null;
    for (const del of created) {
      try {
        await del();
      } catch (e) {
        console.log(`  (уборка) ${(e as Error).message.split("\n")[0]}`);
      }
    }
    console.log(`\nИтого: ${pass} ok, ${fail} fail`);
    await prisma.$disconnect();
  }
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
