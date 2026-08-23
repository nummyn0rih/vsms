// farmer-analytics verification: вкладка «Аналитика» карточки поставщика (темп, прогноз
// «осталось ~N машин», ритм поставок, доля фермера — с переключателем периода).
// Запуск: npx tsx scripts/farmer-analytics-verify.ts
//
// Проверяется НАСТОЯЩИЙ getFarmerAnalytics — целиком, включая requireRole. Три модуля
// подменяются resolve-хуками Node (стабы в scripts/_stubs): `@/auth` — сессия,
// `next/cache` — ревалидация (вне Next её звать нельзя), `@/lib/prisma` — настоящий
// клиент под Proxy-счётчиком: форма обращений к БД здесь такая же часть контракта, как
// числа (одна общая выборка позиций, а не по выборке на культуру).
//
// Главные сверки — с СОСЕДНИМИ ЭКРАНАМИ: «Выполнение, %» обязано совпасть с итогом вкладки
// «Контракты» (getFarmerCard), а «Доля в культуре» — со строкой этого фермера в таблице
// «По поставщикам» профиля культуры. Расхождение здесь означает, что расчёт раздвоился.
//
// Тестовая БД: данные создаются и удаляются в конце (dev-ветка Neon, данные одноразовые —
// CLAUDE.md). Внутри $transaction провести нельзя: загрузчик ходит в БД своим клиентом.
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
const near = (a: number | null | undefined, b: number, eps = 1e-6) =>
  a != null && Math.abs(a - b) < eps;

// Среды подряд: ISO-недели 29, 30, 31, 32 сезона 2026; W33 — заведомо пустая.
const WEEK = [
  new Date("2026-07-15T00:00:00Z"),
  new Date("2026-07-22T00:00:00Z"),
  new Date("2026-07-29T00:00:00Z"),
  new Date("2026-08-05T00:00:00Z"),
  new Date("2026-08-12T00:00:00Z"),
];
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  // Динамические импорты — ПОСЛЕ регистрации хуков, иначе модули возьмут настоящий клиент.
  const { prisma } = await import("../lib/prisma");
  const { spyCalls, spyCount, spyReset } = await import("./_stubs/prisma-spy");
  const { getFarmerAnalytics } = await import("../server/farmers/analytics");
  const { getFarmerCard } = await import("../server/farmers/card");
  const { getCultureAnalytics } = await import("../server/analytics/culture");
  const { seasonYearOf, todayLocalISO } = await import("../server/shipments/workdays");

  const season = seasonYearOf(WEEK[0]);
  const today = todayLocalISO();
  const tag = `FA-${Date.now()}`;
  const created: (() => Promise<unknown>)[] = [];

  try {
    // ---------- Данные сценария ----------
    const tc = await prisma.transportCompany.create({ data: { name: `${tag} TC` } });
    const driver = await prisma.driver.create({
      data: { full_name: `${tag} driver`, transport_company_id: tc.id },
    });
    const [f1, f2, f3] = await Promise.all([
      prisma.farmer.create({ data: { name: `${tag} наш` } }),
      prisma.farmer.create({ data: { name: `${tag} сосед` } }),
      prisma.farmer.create({ data: { name: `${tag} без контракта` } }),
    ]);

    // A и B — со строками контракта; C — принятое есть, строки нет (прочерки прогноза).
    const [cultA, cultB, cultC] = await Promise.all([
      prisma.culture.create({
        data: { name: `${tag} огурцы`, color: "#2F9E44", acceptance_type: "simple" },
      }),
      prisma.culture.create({
        data: { name: `${tag} томаты`, color: "#D4322C", acceptance_type: "simple" },
      }),
      prisma.culture.create({
        data: { name: `${tag} патиссоны`, color: "#7C3AED", acceptance_type: "simple" },
      }),
    ]);

    const contract = await prisma.contract.create({
      data: { farmer_id: f1.id, season_year: season },
    });
    const lineA = await prisma.contractLine.create({
      data: {
        contract_id: contract.id,
        culture_id: cultA.id,
        volume_tons: "38",
        price_per_kg: "30",
      },
    });
    const lineB = await prisma.contractLine.create({
      data: {
        contract_id: contract.id,
        culture_id: cultB.id,
        volume_tons: "30",
        price_per_kg: "25",
      },
    });

    // Нормы рейса: пары фермер×культура. Есть у всех трёх культур с объёмом — иначе
    // avgTripPlanKg обязан стать null (это проверяется отдельно).
    await prisma.tripWeightNorm.createMany({
      data: [
        { farmer_id: f1.id, culture_id: cultA.id, planned_trip_weight_kg: "12000" },
        { farmer_id: f1.id, culture_id: cultB.id, planned_trip_weight_kg: "6000" },
        { farmer_id: f1.id, culture_id: cultC.id, planned_trip_weight_kg: "4000" },
      ],
    });

    const itemIds: number[] = [];
    const shipmentIds: number[] = [];
    let actSeq = 0;

    async function seed(p: {
      farmerId: number;
      cultureId: number;
      lineId?: number;
      week: number;
      actualKg: number | null;
      withAct?: boolean;
    }) {
      const shipment = await prisma.shipment.create({
        data: {
          code: `${tag}-${shipmentIds.length + 1}`,
          status: p.withAct === false ? "arrived" : "accepted",
          departure_date: WEEK[p.week],
          arrival_date: WEEK[p.week],
          driver_id: driver.id,
        },
      });
      shipmentIds.push(shipment.id);
      const item = await prisma.shipmentItem.create({
        data: {
          shipment_id: shipment.id,
          farmer_id: p.farmerId,
          culture_id: p.cultureId,
          contract_line_id: p.lineId ?? null,
          planned_weight_kg: String(p.actualKg ?? 0),
          actual_weight_kg: p.actualKg != null ? String(p.actualKg) : null,
        },
      });
      itemIds.push(item.id);
      if (p.withAct === false) return item;
      actSeq += 1;
      await prisma.acceptanceAct.create({
        data: {
          shipment_item_id: item.id,
          act_number: `${season}-${tag}-${actSeq}`,
          brak_percent: null, // брак нулевой: прогноз проверяем на чистой арифметике
        },
      });
      return item;
    }

    // A: три рейса по 10 т (недели 0,1,2) → принято 30 т, средний рейс 10 т.
    //    Строка 38 т → остаток 8 т → 1 машина.
    for (const w of [0, 1, 2]) {
      await seed({ farmerId: f1.id, cultureId: cultA.id, lineId: lineA.id, week: w, actualKg: 10_000 });
    }
    // B: два рейса по 5 т (недели 0 и 3) → принято 10 т, средний рейс 5 т.
    //    Строка 30 т → остаток 20 т → 4 машины.
    for (const w of [0, 3]) {
      await seed({ farmerId: f1.id, cultureId: cultB.id, lineId: lineB.id, week: w, actualKg: 5_000 });
    }
    // C: один рейс 4 т, строки контракта нет → прогноз прочерками.
    await seed({ farmerId: f1.id, cultureId: cultC.id, week: 1, actualKg: 4_000 });
    // Сосед по культуре A — база «доли в культуре» и suppliersCount.
    await seed({ farmerId: f2.id, cultureId: cultA.id, week: 0, actualKg: 10_000 });
    // Фермер без контрактов (стейдж C1): факты есть, плана нет.
    await seed({ farmerId: f3.id, cultureId: cultC.id, week: 0, actualKg: 3_000 });
    await seed({ farmerId: f3.id, cultureId: cultC.id, week: 2, actualKg: 3_000 });

    created.push(
      () => prisma.shipmentItem.deleteMany({ where: { id: { in: itemIds } } }),
      () => prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } }),
      () => prisma.tripWeightNorm.deleteMany({ where: { farmer_id: f1.id } }),
      () => prisma.contractLine.deleteMany({ where: { contract_id: contract.id } }),
      () => prisma.contract.delete({ where: { id: contract.id } }),
      () =>
        prisma.culture.deleteMany({
          where: { id: { in: [cultA.id, cultB.id, cultC.id] } },
        }),
      () => prisma.farmer.deleteMany({ where: { id: { in: [f1.id, f2.id, f3.id] } } }),
      () => prisma.driver.delete({ where: { id: driver.id } }),
      () => prisma.transportCompany.delete({ where: { id: tc.id } }),
    );

    // ---------- Фаза 1: форма обращений к БД ----------
    console.log("\n1) Число запросов на открытие вкладки");
    spyReset();
    const a1 = await getFarmerAnalytics({ farmerId: f1.id, season });
    const calls = spyCalls();
    console.log(`   запросы: ${calls.join(" · ")}`);
    check(
      "выборок позиций ровно четыре (фермер + выполнение + сезон + культуры)",
      spyCount("shipmentItem", "findMany") === 4,
      `их ${spyCount("shipmentItem", "findMany")}`,
    );
    check("всего обращений к моделям — 8", calls.length === 8, `их ${calls.length}`);
    check(
      "по культуре на выборку НЕ ходим (3 культуры → не 3+ выборки по культурам)",
      spyCount("culture", "findMany") === 1,
      `их ${spyCount("culture", "findMany")}`,
    );
    if (!a1) throw new Error("getFarmerAnalytics вернул null");

    // ---------- Фаза 2: выполнение сходится с вкладкой «Контракты» ----------
    console.log("\n2) «Выполнение, %» против вкладки «Контракты»");
    const card = await getFarmerCard(f1.id);
    check(
      "выполнение = итогу карточки (Σ принятого / Σ плана строк)",
      near(a1.kpi.executionPct, card!.contracts.farmerTotal.pct, 1e-9),
      `${a1.kpi.executionPct} vs ${card!.contracts.farmerTotal.pct}`,
    );
    check(
      "и равно ручному (30 000 + 10 000) / (38 000 + 30 000)",
      near(a1.kpi.executionPct, (40_000 / 68_000) * 100),
      String(a1.kpi.executionPct),
    );

    // ---------- Фаза 3: прогноз «осталось ~N машин» ----------
    console.log("\n3) Прогноз машин");
    const rowA = a1.remaining.find((r) => r.cultureId === cultA.id)!;
    const rowB = a1.remaining.find((r) => r.cultureId === cultB.id)!;
    const rowC = a1.remaining.find((r) => r.cultureId === cultC.id)!;
    check("A: строка 38 т, принято 30 т, остаток 8 т", near(rowA.remainingKg, 8_000));
    check("A: средний рейс 10 т (факт), машин 1", rowA.avgTripKg === 10_000 && rowA.trips === 1);
    check("A: база прогноза — факт, а не норма (12 т)", rowA.avgTripSource === "actual");
    check("B: остаток 20 т при среднем рейсе 5 т → 4 машины", rowB.trips === 4);
    check(
      "C без строки контракта: план, остаток и машины — прочерки, не нули",
      rowC.lineTons === null && rowC.remainingKg === null && rowC.trips === null,
      JSON.stringify({ lineTons: rowC.lineTons, remainingKg: rowC.remainingKg, trips: rowC.trips }),
    );
    check("C: принятое всё же показано (4 т)", near(rowC.acceptedKg, 4_000));
    check("итог машин = 1 + 4, культура без плана в него не входит", a1.kpi.remainingTrips === 5);

    // ---------- Фаза 4: средний вес рейса ----------
    console.log("\n4) Средний вес рейса, план и факт");
    // Факт: шесть рейсов фермера — 3×10 000, 2×5 000, 1×4 000 → (30+10+4)/6 = 7 333,33
    check(
      "факт = Σ веса перевешенных рейсов / их число",
      near(a1.kpi.avgTripActualKg, 44_000 / 6, 1e-6),
      String(a1.kpi.avgTripActualKg),
    );
    const planExpected =
      (12_000 * 30_000 + 6_000 * 10_000 + 4_000 * 4_000) / (30_000 + 10_000 + 4_000);
    check(
      "план взвешен принятым объёмом культур",
      near(a1.kpi.avgTripPlanKg, planExpected, 1e-6),
      `${a1.kpi.avgTripPlanKg} vs ${planExpected}`,
    );

    // ---------- Фаза 5: доли ----------
    console.log("\n5) Доля фермера против профиля культуры");
    const profile = await getCultureAnalytics({ season, cultureId: cultA.id });
    const profRow = profile!.bySupplier.find((s) => s.farmerId === f1.id)!;
    const shareA = a1.share.byCulture.find((s) => s.cultureId === cultA.id)!;
    check(
      "«доля в культуре» = доле строки в таблице «По поставщикам»",
      near(shareA.pctOfCulture, profRow.sharePct, 1e-9),
      `${shareA.pctOfCulture} vs ${profRow.sharePct}`,
    );
    check("поставщиков культуры двое", shareA.suppliersCount === 2);
    // Знаменатель сезона общий с профилем культуры (вынос season-total.ts): доля культуры
    // в сезоне, посчитанная профилем, обязана лечь на тот же seasonTotalKg.
    check(
      "знаменатель «доли в сезоне» общий с профилем культуры",
      near(
        (profile!.kpi.acceptedTons * 1000) / a1.share.seasonTotalKg * 100,
        profile!.kpi.seasonSharePct!,
        1e-6,
      ),
      `${a1.share.seasonTotalKg}`,
    );

    // ---------- Фаза 6: ритм ----------
    console.log("\n6) Ритм поставок");
    const daysExpected = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - WEEK[3].getTime()) / 86_400_000,
    );
    check(
      "последняя поставка — 05.08 (неделя 32)",
      a1.rhythm.lastDeliveryDate === iso(WEEK[3]),
      String(a1.rhythm.lastDeliveryDate),
    );
    check(
      "«дней с последней поставки» считается от todayLocalISO()",
      a1.rhythm.daysSinceLast === daysExpected,
      `${a1.rhythm.daysSinceLast} vs ${daysExpected}`,
    );
    check(
      "интервалы между днями с приёмкой — по 7, медиана 7",
      a1.rhythm.medianIntervalDays === 7 &&
        a1.rhythm.intervalsDays.every((d) => d === 7),
      JSON.stringify(a1.rhythm.intervalsDays),
    );
    check("рейсов за сезон — шесть", a1.rhythm.tripsInPeriod === 6);
    check("недель с приёмкой четыре → график показывается", a1.notes.chartReady === true);

    // ---------- Фаза 7: период ----------
    console.log("\n7) Период: что меняется, а что нет");
    const week30 = await getFarmerAnalytics({
      farmerId: f1.id,
      season,
      period: "week",
      from: iso(WEEK[1]),
    });
    check(
      "«Принято за период» сузилось до недели 30 (10 т огурцов + 4 т патиссонов)",
      near(week30!.kpi.periodAcceptedKg, 14_000),
      String(week30!.kpi.periodAcceptedKg),
    );
    check("рейсов за период — два", week30!.rhythm.tripsInPeriod === 2);
    check(
      "выполнение НЕ изменилось (сезонное)",
      near(week30!.kpi.executionPct, a1.kpi.executionPct!, 1e-9),
    );
    check("осталось машин НЕ изменилось (сезонное)", week30!.kpi.remainingTrips === 5);
    check(
      "средние веса рейса НЕ изменились (сезонные)",
      near(week30!.kpi.avgTripActualKg, a1.kpi.avgTripActualKg!, 1e-9) &&
        near(week30!.kpi.avgTripPlanKg, a1.kpi.avgTripPlanKg!, 1e-9),
    );
    check(
      "ритм: медиана и последняя поставка остались сезонными",
      week30!.rhythm.medianIntervalDays === 7 &&
        week30!.rhythm.lastDeliveryDate === iso(WEEK[3]),
    );

    // ---------- Фаза 8: пустой период (стейдж C2) ----------
    console.log("\n8) Период без поставок");
    const week33 = await getFarmerAnalytics({
      farmerId: f1.id,
      season,
      period: "week",
      from: iso(WEEK[4]),
    });
    check("период помечен пустым", week33!.notes.periodEmpty === true);
    check("темп не выдуман (null, не 0)", week33!.kpi.tempTonsPerWeek === null);
    check(
      "подсказка ведёт на ближайшую неделю с приёмкой — понедельник W32",
      week33!.notes.nearestWeekWithData?.anchor === "2026-08-03",
      JSON.stringify(week33!.notes.nearestWeekWithData),
    );
    check(
      "и в ней 1 рейс на 5 т",
      week33!.notes.nearestWeekWithData?.trips === 1 &&
        near(week33!.notes.nearestWeekWithData?.tons, 5),
    );
    check(
      "сезонные метрики в пустом периоде остались видны",
      week33!.kpi.remainingTrips === 5 && week33!.kpi.executionPct != null,
    );

    // ---------- Фаза 9: фермер без контрактов (стейдж C1) ----------
    console.log("\n9) Фермер без контрактов");
    const noContract = await getFarmerAnalytics({ farmerId: f3.id, season });
    check("контрактов нет — флаг выставлен", noContract!.notes.hasContracts === false);
    check(
      "выполнение и прогноз — прочерки, а не нули",
      noContract!.kpi.executionPct === null && noContract!.kpi.remainingTrips === null,
    );
    check(
      "принятое и ритм при этом считаются",
      near(noContract!.kpi.periodAcceptedKg, 6_000) &&
        noContract!.rhythm.medianIntervalDays === 14,
      `${noContract!.kpi.periodAcceptedKg} · ${noContract!.rhythm.medianIntervalDays}`,
    );
    check("доля в сезоне посчитана", noContract!.share.seasonPct != null);

    // ---------- Фаза 10: RBAC ----------
    console.log("\n10) Гард чтения");
    globalThis.__TEST_USER__ = null;
    let denied = false;
    try {
      await getFarmerAnalytics({ farmerId: f1.id, season });
    } catch (e) {
      denied = (e as Error).name === "AuthError";
    }
    check("без сессии загрузчик бросает AuthError", denied);
    globalThis.__TEST_USER__ = { id: "1", role: "user" };
    const asUser = await getFarmerAnalytics({ farmerId: f1.id, season });
    check("роль user вкладку читает (гард — факт аутентификации)", asUser != null);
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
