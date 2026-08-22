// driver-change (BR-34): точечная смена водителя рейса на ЛЮБОМ статусе, без отката.
// Запуск: npx tsx scripts/driver-change-verify.ts
//
// Как в acceptance-ux-2-verify: server-код НЕ трогаем, подменяем только `@/auth`
// (сессия) и `next/cache` (revalidatePath вне Next) resolve-хуками Node. Проверяются
// настоящие changeShipmentDriver / changeMaterialShipmentDriver — requireRole, гарды,
// транзакция с logChange.
//
// Главное, что доказывает скрипт: водитель — атрибут рейса, а не учётная величина.
// Смена НЕ трогает статус, даты, позиции, движения склада, акт и суммы.
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

const PLANNED = 5000; // плановый вес позиции, кг
const ACTUAL = 4800; // перевеска
const UNIT_KG = 20; // нетто на единицу тары → 240 ящиков (ceil)
const TARE_QTY = 30; // количество тары в рейсе доставки

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
  const { changeShipmentDriver, sendShipment } = await import(
    "../server/shipments/actions"
  );
  const { changeMaterialShipmentDriver, sendMaterialShipment } = await import(
    "../server/materials/actions"
  );
  const { markArrived } = await import("../server/acceptance/actions");
  const { saveAct } = await import("../server/acceptance/act");
  const { listDrivers } = await import("../server/drivers/actions");
  const { seasonYearOf } = await import("../server/shipments/workdays");

  const W = new Date("2026-07-15T00:00:00Z");
  const D = new Date("2026-07-13T00:00:00Z");
  const season = seasonYearOf(W);
  const stamp = Date.now();
  const created: (() => Promise<unknown>)[] = [];

  try {
    // --- Справочники: две ТК, четыре водителя (один архивный) ---
    const operator = await prisma.user.create({
      data: { login: `dc-op-${stamp}`, password_hash: "x", role: "operator" },
    });
    const plain = await prisma.user.create({
      data: { login: `dc-user-${stamp}`, password_hash: "x", role: "user" },
    });
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: "admin", active: true },
    });

    const tcA = await prisma.transportCompany.create({ data: { name: `DC ТК-А ${stamp}` } });
    const tcB = await prisma.transportCompany.create({ data: { name: `DC ТК-Б ${stamp}` } });
    const mkDriver = (name: string, tcId: number, active = true) =>
      prisma.driver.create({
        data: { full_name: `${name} ${stamp}`, transport_company_id: tcId, active },
      });
    const d1 = await mkDriver("DC Первый", tcA.id);
    const d2 = await mkDriver("DC Второй", tcA.id);
    const d3 = await mkDriver("DC Третий", tcB.id); // другая ТК
    const dArch = await mkDriver("DC Архивный", tcA.id, false);

    const farmer = await prisma.farmer.create({ data: { name: `DC farmer ${stamp}` } });
    const culture = await prisma.culture.create({
      data: { name: `DC кабачки ${stamp}`, color: "#2F9E44", acceptance_type: "simple" },
    });
    const pkg = await prisma.packagingType.create({
      data: { name: `DC ящик ${stamp}`, kind: "box" },
    });
    const cpt = await prisma.culturePackagingType.create({
      data: { culture_id: culture.id, packaging_type_id: pkg.id, is_default: true },
    });
    const norm = await prisma.packagingNorm.create({
      data: {
        farmer_id: farmer.id,
        culture_id: culture.id,
        packaging_type_id: pkg.id,
        avg_unit_weight_kg: String(UNIT_KG),
      },
    });
    const contract = await prisma.contract.create({
      data: { farmer_id: farmer.id, season_year: season },
    });
    const line = await prisma.contractLine.create({
      data: {
        contract_id: contract.id,
        culture_id: culture.id,
        label: "основная",
        volume_tons: "20",
        price_per_kg: "30",
      },
    });

    // --- Отгрузка овощей: planned с одной позицией (дальше проведём по статусам) ---
    const shipment = await prisma.shipment.create({
      data: {
        code: `DC-${stamp}`,
        status: "planned",
        departure_date: D,
        arrival_date: W,
        driver_id: d1.id,
      },
    });
    const item = await prisma.shipmentItem.create({
      data: {
        shipment_id: shipment.id,
        farmer_id: farmer.id,
        culture_id: culture.id,
        planned_weight_kg: String(PLANNED),
        packaging_type_id: pkg.id,
        contract_line_id: line.id,
      },
    });

    // --- Рейс тары: planned, одна позиция (доставка с завода фермеру) ---
    const trip = await prisma.materialShipment.create({
      data: {
        code: `DCM-${stamp}`,
        status: "planned",
        departure_date: D,
        arrival_date: W,
        driver_id: d1.id,
      },
    });
    const tripItem = await prisma.materialShipmentItem.create({
      data: {
        material_shipment_id: trip.id,
        farmer_id: farmer.id,
        item_kind: "packaging",
        packaging_type_id: pkg.id,
        quantity: String(TARE_QTY),
      },
    });

    created.push(
      () =>
        prisma.changeLog.deleteMany({
          where: { entity: "Shipment", entity_id: shipment.id },
        }),
      () =>
        prisma.changeLog.deleteMany({
          where: { entity: "MaterialShipment", entity_id: trip.id },
        }),
      () => prisma.changeLog.deleteMany({ where: { entity_id: item.id } }),
      () =>
        prisma.stockMovement.deleteMany({
          where: { source_doc_type: "shipment", source_doc_id: shipment.id },
        }),
      () =>
        prisma.stockMovement.deleteMany({
          where: { source_doc_type: "material_shipment", source_doc_id: trip.id },
        }),
      () => prisma.acceptanceAct.deleteMany({ where: { shipment_item_id: item.id } }),
      () => prisma.shipmentItem.delete({ where: { id: item.id } }),
      () => prisma.shipment.delete({ where: { id: shipment.id } }),
      () => prisma.materialShipmentItem.delete({ where: { id: tripItem.id } }),
      () => prisma.materialShipment.delete({ where: { id: trip.id } }),
      () => prisma.contractLine.delete({ where: { id: line.id } }),
      () => prisma.contract.delete({ where: { id: contract.id } }),
      () => prisma.packagingNorm.delete({ where: { id: norm.id } }),
      () => prisma.culturePackagingType.delete({ where: { id: cpt.id } }),
      () => prisma.packagingType.delete({ where: { id: pkg.id } }),
      () => prisma.culture.delete({ where: { id: culture.id } }),
      () => prisma.farmer.delete({ where: { id: farmer.id } }),
      () =>
        prisma.driver.deleteMany({
          where: { id: { in: [d1.id, d2.id, d3.id, dArch.id] } },
        }),
      () =>
        prisma.transportCompany.deleteMany({ where: { id: { in: [tcA.id, tcB.id] } } }),
      () => prisma.user.deleteMany({ where: { id: { in: [operator.id, plain.id] } } }),
    );

    const asUser = (u: { id: number; role: string }) => {
      globalThis.__TEST_USER__ = { id: String(u.id), role: u.role as TestUser["role"] };
    };

    // --- Снимки состояния ---
    // Отпечаток отгрузки: всё, что смена водителя обязана оставить нетронутым.
    const shipmentPrint = async () => {
      const s = await prisma.shipment.findUniqueOrThrow({
        where: { id: shipment.id },
        select: {
          status: true,
          departure_date: true,
          arrival_date: true,
          comment: true,
          driver_id: true,
        },
      });
      const items = await prisma.shipmentItem.findMany({
        where: { shipment_id: shipment.id },
        orderBy: { id: "asc" },
        select: {
          id: true,
          planned_weight_kg: true,
          actual_weight_kg: true,
          packaging_type_id: true,
          contract_line_id: true,
        },
      });
      return {
        driverId: s.driver_id,
        // driver_id намеренно ВНЕ отпечатка: он и должен меняться.
        rest: JSON.stringify({
          status: s.status,
          departure: s.departure_date?.toISOString() ?? null,
          arrival: s.arrival_date?.toISOString() ?? null,
          comment: s.comment,
          items: items.map((i) => ({
            id: i.id,
            planned: i.planned_weight_kg.toString(),
            actual: i.actual_weight_kg?.toString() ?? null,
            pkg: i.packaging_type_id,
            line: i.contract_line_id,
          })),
        }),
      };
    };
    // Леджер отгрузки: число строк + нетто по каждой локации (сторно тут не ожидается,
    // но нетто ловит и его — именно нетто, а не «строки есть», защищает плечи тары).
    const ledgerPrint = async (
      docType: "shipment" | "material_shipment",
      docId: number,
    ) => {
      const rows = await prisma.stockMovement.findMany({
        where: { source_doc_type: docType, source_doc_id: docId },
        select: { quantity: true, from_location_id: true, to_location_id: true },
      });
      const net = new Map<number, number>();
      for (const m of rows) {
        const q = m.quantity.toNumber();
        if (m.to_location_id != null)
          net.set(m.to_location_id, (net.get(m.to_location_id) ?? 0) + q);
        if (m.from_location_id != null)
          net.set(m.from_location_id, (net.get(m.from_location_id) ?? 0) - q);
      }
      return `${rows.length} строк · ${[...net.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([loc, q]) => `${loc}=${q}`)
        .join(" ")}`;
    };
    const driverOf = async () =>
      (
        await prisma.shipment.findUniqueOrThrow({
          where: { id: shipment.id },
          select: { driver_id: true },
        })
      ).driver_id;
    // ТК рейса — производная от водителя (акт читает её живьём, снимка нет).
    const companyOfShipment = async () =>
      (
        await prisma.shipment.findUniqueOrThrow({
          where: { id: shipment.id },
          include: { driver: { include: { transportCompany: true } } },
        })
      ).driver?.transportCompany.name ?? null;
    const logRows = (entity: string, entityId: number) =>
      prisma.changeLog.findMany({
        where: { entity, entity_id: entityId },
        orderBy: { id: "asc" },
        select: { id: true, field: true, old_value: true, new_value: true, user_id: true },
      });

    console.log("A. Статус sent: смена водителя без отката");
    asUser(admin);
    let res = await sendShipment(shipment.id);
    check("отгрузка отправлена (плечо тары двинуто)", res.ok, JSON.stringify(res));

    const beforeSent = await shipmentPrint();
    const ledgerBefore = await ledgerPrint("shipment", shipment.id);
    const logBefore = await logRows("Shipment", shipment.id);

    res = await changeShipmentDriver({
      shipmentId: shipment.id,
      driverId: d2.id,
      reason: "поломка тягача",
    });
    check("admin сменил водителя на sent", res.ok, JSON.stringify(res));

    const afterSent = await shipmentPrint();
    check("driver_id обновлён", afterSent.driverId === d2.id, String(afterSent.driverId));
    check(
      "статус, даты, комментарий и позиции не изменились",
      afterSent.rest === beforeSent.rest,
      `${beforeSent.rest}\n    → ${afterSent.rest}`,
    );
    const ledgerAfter = await ledgerPrint("shipment", shipment.id);
    check(
      "движения тары не изменились (строки и нетто)",
      ledgerAfter === ledgerBefore,
      `${ledgerBefore} → ${ledgerAfter}`,
    );

    const logAfter = await logRows("Shipment", shipment.id);
    const fresh = logAfter.filter((r) => !logBefore.some((b) => b.id === r.id));
    const drvRow = fresh.filter((r) => r.field === "driver_id");
    const reasonRow = fresh.filter((r) => r.field === "driver_change_reason");
    check(
      "ChangeLog: ровно одна запись driver_id (old → new)",
      drvRow.length === 1 &&
        drvRow[0].old_value === String(d1.id) &&
        drvRow[0].new_value === String(d2.id),
      JSON.stringify(drvRow),
    );
    check(
      "ChangeLog: причина отдельной записью",
      reasonRow.length === 1 &&
        reasonRow[0].old_value === null &&
        reasonRow[0].new_value === "поломка тягача",
      JSON.stringify(reasonRow),
    );
    check(
      "обе записи привязаны к admin",
      drvRow[0]?.user_id === admin.id && reasonRow[0]?.user_id === admin.id,
    );

    console.log("\nB. Пустой диф и архивный водитель");
    const logB = await logRows("Shipment", shipment.id);
    res = await changeShipmentDriver({ shipmentId: shipment.id, driverId: d2.id });
    check("выбор того же водителя — ok", res.ok, JSON.stringify(res));
    check(
      "новых записей в журнале нет",
      (await logRows("Shipment", shipment.id)).length === logB.length,
    );

    res = await changeShipmentDriver({ shipmentId: shipment.id, driverId: dArch.id });
    check(
      "архивный водитель отклонён",
      !res.ok && res.error === "Водитель архивный — выберите активного",
      JSON.stringify(res),
    );
    check("привязка не изменилась", (await driverOf()) === d2.id);
    const listed = await listDrivers();
    check(
      "архивного нет в списке выбора",
      !listed.some((d) => d.id === dArch.id) && listed.some((d) => d.id === d2.id),
    );

    res = await changeShipmentDriver({ shipmentId: shipment.id, driverId: 10 ** 9 });
    check(
      "несуществующий водитель отклонён",
      !res.ok && res.error === "Водитель не найден",
      JSON.stringify(res),
    );

    console.log("\nC. RBAC: operator и user получают отказ на прямом вызове");
    for (const u of [operator, plain]) {
      asUser(u);
      const r = await changeShipmentDriver({ shipmentId: shipment.id, driverId: d3.id });
      check(`${u.role}: отказ`, !r.ok && r.error === "Нет прав", JSON.stringify(r));
    }
    check("привязка по-прежнему d2", (await driverOf()) === d2.id);

    console.log("\nD. Статус arrived: смена на водителя ДРУГОЙ ТК");
    asUser(admin);
    res = await markArrived({ shipmentId: shipment.id, arrivalDate: "2026-07-15" });
    check("машина отмечена прибывшей", res.ok, JSON.stringify(res));

    const beforeArrived = await shipmentPrint();
    const ledgerArrivedBefore = await ledgerPrint("shipment", shipment.id);
    check("ТК рейса до смены — ТК-А", (await companyOfShipment()) === tcA.name);

    res = await changeShipmentDriver({ shipmentId: shipment.id, driverId: d3.id });
    check("смена на arrived прошла", res.ok, JSON.stringify(res));
    const afterArrived = await shipmentPrint();
    check(
      "статус arrived, даты и позиции не тронуты",
      afterArrived.rest === beforeArrived.rest,
      `${beforeArrived.rest}\n    → ${afterArrived.rest}`,
    );
    check(
      "движения тары не изменились",
      (await ledgerPrint("shipment", shipment.id)) === ledgerArrivedBefore,
    );
    check(
      "ТК рейса поехала за водителем: ТК-А → ТК-Б",
      (await companyOfShipment()) === tcB.name,
      String(await companyOfShipment()),
    );

    console.log("\nE. Статус accepted: акт, веса и суммы не шелохнулись");
    await prisma.shipmentItem.update({
      where: { id: item.id },
      data: { actual_weight_kg: String(ACTUAL) },
    });
    res = await saveAct({
      shipmentItemId: item.id,
      actNumber: `DC-${stamp}`,
      brakPercent: 5,
      contractLineId: line.id,
    });
    check("позиция принята → машина accepted (BR-13)", res.ok, JSON.stringify(res));
    check("статус машины accepted", (await shipmentPrint()).rest.includes('"accepted"'));

    const actBefore = await prisma.acceptanceAct.findUniqueOrThrow({
      where: { shipment_item_id: item.id },
      select: {
        act_number: true,
        brak_percent: true,
        accepted_percent: true,
        settlement_percent: true,
      },
    });
    const beforeAccepted = await shipmentPrint();
    const ledgerAcceptedBefore = await ledgerPrint("shipment", shipment.id);

    res = await changeShipmentDriver({
      shipmentId: shipment.id,
      driverId: d1.id,
      reason: "ротация на базе",
    });
    check("смена на accepted прошла без отката", res.ok, JSON.stringify(res));
    check("водитель снова d1", (await driverOf()) === d1.id);

    const actAfter = await prisma.acceptanceAct.findUniqueOrThrow({
      where: { shipment_item_id: item.id },
      select: {
        act_number: true,
        brak_percent: true,
        accepted_percent: true,
        settlement_percent: true,
      },
    });
    check(
      "акт не изменился (№, брак, принято %, % к оплате)",
      JSON.stringify(actBefore) === JSON.stringify(actAfter),
      `${JSON.stringify(actBefore)} → ${JSON.stringify(actAfter)}`,
    );
    check(
      "статус accepted, фактический вес и позиции не тронуты",
      (await shipmentPrint()).rest === beforeAccepted.rest,
    );
    check(
      "движения по отгрузке не изменились",
      (await ledgerPrint("shipment", shipment.id)) === ledgerAcceptedBefore,
    );

    console.log("\nF. Рейс тары: та же операция, свой домен");
    res = await sendMaterialShipment(trip.id);
    check("рейс отправлен (плечо доставки)", res.ok, JSON.stringify(res));

    const tripPrint = async () => {
      const t = await prisma.materialShipment.findUniqueOrThrow({
        where: { id: trip.id },
        select: {
          status: true,
          departure_date: true,
          arrival_date: true,
          source_farmer_id: true,
        },
      });
      const items = await prisma.materialShipmentItem.findMany({
        where: { material_shipment_id: trip.id },
        orderBy: { id: "asc" },
        select: {
          id: true,
          farmer_id: true,
          item_kind: true,
          packaging_type_id: true,
          ingredient_id: true,
          quantity: true,
          arrived_at: true,
        },
      });
      return JSON.stringify({
        status: t.status,
        departure: t.departure_date?.toISOString() ?? null,
        arrival: t.arrival_date?.toISOString() ?? null,
        source: t.source_farmer_id,
        items: items.map((i) => ({
          id: i.id,
          farmer: i.farmer_id,
          kind: i.item_kind,
          pkg: i.packaging_type_id,
          ing: i.ingredient_id,
          qty: i.quantity.toString(),
          arrived: i.arrived_at?.toISOString() ?? null,
        })),
      });
    };
    const tripBefore = await tripPrint();
    const tripLedgerBefore = await ledgerPrint("material_shipment", trip.id);
    const tripLogBefore = await logRows("MaterialShipment", trip.id);

    asUser(operator);
    let mres = await changeMaterialShipmentDriver({
      materialShipmentId: trip.id,
      driverId: d3.id,
    });
    check("operator: отказ", !mres.ok && mres.error === "Нет прав", JSON.stringify(mres));

    asUser(admin);
    mres = await changeMaterialShipmentDriver({
      materialShipmentId: trip.id,
      driverId: d3.id,
      reason: "замена на базе",
    });
    check("admin сменил водителя рейса тары", mres.ok, JSON.stringify(mres));

    const tripDriver = await prisma.materialShipment.findUniqueOrThrow({
      where: { id: trip.id },
      select: { driver_id: true },
    });
    check("driver_id рейса обновлён", tripDriver.driver_id === d3.id);
    check(
      "source_farmer_id, статус, даты, позиции и arrived_at не тронуты",
      (await tripPrint()) === tripBefore,
      `${tripBefore}\n    → ${await tripPrint()}`,
    );
    check(
      "движения доставки не изменились",
      (await ledgerPrint("material_shipment", trip.id)) === tripLedgerBefore,
    );

    const tripFresh = (await logRows("MaterialShipment", trip.id)).filter(
      (r) => !tripLogBefore.some((b) => b.id === r.id),
    );
    check(
      "ChangeLog рейса: driver_id (old всегда заполнен, NOT NULL) + причина",
      tripFresh.length === 2 &&
        tripFresh[0].field === "driver_id" &&
        tripFresh[0].old_value === String(d1.id) &&
        tripFresh[0].new_value === String(d3.id) &&
        tripFresh[1].field === "driver_change_reason" &&
        tripFresh[1].new_value === "замена на базе",
      JSON.stringify(tripFresh),
    );

    mres = await changeMaterialShipmentDriver({
      materialShipmentId: trip.id,
      driverId: dArch.id,
    });
    check(
      "архивный водитель отклонён и здесь",
      !mres.ok && mres.error === "Водитель архивный — выберите активного",
      JSON.stringify(mres),
    );

    console.log("\nG. Архивный водитель как ТЕКУЩАЯ привязка — не теряется");
    await prisma.driver.update({ where: { id: d3.id }, data: { active: false } });
    const stillThere = await prisma.materialShipment.findUniqueOrThrow({
      where: { id: trip.id },
      include: { driver: { include: { transportCompany: true } } },
    });
    check(
      "рейс по-прежнему показывает имя и ТК архивного водителя",
      stillThere.driver.full_name === d3.full_name &&
        stillThere.driver.transportCompany.name === tcB.name,
    );
    await prisma.driver.update({ where: { id: d3.id }, data: { active: true } });
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
