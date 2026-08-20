// departure-calendar-days: дата отправления = прибытие − 2 КАЛЕНДАРНЫХ дня (BR-12/BR-31).
// Запуск: npx tsx scripts/departure-calendar-verify.ts
//
//   A. Массовое создание, прибытие ПН → в БД departure_date = СБ (не ПТ, как раньше).
//   B. То же для ВТ → ВС: отправление в выходной завода сохраняется без возражений.
//   C. Прибытие в ВС → отказ «нерабочий день завода»: BR-11 цел, машина не создана.
//   D. Drag (moveShipmentToDay) planned-машины на ПН → отправление пересчитано в СБ + ChangeLog.
//   E. Машина со СТАРЫМ отправлением (ПТ) задним числом не пересчитывается: и в БД, и на
//      карточке доски остаётся ПТ (карточка показывает сохранённое значение, не расчёт).
//
// Server Actions требуют сессию (requireRole) и Next-контекст (revalidatePath), поэтому
// подменяем `@/auth` и `next/cache` loader-хуками Node (приём из contract-lines-verify).
// Сам server-код НЕ трогаем — выполняется настоящая логика создания/переноса.
//
// Даты берутся ОТНОСИТЕЛЬНО сегодня (ближайшие будущие пн/вт/вс): и массовое создание,
// и drag отклоняют прошедшие дни (todayLocalISO), поэтому хардкод дат протух бы.
// Данные создаются реально и удаляются в finally (dev-ветка Neon, данные одноразовые).
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

const WEEKDAY_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const label = (iso: string) => `${iso} (${WEEKDAY_RU[new Date(`${iso}T00:00:00Z`).getUTCDay()]})`;

async function main() {
  // Динамические импорты — после регистрации хуков.
  const { prisma } = await import("../lib/prisma");
  const { createWholeMachines } = await import("../server/shipments/actions");
  const { moveShipmentToDay } = await import("../server/board/actions");
  const { getBoardWeek } = await import("../server/board/board");
  const {
    isFactoryWorkday,
    isoWeek,
    parseDateUTC,
    seasonYearOf,
    shiftCalendarDaysISO,
    todayLocalISO,
    TRIP_DAYS,
  } = await import("../server/shipments/workdays");

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // Ближайший БУДУЩИЙ понедельник (строго после сегодня), от него — вся неделя.
  const today = parseDateUTC(todayLocalISO());
  const monday = new Date(today);
  do {
    monday.setUTCDate(monday.getUTCDate() + 1);
  } while (monday.getUTCDay() !== 1);
  const mon = iso(monday);
  const tue = iso(new Date(monday.getTime() + 86400000));
  const wed = iso(new Date(monday.getTime() + 2 * 86400000));
  const sun = iso(new Date(monday.getTime() + 6 * 86400000)); // воскресенье ЭТОЙ же недели

  // Ожидания считаем независимо от продового хелпера — сдвигом нативного Date.
  const shift = (isoDate: string, days: number) => {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const expSatFromMon = shift(mon, -2); // суббота
  const expSunFromTue = shift(tue, -2); // воскресенье
  const oldRuleFri = shift(mon, -3); // как считало старое правило рабочих дней (пт)

  const season = seasonYearOf(monday);
  const week = isoWeek(monday);
  const cleanup: (() => Promise<unknown>)[] = [];
  const seenShipments = new Set<number>();

  try {
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: "admin", active: true },
    });
    globalThis.__TEST_USER__ = { id: String(admin.id), role: "admin" };

    const cfg = await prisma.seasonConfig.findUnique({ where: { season_year: season } });
    console.log(
      `Сегодня ${todayLocalISO()}; неделя ${week.isoYear}-W${week.isoWeek}, сезон ${season}\n` +
        `Дни: пн ${mon} · вт ${tue} · ср ${wed} · вс ${sun}\n` +
        `Рабочие дни завода: пн=${isFactoryWorkday(parseDateUTC(mon), cfg)} · ` +
        `сб(${expSatFromMon})=${isFactoryWorkday(parseDateUTC(expSatFromMon), cfg)} · ` +
        `вс(${sun})=${isFactoryWorkday(parseDateUTC(sun), cfg)}`,
    );
    if (!isFactoryWorkday(parseDateUTC(mon), cfg) || isFactoryWorkday(parseDateUTC(sun), cfg)) {
      throw new Error("SeasonConfig нетипичен (пн нерабочий или вс рабочий) — сценарии BR-11 не применимы");
    }

    // ------------------------------------------------------------------ seed
    // Культура БЕЗ привязанных типов тары → позиция навалом, PackagingNorm не нужна.
    const farmer = await prisma.farmer.create({ data: { name: "DCD фермер" } });
    const culture = await prisma.culture.create({
      data: { name: "DCD кабачки", color: "#2F9E44", acceptance_type: "simple" },
    });

    cleanup.push(
      () =>
        prisma.changeLog.deleteMany({
          where: { entity: "Shipment", entity_id: { in: [...seenShipments] } },
        }),
      () => prisma.shipmentItem.deleteMany({ where: { farmer_id: farmer.id } }),
      () => prisma.shipment.deleteMany({ where: { id: { in: [...seenShipments] } } }),
      () => prisma.culture.delete({ where: { id: culture.id } }),
      () => prisma.farmer.delete({ where: { id: farmer.id } }),
    );

    // Машины, созданные экшеном, находим по позициям нашего фермера.
    const machinesOf = async (arrivalISO: string) => {
      const items = await prisma.shipmentItem.findMany({
        where: { farmer_id: farmer.id },
        select: { shipment: true },
      });
      for (const it of items) seenShipments.add(it.shipment.id);
      return items
        .map((it) => it.shipment)
        .filter((s) => s.arrival_date && iso(s.arrival_date) === arrivalISO);
    };

    // --------------------------------------------- A. массовое создание, прибытие ПН
    console.log(`\nA. Массовое создание, прибытие ${label(mon)}`);
    let res = await createWholeMachines({
      farmerId: farmer.id,
      cultureId: culture.id,
      plannedWeightKg: "5000",
      packagingTypeId: null,
      dayDatesISO: [mon],
    });
    check("A1 создание прошло", res.ok, JSON.stringify(res));
    const monMachines = await machinesOf(mon);
    check("A2 машина одна", monMachines.length === 1, String(monMachines.length));
    const monDeparture = monMachines[0]?.departure_date ? iso(monMachines[0].departure_date) : "—";
    console.log(`   в БД: отправление ${label(monDeparture)}, прибытие ${label(mon)}`);
    check(
      `A3 отправление в БД = ${label(expSatFromMon)} (−2 календарных)`,
      monDeparture === expSatFromMon,
      monDeparture,
    );
    check(
      `A4 это НЕ старое «−2 рабочих» ${label(oldRuleFri)}`,
      monDeparture !== oldRuleFri,
      monDeparture,
    );
    check(
      "A5 сервер совпал с формой (тот же хелпер)",
      monDeparture === shiftCalendarDaysISO(mon, -TRIP_DAYS),
      `${monDeparture} vs ${shiftCalendarDaysISO(mon, -TRIP_DAYS)}`,
    );

    // ------------------------------------------------------ B. прибытие ВТ → отпр. ВС
    console.log(`\nB. Массовое создание, прибытие ${label(tue)}`);
    res = await createWholeMachines({
      farmerId: farmer.id,
      cultureId: culture.id,
      plannedWeightKg: "5000",
      packagingTypeId: null,
      dayDatesISO: [tue],
    });
    check("B1 создание прошло", res.ok, JSON.stringify(res));
    const tueMachines = await machinesOf(tue);
    const tueDeparture = tueMachines[0]?.departure_date ? iso(tueMachines[0].departure_date) : "—";
    console.log(`   в БД: отправление ${label(tueDeparture)}`);
    check(
      `B2 отправление в БД = ${label(expSunFromTue)} — воскресенье, выходной завода`,
      tueDeparture === expSunFromTue,
      tueDeparture,
    );
    check(
      "B3 отправление действительно в нерабочий день завода (норма, BR-12)",
      !isFactoryWorkday(parseDateUTC(tueDeparture), cfg),
      tueDeparture,
    );

    // ------------------------------------------------------ C. BR-11 цел (прибытие ВС)
    console.log(`\nC. Массовое создание с прибытием ${label(sun)} — должно быть отклонено`);
    res = await createWholeMachines({
      farmerId: farmer.id,
      cultureId: culture.id,
      plannedWeightKg: "5000",
      packagingTypeId: null,
      dayDatesISO: [sun],
    });
    check(
      "C1 отказ с текстом «нерабочий день завода»",
      !res.ok && (res.error ?? "").includes("нерабочий день завода"),
      JSON.stringify(res),
    );
    check("C2 машина на воскресенье не создана", (await machinesOf(sun)).length === 0);

    // ------------------------------------------------------------- D. drag на доске
    console.log(`\nD. Drag planned-машины (прибытие ${label(wed)}) на ${label(mon)}`);
    const dragged = await prisma.shipment.create({
      data: {
        code: `DCD-${Date.now()}`,
        status: "planned",
        arrival_date: parseDateUTC(wed),
        departure_date: parseDateUTC(shift(wed, -2)),
      },
    });
    seenShipments.add(dragged.id);
    await prisma.shipmentItem.create({
      data: {
        shipment_id: dragged.id,
        farmer_id: farmer.id,
        culture_id: culture.id,
        planned_weight_kg: "5000",
      },
    });
    const logFrom =
      (await prisma.changeLog.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0;
    const moveRes = await moveShipmentToDay(dragged.id, mon);
    check("D1 перенос прошёл", moveRes.ok, JSON.stringify(moveRes));
    const afterDrag = await prisma.shipment.findUniqueOrThrow({ where: { id: dragged.id } });
    const dragDeparture = afterDrag.departure_date ? iso(afterDrag.departure_date) : "—";
    console.log(`   в БД после drag: прибытие ${label(iso(afterDrag.arrival_date!))}, отправление ${label(dragDeparture)}`);
    check(`D2 прибытие = ${label(mon)}`, iso(afterDrag.arrival_date!) === mon, iso(afterDrag.arrival_date!));
    check(
      `D3 отправление пересчитано календарно = ${label(expSatFromMon)}`,
      dragDeparture === expSatFromMon,
      dragDeparture,
    );
    const dragLogs = await prisma.changeLog.findMany({
      where: { id: { gt: logFrom }, entity: "Shipment", entity_id: dragged.id },
      orderBy: { id: "asc" },
    });
    check(
      "D4 в ChangeLog обе даты",
      dragLogs.some((l) => l.field === "arrival_date") &&
        dragLogs.some((l) => l.field === "departure_date" && l.new_value === expSatFromMon),
      JSON.stringify(dragLogs.map((l) => `${l.field}:${l.new_value}`)),
    );

    // -------------------------------- E. старые машины задним числом не пересчитываются
    console.log(`\nE. Машина со старым отправлением ${label(oldRuleFri)} при прибытии ${label(mon)}`);
    const legacy = await prisma.shipment.create({
      data: {
        code: `DCD-L-${Date.now()}`,
        status: "planned",
        arrival_date: parseDateUTC(mon),
        departure_date: parseDateUTC(oldRuleFri), // как посчитало правило «рабочих дней»
      },
    });
    seenShipments.add(legacy.id);
    await prisma.shipmentItem.create({
      data: {
        shipment_id: legacy.id,
        farmer_id: farmer.id,
        culture_id: culture.id,
        planned_weight_kg: "5000",
      },
    });
    const board = await getBoardWeek({
      seasonYear: season,
      isoYear: week.isoYear,
      isoWeek: week.isoWeek,
    });
    const monColumn = board.columns.find((c) => c.dateISO === mon);
    const legacyCard = monColumn?.cards.find((c) => c.shipmentId === legacy.id);
    const stillInDb = await prisma.shipment.findUniqueOrThrow({ where: { id: legacy.id } });
    console.log(
      `   в БД: ${label(iso(stillInDb.departure_date!))} · на карточке доски: ${
        legacyCard?.departureDate ? label(legacyCard.departureDate) : "—"
      } · «+ Отгрузка» дня: ${label(monColumn?.addDepartureISO ?? "—")}`,
    );
    check(
      "E1 в БД отправление не тронуто (нет пересчёта задним числом)",
      iso(stillInDb.departure_date!) === oldRuleFri,
      iso(stillInDb.departure_date!),
    );
    check(
      "E2 карточка доски показывает СОХРАНЁННОЕ отправление, а не расчёт",
      legacyCard?.departureDate === oldRuleFri,
      String(legacyCard?.departureDate),
    );
    check(
      `E3 новая отгрузка дня («+ Отгрузка») предлагает ${label(expSatFromMon)}`,
      monColumn?.addDepartureISO === expSatFromMon,
      String(monColumn?.addDepartureISO),
    );
    const newCard = monColumn?.cards.find((c) => c.shipmentId === monMachines[0]?.id);
    check(
      "E4 у новой машины карточка и БД совпадают (суббота)",
      newCard?.departureDate === expSatFromMon,
      String(newCard?.departureDate),
    );
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
