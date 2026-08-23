import { describe, expect, it } from "vitest";

import type { CultureItemFull } from "@/server/analytics/culture-items";
import {
  KPI_SCOPE,
  buildFarmerAnalytics,
  type AnalyticsCultureInput,
} from "./analytics-agg";
import { resolveSettlementPeriod } from "./settlement-period";

// Инварианты вкладки «Аналитика»: прогноз машин («нет плана» ≠ «мало принял», перевыполнение
// → 0, база факт с fallback на норму), разделение сезонных и периодных величин, ритм от дат
// прибытия и пустые состояния, которые считает ЯДРО. Формулы принятого веса здесь не
// проверяются — они покрыты accepted.test.ts; сверка с БД — scripts/farmer-analytics-verify.ts.

const SEASON = 2026;
const TODAY = "2026-08-23";
const ME = 1;
const OTHER = 2;
const DAY_MS = 86_400_000;

// Среды подряд: W29 (15.07), W30, W31, W32, W33, W34.
const BASE = Date.UTC(2026, 6, 15);
const W = (n: number) => new Date(BASE + n * 7 * DAY_MS);
const ISO = (d: Date) => d.toISOString().slice(0, 10);

const SEASON_PERIOD = resolveSettlementPeriod({ season: SEASON, today: TODAY });
const weekPeriod = (anchor: string) =>
  resolveSettlementPeriod({ period: "week", from: anchor, season: SEASON, today: TODAY });

let seq = 0;
function item(
  p: Partial<CultureItemFull> & { actualKg: number | null },
): CultureItemFull {
  seq += 1;
  const arrival = p.arrival !== undefined ? p.arrival : W(0);
  return {
    shipmentId: p.shipmentId ?? seq,
    farmerId: p.farmerId ?? ME,
    farmerName: p.farmerName ?? "Ф1",
    arrival,
    actualKg: p.actualKg,
    brakPercent: p.brakPercent !== undefined ? p.brakPercent : null,
    settlementPercent: p.settlementPercent !== undefined ? p.settlementPercent : null,
    calibres: p.calibres ?? [],
    itemId: p.itemId ?? seq,
    cultureId: p.cultureId ?? 10,
    actNumber: p.actNumber !== undefined ? p.actNumber : `А-${seq}`,
    date: p.date !== undefined ? p.date : arrival ? ISO(arrival) : null,
  };
}

function culture(
  p: { id: number; name?: string; color?: string },
  items: CultureItemFull[],
  opts: {
    lines?: { volumeTons: number; acceptedKg: number }[];
    planTripKg?: number | null;
  } = {},
): AnalyticsCultureInput {
  return {
    culture: {
      id: p.id,
      name: p.name ?? `Культура ${p.id}`,
      color: p.color ?? "#2F9E44",
    },
    items,
    lines: (opts.lines ?? []).map((l, k) => ({
      lineId: p.id * 100 + k,
      volumeTons: l.volumeTons,
      acceptedKg: l.acceptedKg,
      targetKg: l.volumeTons * 1000,
    })),
    planTripKg: opts.planTripKg ?? null,
  };
}

function build(
  cultures: AnalyticsCultureInput[],
  opts: { period?: typeof SEASON_PERIOD; seasonTotalKg?: number } = {},
) {
  return buildFarmerAnalytics({
    farmer: { id: ME, name: "Ферма «Заречье»" },
    season: SEASON,
    generatedAt: TODAY,
    period: opts.period ?? SEASON_PERIOD,
    positionsTotal: cultures.reduce(
      (s, c) => s + c.items.filter((i) => i.farmerId === ME).length,
      0,
    ),
    cultures,
    seasonTotalKg: opts.seasonTotalKg ?? 100_000,
  });
}

const rowOf = (r: ReturnType<typeof build>, cultureId: number) =>
  r.remaining.find((x) => x.cultureId === cultureId)!;

describe("прогноз «осталось ~N машин»", () => {
  it("без строки контракта все прогнозные поля null, а принятое считается", () => {
    const r = build([culture({ id: 10 }, [item({ actualKg: 3800 })])]);
    const row = rowOf(r, 10);
    expect(row.lineTons).toBeNull();
    expect(row.remainingKg).toBeNull();
    expect(row.trips).toBeNull();
    // «нет плана» ≠ «мало принял»: объём есть, прогнозировать нечего
    expect(row.acceptedKg).toBe(3800);
    expect(r.kpi.remainingTrips).toBeNull();
    expect(r.notes.hasContracts).toBe(false);
  });

  it("перевыполнение даёт 0 машин, а не отрицательное число", () => {
    const r = build([
      culture({ id: 10 }, [item({ actualKg: 3000 })], {
        lines: [{ volumeTons: 10, acceptedKg: 12_000 }],
      }),
    ]);
    const row = rowOf(r, 10);
    expect(row.remainingKg).toBe(0);
    expect(row.trips).toBe(0);
    expect(r.kpi.remainingTrips).toBe(0);
  });

  it("остаток делится на средний рейс с округлением ВВЕРХ (машина неделима)", () => {
    // два перевешенных рейса 3000 и 3200 → средний 3100; остаток 38 000 − 28 600 = 9400
    const r = build([
      culture(
        { id: 10 },
        [
          item({ actualKg: 3000, shipmentId: 91 }),
          item({ actualKg: 3200, shipmentId: 92 }),
        ],
        { lines: [{ volumeTons: 38, acceptedKg: 28_600 }] },
      ),
    ]);
    const row = rowOf(r, 10);
    expect(row.avgTripKg).toBe(3100);
    expect(row.remainingKg).toBe(9400);
    expect(row.trips).toBe(4); // 9400/3100 = 3,03 → 4, а не 3
  });

  it("итог машин = Σ по строкам, культура без контракта в него не входит", () => {
    const r = build([
      culture({ id: 10 }, [item({ actualKg: 3000, shipmentId: 91 })], {
        lines: [{ volumeTons: 10, acceptedKg: 4000 }],
      }),
      culture({ id: 20 }, [item({ actualKg: 2000, shipmentId: 92, cultureId: 20 })], {
        lines: [{ volumeTons: 8, acceptedKg: 2000 }],
      }),
      culture({ id: 30 }, [item({ actualKg: 1000, shipmentId: 93, cultureId: 30 })]),
    ]);
    expect(rowOf(r, 10).trips).toBe(2); // 6000/3000
    expect(rowOf(r, 20).trips).toBe(3); // 6000/2000
    expect(rowOf(r, 30).trips).toBeNull();
    expect(r.kpi.remainingTrips).toBe(5);
  });

  it("«Принято» строки со строкой контракта — контрактная база, а не всё принятое", () => {
    // позиции дают 5000 кг, но к строке привязано 4000 — в таблице должно стоять 4000,
    // иначе «Строка − Принято = Осталось» не сойдётся глазами
    const r = build([
      culture({ id: 10 }, [item({ actualKg: 5000 })], {
        lines: [{ volumeTons: 10, acceptedKg: 4000 }],
      }),
    ]);
    expect(rowOf(r, 10).acceptedKg).toBe(4000);
    expect(rowOf(r, 10).remainingKg).toBe(6000);
  });

  it("нет контрактов: выполнение и прогноз — null, а принято/ритм/доля считаются", () => {
    const r = build([
      culture({ id: 10 }, [
        item({ actualKg: 3000, arrival: W(0) }),
        item({ actualKg: 3200, shipmentId: 99, arrival: W(1) }),
      ]),
    ]);
    expect(r.kpi.executionPct).toBeNull();
    expect(r.kpi.remainingTrips).toBeNull();
    expect(r.kpi.periodAcceptedKg).toBe(6200);
    expect(r.rhythm.tripsInPeriod).toBe(2);
    expect(r.share.seasonPct).toBeCloseTo(6.2, 6);
  });
});

describe("база прогноза: факт, при его отсутствии — норма рейса", () => {
  it("нет перевешенных рейсов → берётся TripWeightNorm", () => {
    const r = build([
      culture({ id: 10 }, [item({ actualKg: null })], {
        lines: [{ volumeTons: 9, acceptedKg: 0 }],
        planTripKg: 3000,
      }),
    ]);
    const row = rowOf(r, 10);
    expect(row.avgTripSource).toBe("norm");
    expect(row.avgTripKg).toBe(3000);
    expect(row.trips).toBe(3); // начало сезона: прогноз есть, а не прочерк
  });

  it("есть перевеска → база фактическая, норма игнорируется", () => {
    const r = build([
      culture({ id: 10 }, [item({ actualKg: 2000 })], {
        lines: [{ volumeTons: 10, acceptedKg: 2000 }],
        planTripKg: 5000,
      }),
    ]);
    expect(rowOf(r, 10).avgTripSource).toBe("actual");
    expect(rowOf(r, 10).avgTripKg).toBe(2000);
  });

  it("нет ни факта, ни нормы → база null и прогноз null, но не 0", () => {
    const r = build([
      culture({ id: 10 }, [item({ actualKg: null })], {
        lines: [{ volumeTons: 9, acceptedKg: 0 }],
      }),
    ]);
    const row = rowOf(r, 10);
    expect(row.avgTripKg).toBeNull();
    expect(row.avgTripSource).toBeNull();
    expect(row.trips).toBeNull();
    expect(r.kpi.remainingTrips).toBeNull();
  });
});

describe("средний плановый вес рейса (взвешенный)", () => {
  it("взвешивается принятым объёмом культур", () => {
    const r = build([
      culture({ id: 10 }, [item({ actualKg: 30_000 })], { planTripKg: 3000 }),
      culture({ id: 20 }, [item({ actualKg: 10_000, cultureId: 20 })], {
        planTripKg: 2000,
      }),
    ]);
    // (3000×30000 + 2000×10000) / 40000
    expect(r.kpi.avgTripPlanKg).toBe(2750);
  });

  it("нет нормы хотя бы у одной культуры с объёмом → null целиком", () => {
    const r = build([
      culture({ id: 10 }, [item({ actualKg: 30_000 })], { planTripKg: 3000 }),
      culture({ id: 20 }, [item({ actualKg: 10_000, cultureId: 20 })]),
    ]);
    expect(r.kpi.avgTripPlanKg).toBeNull();
  });

  it("культура без объёма норму не требует", () => {
    const r = build([
      culture({ id: 10 }, [item({ actualKg: 30_000 })], { planTripKg: 3000 }),
      culture({ id: 20 }, [], { lines: [{ volumeTons: 5, acceptedKg: 0 }] }),
    ]);
    expect(r.kpi.avgTripPlanKg).toBe(3000);
  });

  it("принятого нет вовсе → взвешивать нечем, null", () => {
    const r = build([culture({ id: 10 }, [], { planTripKg: 3000 })]);
    expect(r.kpi.avgTripPlanKg).toBeNull();
  });
});

describe("сезонное против периодного", () => {
  const cultures = () => [
    culture(
      { id: 10 },
      [
        item({ actualKg: 3000, shipmentId: 91, arrival: W(0) }),
        item({ actualKg: 2000, shipmentId: 92, arrival: W(1) }),
      ],
      { lines: [{ volumeTons: 10, acceptedKg: 5000 }], planTripKg: 4000 },
    ),
  ];

  it("выполнение, машины и веса рейса не зависят от периода", () => {
    const season = build(cultures());
    const week = build(cultures(), { period: weekPeriod(ISO(W(0))) });
    for (const key of ["executionPct", "remainingTrips", "avgTripPlanKg", "avgTripActualKg"] as const) {
      expect(week.kpi[key]).toEqual(season.kpi[key]);
    }
    expect(week.share).toEqual(season.share);
    expect(week.remaining).toEqual(season.remaining);
  });

  it("принято, темп и рейсы за период — меняются", () => {
    const season = build(cultures());
    const week = build(cultures(), { period: weekPeriod(ISO(W(0))) });
    expect(season.kpi.periodAcceptedKg).toBe(5000);
    expect(week.kpi.periodAcceptedKg).toBe(3000);
    expect(season.rhythm.tripsInPeriod).toBe(2);
    expect(week.rhythm.tripsInPeriod).toBe(1);
    expect(week.kpi.tempTonsPerWeek).toBe(3);
  });

  it("карта скоупов покрывает все KPI", () => {
    const r = build(cultures());
    expect(Object.keys(KPI_SCOPE).sort()).toEqual(Object.keys(r.kpi).sort());
    expect(KPI_SCOPE.executionPct).toBe("season");
    expect(KPI_SCOPE.periodAcceptedKg).toBe("period");
  });

  it("выполнение = Σ принятого строк / Σ плана строк", () => {
    const r = build([
      culture({ id: 10 }, [], { lines: [{ volumeTons: 10, acceptedKg: 5000 }] }),
      culture({ id: 20 }, [], { lines: [{ volumeTons: 30, acceptedKg: 23_000 }] }),
    ]);
    expect(r.kpi.executionPct).toBeCloseTo((28_000 / 40_000) * 100, 6);
  });
});

describe("пустой период", () => {
  it("периода без поставок хватает для флага и подсказки о ближайшей неделе", () => {
    const r = build(
      [
        culture({ id: 10 }, [
          item({ actualKg: 3000, shipmentId: 91, arrival: W(2) }),
          item({ actualKg: 4400, shipmentId: 92, arrival: W(2) }),
        ]),
      ],
      { period: weekPeriod(ISO(W(3))) },
    );
    expect(r.notes.periodEmpty).toBe(true);
    expect(r.kpi.periodAcceptedKg).toBe(0);
    expect(r.kpi.tempTonsPerWeek).toBeNull();
    const near = r.notes.nearestWeekWithData!;
    expect(near.trips).toBe(2);
    expect(near.tons).toBeCloseTo(7.4, 6);
    expect(near.anchor).toBe("2026-07-27"); // понедельник W31
    expect(near.label).toContain("Неделя 31");
  });

  it("при равном удалении выигрывает прошлая неделя", () => {
    const r = build(
      [
        culture({ id: 10 }, [
          item({ actualKg: 1000, shipmentId: 91, arrival: W(2) }), // W31, до периода
          item({ actualKg: 9000, shipmentId: 92, arrival: W(4) }), // W33, после периода
        ]),
      ],
      { period: weekPeriod(ISO(W(3))) },
    );
    expect(r.notes.nearestWeekWithData!.anchor).toBe("2026-07-27");
  });

  it("в сезонном периоде подсказки нет — сезон и так включает всё", () => {
    const r = build([culture({ id: 10 }, [])]);
    expect(r.notes.periodEmpty).toBe(true);
    expect(r.notes.nearestWeekWithData).toBeUndefined();
  });

  it("период с поставками пустым не считается", () => {
    const r = build([culture({ id: 10 }, [item({ actualKg: 1000, arrival: W(0) })])], {
      period: weekPeriod(ISO(W(0))),
    });
    expect(r.notes.periodEmpty).toBe(false);
  });
});

describe("ритм поставок", () => {
  const trips = (offsets: number[]) =>
    offsets.map((d, k) =>
      item({
        actualKg: 1000,
        shipmentId: 500 + k,
        arrival: new Date(BASE + d * DAY_MS),
      }),
    );

  it("медиана на нечётном числе интервалов — средний элемент", () => {
    // дни 0,4,10,14 → интервалы 4,6,4 → медиана 4
    const r = build([culture({ id: 10 }, trips([0, 4, 10, 14]))]);
    expect(r.rhythm.intervalsDays).toEqual([4, 6, 4]);
    expect(r.rhythm.medianIntervalDays).toBe(4);
  });

  it("медиана на чётном числе интервалов — среднее двух средних", () => {
    // дни 0,3,9,12,20 → интервалы 3,6,3,8 → отсортировано 3,3,6,8 → (3+6)/2
    const r = build([culture({ id: 10 }, trips([0, 3, 9, 12, 20]))]);
    expect(r.rhythm.medianIntervalDays).toBe(4.5);
  });

  it("один рейс — медианы нет (null, не 0)", () => {
    const r = build([culture({ id: 10 }, trips([0]))]);
    expect(r.rhythm.medianIntervalDays).toBeNull();
    expect(r.rhythm.intervalsDays).toEqual([]);
    expect(r.rhythm.lastDeliveryDate).toBe(ISO(W(0)));
  });

  it("поставок нет — всё прочерки, рейсов ноль", () => {
    const r = build([culture({ id: 10 }, [])]);
    expect(r.rhythm.lastDeliveryDate).toBeNull();
    expect(r.rhythm.daysSinceLast).toBeNull();
    expect(r.rhythm.medianIntervalDays).toBeNull();
    expect(r.rhythm.tripsInPeriod).toBe(0);
  });

  it("две машины в один день — одно событие ритма, а не интервал 0", () => {
    const r = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, shipmentId: 91, arrival: W(0) }),
        item({ actualKg: 1000, shipmentId: 92, arrival: W(0) }),
        item({ actualKg: 1000, shipmentId: 93, arrival: W(1) }),
      ]),
    ]);
    expect(r.rhythm.intervalsDays).toEqual([7]);
    expect(r.rhythm.medianIntervalDays).toBe(7);
    expect(r.rhythm.tripsInPeriod).toBe(3); // рейсов всё-таки три
  });

  it("«дней с последней поставки» считается от generatedAt", () => {
    const r = build([culture({ id: 10 }, [item({ actualKg: 1000, arrival: W(1) })])]);
    // 22.07 → 23.08
    expect(r.rhythm.daysSinceLast).toBe(32);
  });

  it("рейсов в неделю считается по ВСЕЙ оси периода, с паузами", () => {
    // рейсы в W29 и W33: недель с поставками 2, длина оси 5
    const r = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, shipmentId: 91, arrival: W(0) }),
        item({ actualKg: 1000, shipmentId: 92, arrival: W(4) }),
      ]),
    ]);
    expect(r.weeks).toHaveLength(5);
    expect(r.rhythm.tripsPerWeek).toBeCloseTo(2 / 5, 6);
    // темп — по неделям С ПОСТАВКАМИ, знаменатель другой намеренно
    expect(r.kpi.tempTonsPerWeek).toBe(1);
  });
});

describe("недели и темп", () => {
  it("дырка в неделях появляется нулевой строкой и график не приближает", () => {
    const r = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, shipmentId: 91, arrival: W(0) }),
        item({ actualKg: 1000, shipmentId: 92, arrival: W(1) }),
        item({ actualKg: 1000, shipmentId: 93, arrival: W(2) }),
        item({ actualKg: 1000, shipmentId: 94, arrival: W(5) }),
      ]),
    ]);
    expect(r.weeks).toHaveLength(6);
    expect(r.weeks.map((w) => w.trips)).toEqual([1, 1, 1, 0, 0, 1]);
    expect(r.weeks[3].tons).toBe(0);
    expect(r.notes.chartReady).toBe(true); // недель С ДАННЫМИ ровно 4
  });

  it("порог графика — четыре недели с поставками", () => {
    const three = build([
      culture(
        { id: 10 },
        [0, 1, 2].map((n) =>
          item({ actualKg: 1000, shipmentId: 90 + n, arrival: W(n) }),
        ),
      ),
    ]);
    expect(three.notes.chartReady).toBe(false);
  });

  it("база недель — ПРИНЯТЫЙ вес, а не перевеска", () => {
    const r = build([
      culture({ id: 10 }, [item({ actualKg: 2000, brakPercent: 50, arrival: W(0) })]),
    ]);
    expect(r.weeks[0].tons).toBe(1);
    expect(r.kpi.periodAcceptedKg).toBe(1000);
  });

  it("серии недель разложены по культурам", () => {
    const r = build([
      culture({ id: 10 }, [item({ actualKg: 3000, shipmentId: 91, arrival: W(0) })]),
      culture({ id: 20 }, [
        item({ actualKg: 2000, shipmentId: 92, arrival: W(0), cultureId: 20 }),
      ]),
    ]);
    expect(r.weeks[0].byCulture).toEqual([
      { cultureId: 10, tons: 3 },
      { cultureId: 20, tons: 2 },
    ]);
    expect(r.weeks[0].tons).toBe(5);
  });

  it("каждая культура графика есть в таблице прогноза (легенда берётся оттуда)", () => {
    const r = build([
      culture({ id: 10 }, [item({ actualKg: 3000, arrival: W(0) })]),
      culture({ id: 20 }, [item({ actualKg: 2000, arrival: W(0), cultureId: 20 })]),
    ]);
    const known = new Set(r.remaining.map((x) => x.cultureId));
    for (const w of r.weeks) {
      for (const b of w.byCulture) expect(known.has(b.cultureId)).toBe(true);
    }
  });

  it("позиция без прибытия в недели не идёт, но в «Принято» идёт", () => {
    const r = build([
      culture({ id: 10 }, [
        item({ actualKg: 4000, arrival: null, date: "2026-07-16" }),
      ]),
    ]);
    expect(r.kpi.periodAcceptedKg).toBe(4000);
    expect(r.weeks).toHaveLength(0);
    // недель с поставками нет — темп не выдумываем
    expect(r.kpi.tempTonsPerWeek).toBeNull();
  });
});

describe("рейсы и доли", () => {
  it("две позиции одного рейса — одна машина", () => {
    const r = build([
      culture({ id: 10 }, [
        item({ actualKg: 2000, shipmentId: 77 }),
        item({ actualKg: 1000, shipmentId: 77 }),
      ]),
    ]);
    expect(r.rhythm.tripsInPeriod).toBe(1);
    expect(r.kpi.avgTripActualKg).toBe(3000); // вес рейса = Σ факта позиций
  });

  it("позиции чужого фермера не попадают ни в рейсы, ни в принятое", () => {
    const r = build([
      culture({ id: 10 }, [
        item({ actualKg: 2000, shipmentId: 77 }),
        item({ actualKg: 9000, shipmentId: 77, farmerId: OTHER, farmerName: "Ф2" }),
      ]),
    ]);
    expect(r.rhythm.tripsInPeriod).toBe(1);
    expect(r.kpi.periodAcceptedKg).toBe(2000);
    expect(r.kpi.avgTripActualKg).toBe(2000);
  });

  it("машина без перевески выпадает из базы среднего веса целиком", () => {
    const r = build([
      culture({ id: 10 }, [
        item({ actualKg: 3000, shipmentId: 91 }),
        item({ actualKg: null, shipmentId: 92 }),
      ]),
    ]);
    expect(r.kpi.avgTripActualKg).toBe(3000); // не 1500
  });

  it("общий средний вес рейса ≠ среднему из культурных при двухкультурном рейсе", () => {
    const shared = [
      item({ actualKg: 2000, shipmentId: 55 }),
      item({ actualKg: 1000, shipmentId: 55, cultureId: 20 }),
    ];
    const r = build([
      culture({ id: 10 }, [shared[0]]),
      culture({ id: 20 }, [shared[1]]),
    ]);
    expect(rowOf(r, 10).avgTripKg).toBe(2000);
    expect(rowOf(r, 20).avgTripKg).toBe(1000);
    expect(r.kpi.avgTripActualKg).toBe(3000); // один рейс на 3000, а не среднее 1500
  });

  it("доля в культуре считается против остальных поставщиков", () => {
    const r = build([
      culture({ id: 10 }, [
        item({ actualKg: 3000 }),
        item({ actualKg: 1000, farmerId: OTHER, farmerName: "Ф2" }),
      ]),
    ]);
    const s = r.share.byCulture[0];
    expect(s.pctOfCulture).toBeCloseTo(75, 6);
    expect(s.suppliersCount).toBe(2);
  });

  it("доля в сезоне: пустой знаменатель даёт null, а не NaN", () => {
    const r = build([culture({ id: 10 }, [item({ actualKg: 3000 })])], {
      seasonTotalKg: 0,
    });
    expect(r.share.seasonPct).toBeNull();
    expect(r.share.ownSeasonKg).toBe(3000);
  });

  it("доля в сезоне — принятое фермера к принятому всего сезона", () => {
    const r = build([culture({ id: 10 }, [item({ actualKg: 3000 })])], {
      seasonTotalKg: 12_000,
    });
    expect(r.share.seasonPct).toBeCloseTo(25, 6);
  });
});
