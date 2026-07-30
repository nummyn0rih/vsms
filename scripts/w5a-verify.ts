// audit-w5a: проверка трёх правок приёмки «как из приложения».
// Запуск: npx tsx scripts/w5a-verify.ts
//
//   A. П-11 — нетто-гард расхода ингредиентов (правило 7 CLAUDE.md, урок materials-fix).
//   B. П-9  — гонка авто-accepted (FOR UPDATE + идемпотентный пересчёт BR-13).
//   C. Гард BR-33 × C3d-2 — запрет «нестандарт со строкой + процент к оплате».
//
// Server Actions требуют сессию (requireRole) и Next-контекст (revalidatePath), поэтому
// подменяем ДВА модуля через loader-хуки Node: `@/auth` и `next/cache` (см.
// scripts/settlement-rbac-verify.ts — тот же приём). Сам server-код НЕ трогаем:
// выполняется настоящая логика saveAct/revertAct, включая RBAC, транзакцию и ChangeLog.
//
// Гонку в B моделируем ДВУМЯ параллельными saveAct — это разные транзакции, поэтому
// сценарий нельзя завернуть в один rolled-back $transaction: данные создаются реально
// и удаляются в finally (dev-ветка Neon, данные одноразовые — правило проекта).
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

// Эталон BR-33: огурцы, факт 6850 кг, 6–9 см 53,7% · 9–12 см 34,5% (принятые),
// >12 нестандарт 10,4%, брак 1,4%.
const ACTUAL = 6850;
const P_69 = 53.7;
const P_912 = 34.5;
const P_NS = 10.4;
const BRAK = 1.4;
// Микродоза ингредиента — проверяет Decimal(15,6) и ROUND_HALF_UP до 6 знаков.
const QTY_PER_KG = "0.000500"; // 6850 × 0,0005 = 3,425

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
    const operator = await prisma.user.create({
      data: { login: `w5a-op-${Date.now()}`, password_hash: "x", role: "operator" },
    });
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "admin", active: true } });
    const tc = await prisma.transportCompany.create({ data: { name: "W5A TC" } });
    const driver = await prisma.driver.create({
      data: { full_name: "W5A driver", transport_company_id: tc.id },
    });
    const farmer = await prisma.farmer.create({ data: { name: "W5A farmer" } });
    const culture = await prisma.culture.create({
      data: { name: "W5A огурцы", color: "#2F9E44", acceptance_type: "calibre" },
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
    const ingredient = await prisma.ingredient.create({
      data: { name: "W5A аскорбинка", unit: "kg" },
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
        code: `W5A-${Date.now()}`,
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

    cleanup.push(
      () =>
        prisma.changeLog.deleteMany({
          where: { entity: "AcceptanceAct", entity_id: { in: [item1.id, item2.id] } },
        }),
      () =>
        prisma.changeLog.deleteMany({
          where: { entity: "ShipmentItem", entity_id: { in: [item1.id, item2.id] } },
        }),
      () => prisma.changeLog.deleteMany({ where: { entity: "Shipment", entity_id: shipment.id } }),
      () =>
        prisma.stockMovement.deleteMany({
          where: { kind: "ingredient", ingredient_id: ingredient.id },
        }),
      () =>
        prisma.acceptanceAct.deleteMany({
          where: { shipment_item_id: { in: [item1.id, item2.id] } },
        }),
      () => prisma.shipmentItem.deleteMany({ where: { shipment_id: shipment.id } }),
      () => prisma.shipment.delete({ where: { id: shipment.id } }),
      () => prisma.contractLine.deleteMany({ where: { contract_id: contract.id } }),
      () => prisma.contract.delete({ where: { id: contract.id } }),
      () => prisma.ingredientRecipe.delete({ where: { id: recipe.id } }),
      () => prisma.ingredient.delete({ where: { id: ingredient.id } }),
      () => prisma.calibreRange.deleteMany({ where: { scheme_id: scheme.id } }),
      () => prisma.calibreScheme.delete({ where: { id: scheme.id } }),
      () => prisma.culture.delete({ where: { id: culture.id } }),
      () => prisma.farmer.delete({ where: { id: farmer.id } }),
      () => prisma.driver.delete({ where: { id: driver.id } }),
      () => prisma.transportCompany.delete({ where: { id: tc.id } }),
      () => prisma.user.delete({ where: { id: operator.id } }),
    );

    const asUser = (u: { id: number; role: string }) => {
      globalThis.__TEST_USER__ = { id: String(u.id), role: u.role as TestUser["role"] };
    };
    const calibresOk = [
      { calibreRangeId: r69.id, percent: P_69, contractLineId: line69.id },
      { calibreRangeId: r912.id, percent: P_912, contractLineId: line912.id },
      { calibreRangeId: rNs.id, percent: P_NS, contractLineId: null }, // нестандарт без строки
    ];
    const actInput = (itemId: number, extra: Record<string, unknown> = {}) => ({
      shipmentItemId: itemId,
      actNumber: `W5A-${itemId}`,
      brakPercent: BRAK,
      calibres: calibresOk,
      ...extra,
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
    const actIdOf = async (itemId: number) =>
      (
        await prisma.acceptanceAct.findUnique({
          where: { shipment_item_id: itemId },
          select: { id: true },
        })
      )?.id ?? null;
    const statusOf = async () =>
      (
        await prisma.shipment.findUniqueOrThrow({
          where: { id: shipment.id },
          select: { status: true },
        })
      ).status;
    const statusLogCount = async () =>
      prisma.changeLog.count({
        where: { entity: "Shipment", entity_id: shipment.id, field: "status" },
      });
    const lastMovementsLog = async (itemId: number) =>
      (
        await prisma.changeLog.findFirst({
          where: { entity: "AcceptanceAct", entity_id: itemId, field: "movements" },
          orderBy: { id: "desc" },
          select: { new_value: true },
        })
      )?.new_value ?? null;

    asUser(admin);

    // ============================================================ A. П-11
    console.log("\nA. П-11 — нетто-гард расхода ингредиентов");
    console.log(`   рецептура: ${QTY_PER_KG} на 1 кг · факт ${ACTUAL} кг → ожидаем 3.425`);

    let res = await saveAct(actInput(item1.id));
    check("A1 приёмка позиции", res.ok, JSON.stringify(res));
    const actId = (await actIdOf(item1.id))!;
    let g = await groupState(actId);
    console.log(`     нетто=${g.net} · движений=${g.rows}`);
    check("A1 расход списан: нетто 3.425, 1 движение", g.net.equals("3.425") && g.rows === 1);

    res = await saveAct(actInput(item1.id));
    check("A2 повторное сохранение того же акта", res.ok, JSON.stringify(res));
    g = await groupState(actId);
    console.log(`     нетто=${g.net} · движений=${g.rows}`);
    check("A2 дубля нет: нетто 3.425, движений по-прежнему 1", g.net.equals("3.425") && g.rows === 1);
    check(
      "A2 ChangeLog говорит «нетто≠0»",
      (await lastMovementsLog(item1.id))?.includes("нетто≠0") === true,
      String(await lastMovementsLog(item1.id)),
    );

    // Ключевой кейс правила 7: сторно без удаления акта. Старый гард (count > 0) здесь
    // молча пропустил бы списание — дословный сценарий бага materials-fix.
    await prisma.stockMovement.create({
      data: {
        date: W,
        kind: "ingredient",
        ingredient_id: ingredient.id,
        quantity: g.net,
        from_location_id: null,
        to_location_id: farmer.id,
        from_state: null,
        to_state: null,
        movement_type: "consumption",
        source_doc_type: "acceptance_act",
        source_doc_id: actId,
      },
    });
    g = await groupState(actId);
    console.log(`     после ручного сторно (акт НЕ удалён): нетто=${g.net} · движений=${g.rows}`);
    check("A3 нетто обнулилось сторно, оригинал остался", g.net.isZero() && g.rows === 2);

    res = await saveAct(actInput(item1.id));
    check("A3 повторное сохранение при нетто=0", res.ok, JSON.stringify(res));
    g = await groupState(actId);
    console.log(`     нетто=${g.net} · движений=${g.rows}`);
    check(
      "A3 расход ПЕРЕСОЗДАН (старый count-гард пропустил бы): нетто 3.425, 3 движения",
      g.net.equals("3.425") && g.rows === 3,
    );

    res = await revertAct({ shipmentItemId: item1.id });
    check("A4 откат приёмки", res.ok, JSON.stringify(res));
    g = await groupState(actId);
    console.log(`     нетто=${g.net} · движений=${g.rows} (оригиналы не удаляются)`);
    check("A4 нетто-сторно обнулило группу, движения на месте", g.net.isZero() && g.rows === 4);
    check("A4 акт удалён", (await actIdOf(item1.id)) === null);

    res = await saveAct(actInput(item1.id));
    check("A5 повторная приёмка после отката", res.ok, JSON.stringify(res));
    const actId2 = (await actIdOf(item1.id))!;
    g = await groupState(actId2);
    console.log(`     нетто=${g.net} · движений=${g.rows} (новый акт #${actId2})`);
    check("A5 расход применён повторно, дублей нет", g.net.equals("3.425") && g.rows === 1);

    await revertAct({ shipmentItemId: item1.id }); // чистый старт для секции B

    // ============================================================ B. П-9
    console.log("\nB. П-9 — авто-accepted под блокировкой (BR-13)");
    console.log(`   старт: статус=${await statusOf()} · записей status в ChangeLog=${await statusLogCount()}`);
    const logBefore = await statusLogCount();

    // Гонка: два saveAct на ДВЕ последние позиции параллельно, разными транзакциями.
    const [rA, rB] = await Promise.all([
      saveAct(actInput(item1.id)),
      saveAct(actInput(item2.id)),
    ]);
    check("B1 обе параллельные приёмки успешны", rA.ok && rB.ok, JSON.stringify([rA, rB]));
    console.log(`     статус=${await statusOf()} · записей status=${await statusLogCount()}`);
    check("B1 машина перешла в accepted (гонка не потеряла переход)", (await statusOf()) === "accepted");
    check("B1 ровно одна запись перехода в ChangeLog", (await statusLogCount()) === logBefore + 1);

    res = await saveAct(actInput(item1.id));
    check("B2 повторное сохранение уже принятого акта", res.ok, JSON.stringify(res));
    console.log(`     статус=${await statusOf()} · записей status=${await statusLogCount()}`);
    check("B2 идемпотентно: статус accepted, второй записи нет", (await statusOf()) === "accepted");
    check("B2 ChangeLog не вырос", (await statusLogCount()) === logBefore + 1);

    res = await revertAct({ shipmentItemId: item1.id });
    check("B3 откат одной позиции", res.ok, JSON.stringify(res));
    console.log(`     статус=${await statusOf()} · записей status=${await statusLogCount()}`);
    check("B3 машина вернулась в arrived", (await statusOf()) === "arrived");
    check("B3 обратный переход записан", (await statusLogCount()) === logBefore + 2);

    await revertAct({ shipmentItemId: item2.id });

    // ============================================================ C. гард BR-33
    console.log("\nC. Гард BR-33 × C3d-2 — нестандарт со строкой + процент к оплате");

    const calibresConflict = [
      { calibreRangeId: r69.id, percent: P_69, contractLineId: line69.id },
      { calibreRangeId: r912.id, percent: P_912, contractLineId: line912.id },
      // нестандарт СО строкой контракта — оплачивается целиком по C3d-2
      { calibreRangeId: rNs.id, percent: P_NS, contractLineId: line912.id },
    ];

    res = await saveAct(actInput(item1.id, { calibres: calibresConflict, settlementPercent: 97 }));
    check("C1 комбинация отклонена", !res.ok, JSON.stringify(res));
    const msg = !res.ok ? (res.error ?? "") : "";
    console.log(`     текст: ${msg}`);
    check("C1 текст называет категорию «>12 см»", msg.includes("«>12 см»"), msg);
    check(
      "C1 текст объясняет оба выхода",
      msg.includes("Уберите строку контракта") && msg.includes("очистите процент"),
      msg,
    );
    check("C1 акт не создан", (await actIdOf(item1.id)) === null);

    res = await saveAct(actInput(item1.id, { calibres: calibresConflict }));
    check("C2 тот же акт БЕЗ процента сохраняется (C3d-2 в силе)", res.ok, JSON.stringify(res));
    const nsResult = await prisma.calibreResult.findFirst({
      where: { acceptanceAct: { shipment_item_id: item1.id }, calibre_range_id: rNs.id },
      select: { contract_line_id: true },
    });
    check("C2 строка у нестандарта сохранена", nsResult?.contract_line_id === line912.id);

    res = await saveAct(actInput(item1.id, { settlementPercent: 97 })); // нестандарт БЕЗ строки
    check("C3 процент + нестандарт БЕЗ строки сохраняется (эталон BR-33)", res.ok, JSON.stringify(res));
    const saved = await prisma.acceptanceAct.findUnique({
      where: { shipment_item_id: item1.id },
      select: { settlement_percent: true },
    });
    check(
      "C3 settlement_percent = 97 в БД",
      saved?.settlement_percent?.toString() === "97",
      String(saved?.settlement_percent),
    );

    // Оператор поле процента не шлёт, но у акта уже есть 97% админа: гард обязан
    // сравнивать ЭФФЕКТИВНОЕ значение, иначе строку нестандарту протащили бы мимо него.
    asUser(operator);
    res = await saveAct(actInput(item1.id, { calibres: calibresConflict }));
    check("C4 оператор не может протащить строку мимо гарда", !res.ok, JSON.stringify(res));
    check(
      "C4 тот же человеческий текст",
      !res.ok && (res.error ?? "").includes("«>12 см»"),
      !res.ok ? res.error : "",
    );
    asUser(admin);
    await revertAct({ shipmentItemId: item1.id });
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
