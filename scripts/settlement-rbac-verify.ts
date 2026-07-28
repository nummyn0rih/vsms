// settlement-adjustment: проверка saveAct/revertAct «как из приложения» (BR-33).
// Запуск: npx tsx scripts/settlement-rbac-verify.ts
//
// Server Actions требуют сессию (requireRole) и Next-контекст (revalidatePath), поэтому
// подменяем ДВА модуля через loader-хуки Node: `@/auth` (сессия текущего пользователя)
// и `next/cache` (ревалидация — вне Next её звать нельзя). Сам server-код НЕ трогаем:
// проверяется настоящая логика saveAct, включая RBAC и ChangeLog в транзакции.
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

// Подменяем два модуля на стабы (scripts/_stubs) — resolve-хуком, ДО динамических
// импортов ниже. Сам server-код не меняется: saveAct/revertAct выполняются целиком,
// включая requireRole, валидацию, транзакцию и logChange.
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

const ACTUAL = 6850;
const P_69 = 53.7;
const P_912 = 34.5;
const P_NS = 10.4;
const BRAK = 1.4;

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
  // Динамический импорт — после регистрации хуков.
  const { prisma } = await import("../lib/prisma");
  const { saveAct, revertAct, getActContext } = await import("../server/acceptance/act");
  const { seasonYearOf } = await import("../server/shipments/workdays");

  const W = new Date("2026-07-15T00:00:00Z");
  const season = seasonYearOf(W);
  const created: (() => Promise<unknown>)[] = [];

  try {
    // --- Данные сценария ---
    const operator = await prisma.user.create({
      data: { login: `set-verify-op-${Date.now()}`, password_hash: "x", role: "operator" },
    });
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "admin", active: true } });
    const tc = await prisma.transportCompany.create({ data: { name: "SET-RBAC TC" } });
    const driver = await prisma.driver.create({
      data: { full_name: "SET-RBAC driver", transport_company_id: tc.id },
    });
    const farmer = await prisma.farmer.create({ data: { name: "SET-RBAC farmer" } });
    const culture = await prisma.culture.create({
      data: { name: "SET-RBAC огурцы", color: "#2F9E44", acceptance_type: "calibre" },
    });
    const scheme = await prisma.calibreScheme.create({ data: { culture_id: culture.id } });
    const r69 = await prisma.calibreRange.create({
      data: { scheme_id: scheme.id, label: "6–9", min_cm: "6", max_cm: "9", is_accepted: true },
    });
    const r912 = await prisma.calibreRange.create({
      data: { scheme_id: scheme.id, label: "9–12", min_cm: "9", max_cm: "12", is_accepted: true },
    });
    const rNs = await prisma.calibreRange.create({
      data: { scheme_id: scheme.id, label: ">12", min_cm: "12", is_accepted: false },
    });
    const contract = await prisma.contract.create({
      data: { farmer_id: farmer.id, season_year: season },
    });
    const line69 = await prisma.contractLine.create({
      data: {
        contract_id: contract.id,
        culture_id: culture.id,
        label: "6–9 см",
        volume_tons: "10",
        price_per_kg: "30",
      },
    });
    const line912 = await prisma.contractLine.create({
      data: {
        contract_id: contract.id,
        culture_id: culture.id,
        label: "9–12 см",
        volume_tons: "10",
        price_per_kg: "20",
      },
    });
    const shipment = await prisma.shipment.create({
      data: {
        code: `SET-RBAC-${Date.now()}`,
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
        planned_weight_kg: String(ACTUAL),
        actual_weight_kg: String(ACTUAL),
      },
    });

    // Уборка (в обратном порядке зависимостей).
    created.push(
      () => prisma.changeLog.deleteMany({ where: { entity: "AcceptanceAct", entity_id: item.id } }),
      () => prisma.changeLog.deleteMany({ where: { entity: "ShipmentItem", entity_id: item.id } }),
      () => prisma.changeLog.deleteMany({ where: { entity: "Shipment", entity_id: shipment.id } }),
      () => prisma.stockMovement.deleteMany({ where: { source_doc_type: "acceptance_act" , from_location_id: farmer.id } }),
      () => prisma.acceptanceAct.deleteMany({ where: { shipment_item_id: item.id } }),
      () => prisma.shipmentItem.delete({ where: { id: item.id } }),
      () => prisma.shipment.delete({ where: { id: shipment.id } }),
      () => prisma.contractLine.deleteMany({ where: { contract_id: contract.id } }),
      () => prisma.contract.delete({ where: { id: contract.id } }),
      () => prisma.calibreRange.deleteMany({ where: { scheme_id: scheme.id } }),
      () => prisma.calibreScheme.delete({ where: { id: scheme.id } }),
      () => prisma.culture.delete({ where: { id: culture.id } }),
      () => prisma.farmer.delete({ where: { id: farmer.id } }),
      () => prisma.driver.delete({ where: { id: driver.id } }),
      () => prisma.transportCompany.delete({ where: { id: tc.id } }),
      () => prisma.user.delete({ where: { id: operator.id } }),
    );

    const calibres = [
      { calibreRangeId: r69.id, percent: P_69, contractLineId: line69.id },
      { calibreRangeId: r912.id, percent: P_912, contractLineId: line912.id },
      { calibreRangeId: rNs.id, percent: P_NS, contractLineId: null },
    ];
    const base = {
      shipmentItemId: item.id,
      actNumber: `SET-RBAC-${item.id}`,
      brakPercent: BRAK,
      calibres,
    };
    const asUser = (u: { id: number; role: string }) => {
      globalThis.__TEST_USER__ = { id: String(u.id), role: u.role as TestUser["role"] };
    };

    console.log("A. Валидация границ (BR-33: принятый% ≤ settlement ≤ 100)");
    asUser(admin);

    let res = await saveAct({ ...base, settlementPercent: 80 });
    check(
      "80% при принятом 88,2% отклонён с человеческим текстом",
      !res.ok && res.error === "Процент к оплате не может быть ниже принятого (88,2%)",
      JSON.stringify(res),
    );

    res = await saveAct({ ...base, settlementPercent: 101 });
    const fieldErr = !res.ok ? JSON.stringify(res.fieldErrors ?? {}) : "";
    check(
      "101% отклонён (потолок 100)",
      !res.ok && fieldErr.includes("Процент к оплате не может превышать 100"),
      JSON.stringify(res),
    );

    res = await saveAct({ ...base, settlementPercent: 97 });
    check("97% принят (admin)", res.ok, JSON.stringify(res));

    let act = await prisma.acceptanceAct.findUnique({
      where: { shipment_item_id: item.id },
      select: { settlement_percent: true },
    });
    check(
      "в БД записано settlement_percent = 97.00",
      act?.settlement_percent?.toString() === "97",
      String(act?.settlement_percent),
    );

    console.log("\nB. ChangeLog (строкой в БД, в той же транзакции)");
    let log = await prisma.changeLog.findMany({
      where: { entity: "AcceptanceAct", entity_id: item.id, field: "settlement_percent" },
      orderBy: { id: "asc" },
      select: { old_value: true, new_value: true, user_id: true },
    });
    check(
      "запись о правке: old=null → new=97",
      log.length === 1 && log[0].old_value === null && log[0].new_value === "97",
      JSON.stringify(log),
    );
    check("запись привязана к пользователю", log[0]?.user_id === admin.id);

    console.log("\nC. RBAC (operator)");
    asUser(operator);

    res = await saveAct({ ...base, settlementPercent: 90 });
    check(
      "operator НЕ может изменить процент — серверный отказ",
      !res.ok && res.error === "Изменять процент к оплате может только администратор (BR-33)",
      JSON.stringify(res),
    );
    act = await prisma.acceptanceAct.findUnique({
      where: { shipment_item_id: item.id },
      select: { settlement_percent: true },
    });
    check("значение в БД не изменилось (осталось 97)", act?.settlement_percent?.toString() === "97");

    res = await saveAct(base); // без поля — как шлёт форма оператора
    check("operator сохраняет акт без поля — успешно", res.ok, JSON.stringify(res));
    act = await prisma.acceptanceAct.findUnique({
      where: { shipment_item_id: item.id },
      select: { settlement_percent: true },
    });
    check(
      "корректировка админа НЕ затёрта сохранением оператора",
      act?.settlement_percent?.toString() === "97",
      String(act?.settlement_percent),
    );

    res = await saveAct({ ...base, settlementPercent: 97 }); // то же значение
    check("operator может переслать НЕизменённое значение (не отказ)", res.ok, JSON.stringify(res));

    console.log("\nD. Снятие корректировки и откат приёмки");
    asUser(admin);

    res = await saveAct({ ...base, settlementPercent: null });
    check("admin снимает корректировку (null)", res.ok, JSON.stringify(res));
    act = await prisma.acceptanceAct.findUnique({
      where: { shipment_item_id: item.id },
      select: { settlement_percent: true },
    });
    check("в БД снова null", act?.settlement_percent === null);
    log = await prisma.changeLog.findMany({
      where: { entity: "AcceptanceAct", entity_id: item.id, field: "settlement_percent" },
      orderBy: { id: "asc" },
      select: { old_value: true, new_value: true, user_id: true },
    });
    check(
      "в ChangeLog вторая запись: old=97 → new=null",
      log.length === 2 && log[1].old_value === "97" && log[1].new_value === null,
      JSON.stringify(log),
    );

    // Возвращаем корректировку — проверяем, что откат уносит её вместе с актом.
    await saveAct({ ...base, settlementPercent: 97 });
    const revert = await revertAct({ shipmentItemId: item.id });
    check("откат приёмки выполнен", revert.ok, JSON.stringify(revert));
    act = await prisma.acceptanceAct.findUnique({ where: { shipment_item_id: item.id } });
    check("акт удалён вместе с корректировкой", act === null);

    const ctx = await getActContext({ shipmentItemId: item.id });
    check(
      "повторная приёмка начинается с пустого поля (existing = null)",
      ctx != null && ctx.existing === null,
      JSON.stringify(ctx?.existing),
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
