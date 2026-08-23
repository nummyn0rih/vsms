import { describe, expect, it } from "vitest";

import type { CultureItemFull } from "@/server/analytics/culture-items";
import { buildFarmerQuality, type QualityCultureInput } from "./quality-agg";

// Инварианты вкладки «Качество»: два РАЗНЫХ набора позиций в одной строке (он / остальные),
// пороги показа (позиция при M ≥ 3, график при 4 неделях, выброс при 4 партиях) и итог,
// который считается только по культурам с базой сравнения. Формулы здесь не проверяются —
// они покрыты accepted.test.ts и culture.test.ts; сверка с реальной БД — в
// scripts/farmer-quality-verify.ts.

const SEASON = 2026;
const TODAY = "2026-08-23";
const ME = 1;

// Среды подряд: неделя 29, 30, 31, 32.
const W = (n: number) => new Date(`2026-07-${String(15 + 7 * n).padStart(2, "0")}T00:00:00Z`);

const CAT = {
  ok: { label: "6–9 см", isAccepted: true, minCm: 6, maxCm: 9, rangeId: 3 },
  big: { label: ">12 см", isAccepted: false, minCm: 12, maxCm: null, rangeId: 2 },
} as const;

function cal(cat: (typeof CAT)[keyof typeof CAT], percent: number) {
  return { ...cat, percent };
}

let seq = 0;
function item(
  p: Partial<CultureItemFull> & { actualKg: number | null },
): CultureItemFull {
  seq += 1;
  return {
    shipmentId: p.shipmentId ?? seq,
    farmerId: p.farmerId ?? ME,
    farmerName: p.farmerName ?? "Ф1",
    arrival: p.arrival !== undefined ? p.arrival : W(0),
    actualKg: p.actualKg,
    brakPercent: p.brakPercent !== undefined ? p.brakPercent : null,
    settlementPercent: p.settlementPercent !== undefined ? p.settlementPercent : null,
    calibres: p.calibres ?? [],
    itemId: p.itemId ?? seq,
    cultureId: p.cultureId ?? 10,
    actNumber: p.actNumber !== undefined ? p.actNumber : `А-${seq}`,
    date: p.date !== undefined ? p.date : "2026-07-15",
  };
}

function culture(
  p: Partial<QualityCultureInput["culture"]> & { id: number },
  items: CultureItemFull[],
  contractTons: number | null = null,
): QualityCultureInput {
  return {
    culture: {
      id: p.id,
      name: p.name ?? `Культура ${p.id}`,
      color: p.color ?? "#2F9E44",
      acceptanceType: p.acceptanceType ?? "simple",
    },
    contractTons,
    items,
  };
}

function build(cultures: QualityCultureInput[], positionsTotal?: number) {
  return buildFarmerQuality({
    farmer: { id: ME, name: "Ферма «Заречье»" },
    season: SEASON,
    generatedAt: TODAY,
    positionsTotal:
      positionsTotal ?? cultures.reduce((s, c) => s + c.items.length, 0),
    cultures,
  });
}

describe("бенчмарк: он и остальные — РАЗНЫЕ наборы позиций", () => {
  // Он: 10 000 кг брак 6%. Остальные: 8 000 кг брак 2% + 4 000 кг брак 5%.
  const items = [
    item({ actualKg: 10000, brakPercent: 6 }),
    item({ actualKg: 8000, farmerId: 2, farmerName: "Ф2", brakPercent: 2 }),
    item({ actualKg: 4000, farmerId: 3, farmerName: "Ф3", brakPercent: 5 }),
  ];
  const c = build([culture({ id: 10 }, items)]).cultures[0];

  it("брак фермера считается только по его позициям", () => {
    expect(c.brakPct).toBeCloseTo(6, 9);
  });

  it("брак остальных — по позициям БЕЗ него, взвешенно", () => {
    expect(c.othersBrakPct).toBeCloseTo((8000 * 2 + 4000 * 5) / 12000, 9);
  });

  it("сам фермер из базы бенчмарка исключён: его 6% в неё не входят", () => {
    // Если бы фермер попал в базу, брак остальных был бы (10000×6+8000×2+4000×5)/22000 = 4,36%.
    expect(c.othersBrakPct).not.toBeCloseTo((10000 * 6 + 8000 * 2 + 4000 * 5) / 22000, 6);
  });

  it("Δ — разница в п.п., знак «хуже» положительный", () => {
    expect(c.deltaPp).toBeCloseTo(6 - (8000 * 2 + 4000 * 5) / 12000, 9);
    expect(c.deltaPp!).toBeGreaterThan(0);
  });

  it("единственный поставщик: база пуста → «у остальных» и Δ равны null", () => {
    const solo = build([culture({ id: 10 }, [item({ actualKg: 5000, brakPercent: 3 })])]);
    expect(solo.cultures[0].othersBrakPct).toBeNull();
    expect(solo.cultures[0].deltaPp).toBeNull();
    expect(solo.cultures[0].brakPct).toBeCloseTo(3, 9);
  });
});

describe("позиция по культуре", () => {
  const peer = (farmerId: number, brak: number) =>
    item({ actualKg: 1000, farmerId, farmerName: `Ф${farmerId}`, brakPercent: brak });

  it("null при двух поставщиках: «2 из 2» — не рейтинг, а шум", () => {
    const c = build([
      culture({ id: 10 }, [item({ actualKg: 1000, brakPercent: 5 }), peer(2, 3)]),
    ]).cultures[0];
    expect(c.rank).toBeNull();
    expect(c.suppliersWithBrak).toBe(2);
    // Δ при этом показывается — сравнение с одним соседом осмысленно, рейтинг нет.
    expect(c.deltaPp).not.toBeNull();
  });

  it("при трёх и более: меньше брак — лучше место", () => {
    const c = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, brakPercent: 4 }),
        peer(2, 2),
        peer(3, 9),
      ]),
    ]).cultures[0];
    expect(c.rank).toEqual({ position: 2, of: 3 });
  });

  it("лучший брак даёт первое место, худший — последнее", () => {
    const best = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, brakPercent: 1 }),
        peer(2, 4),
        peer(3, 9),
      ]),
    ]).cultures[0];
    expect(best.rank).toEqual({ position: 1, of: 3 });

    const worst = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, brakPercent: 12 }),
        peer(2, 4),
        peer(3, 9),
      ]),
    ]).cultures[0];
    expect(worst.rank).toEqual({ position: 3, of: 3 });
  });

  it("поставщики без вычислимого брака в M не входят", () => {
    const c = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, brakPercent: 4 }),
        peer(2, 2),
        // без перевески — брак не вычислим, в рейтинг не идёт
        item({ actualKg: null, farmerId: 4, farmerName: "Ф4", brakPercent: 1 }),
      ]),
    ]).cultures[0];
    expect(c.suppliersWithBrak).toBe(2);
    expect(c.rank).toBeNull();
  });
});

describe("итоговый вердикт", () => {
  const rival = (cultureId: number, brak: number) =>
    item({ actualKg: 10000, cultureId, farmerId: 2, farmerName: "Ф2", brakPercent: brak });

  it("«same» при |Δ| < 0,5 п.п.", () => {
    const q = build([
      culture({ id: 10 }, [
        item({ actualKg: 10000, cultureId: 10, brakPercent: 3.4 }),
        rival(10, 3.1),
      ]),
    ]);
    expect(q.totals.benchmark.verdict).toBe("same");
    expect(q.totals.benchmark.basedOnCultures).toBe(1);
  });

  it("«worse» / «better» по знаку взвешенной дельты", () => {
    const worse = build([
      culture({ id: 10 }, [
        item({ actualKg: 10000, cultureId: 10, brakPercent: 6 }),
        rival(10, 3),
      ]),
    ]);
    expect(worse.totals.benchmark.verdict).toBe("worse");

    const better = build([
      culture({ id: 10 }, [
        item({ actualKg: 10000, cultureId: 10, brakPercent: 1 }),
        rival(10, 5),
      ]),
    ]);
    expect(better.totals.benchmark.verdict).toBe("better");
  });

  it("null, когда базы сравнения нет ни в одной культуре", () => {
    const q = build([
      culture({ id: 10 }, [item({ actualKg: 10000, cultureId: 10, brakPercent: 7 })]),
    ]);
    expect(q.totals.benchmark.verdict).toBeNull();
    expect(q.totals.benchmark.basedOnCultures).toBe(0);
  });

  it("basedOnCultures считает только культуры С базой; культура без неё в вердикт не идёт", () => {
    const q = build([
      culture({ id: 10 }, [
        item({ actualKg: 10000, cultureId: 10, brakPercent: 6 }),
        rival(10, 3),
      ]),
      // вторая культура — он единственный поставщик, сравнивать не с кем
      culture({ id: 20 }, [item({ actualKg: 9000, cultureId: 20, brakPercent: 0.1 })]),
    ]);
    expect(q.totals.benchmark.basedOnCultures).toBe(1);
    // Если бы культура без базы участвовала, её −0,1 п.п. утянуло бы вердикт к «same».
    expect(q.totals.benchmark.verdict).toBe("worse");
  });

  it("итог таблицы сходится с KPI тождественно", () => {
    const q = build([
      culture({ id: 10 }, [item({ actualKg: 10000, cultureId: 10, brakPercent: 5 })]),
      culture({ id: 20 }, [item({ actualKg: 4000, cultureId: 20, brakPercent: 1 })]),
    ]);
    expect(q.totals.acceptedKg).toBeCloseTo(q.kpi.acceptedKg, 9);
    expect(q.totals.brakPct).toBeCloseTo(q.kpi.avgBrakPct!, 9);
  });
});

describe("деградация графика по числу недель", () => {
  const weekly = (n: number) =>
    Array.from({ length: n }, (_, k) =>
      item({ actualKg: 1000, brakPercent: 2, arrival: W(k) }),
    );

  it("три недели с актами — графика нет", () => {
    const q = build([culture({ id: 10 }, weekly(3))]);
    expect(q.weeks).toHaveLength(3);
    expect(q.notes.weeksWithActs).toBe(3);
    expect(q.notes.chartReady).toBe(false);
  });

  it("четыре недели — график есть", () => {
    const q = build([culture({ id: 10 }, weekly(4))]);
    expect(q.notes.chartReady).toBe(true);
    expect(q.kpi.weeksWithActs).toBe(4);
  });

  it("позиции без даты прибытия в недели не идут вовсе", () => {
    const q = build([
      culture({ id: 10 }, [
        ...weekly(2),
        item({ actualKg: 5000, brakPercent: 3, arrival: null }),
      ]),
    ]);
    expect(q.weeks).toHaveLength(2);
    // ...но в KPI и в принятый вес входят: сезон определяется другой датой.
    expect(q.kpi.actsCount).toBe(3);
  });

  it("неделя несёт свой брак и число партий", () => {
    const q = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, brakPercent: 10, arrival: W(0) }),
        item({ actualKg: 3000, brakPercent: 2, arrival: W(0) }),
        item({ actualKg: 1000, brakPercent: 4, arrival: W(1) }),
      ]),
    ]);
    expect(q.weeks[0].positions).toBe(2);
    expect(q.weeks[0].brakPct).toBeCloseTo((1000 * 10 + 3000 * 2) / 4000, 9);
    expect(q.weeks[1].brakPct).toBeCloseTo(4, 9);
  });
});

describe("подсветка выбросов в партиях", () => {
  it("не срабатывает при менее чем четырёх партиях в культуре", () => {
    const q = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, brakPercent: 20 }), // втрое выше среднего
        item({ actualKg: 1000, brakPercent: 1 }),
        item({ actualKg: 1000, brakPercent: 1 }),
      ]),
    ]);
    expect(q.cultures[0].batches.every((b) => !b.outlier)).toBe(true);
  });

  it("при четырёх партиях помечает те, что ≥ 1,5× среднего брака фермера", () => {
    const q = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, brakPercent: 12, actNumber: "А-1150" }),
        item({ actualKg: 1000, brakPercent: 2 }),
        item({ actualKg: 1000, brakPercent: 2 }),
        item({ actualKg: 1000, brakPercent: 2 }),
      ]),
    ]);
    const flagged = q.cultures[0].batches.filter((b) => b.outlier);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].actNumber).toBe("А-1150");
  });

  it("ровный брак не даёт выбросов", () => {
    const q = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, brakPercent: 3 }),
        item({ actualKg: 1000, brakPercent: 3 }),
        item({ actualKg: 1000, brakPercent: 3 }),
        item({ actualKg: 1000, brakPercent: 3 }),
      ]),
    ]);
    expect(q.cultures[0].batches.every((b) => !b.outlier)).toBe(true);
  });

  it("партии отсортированы по дате убыв.", () => {
    const q = build([
      culture({ id: 10 }, [
        item({ actualKg: 1000, date: "2026-07-10", actNumber: "стар" }),
        item({ actualKg: 1000, date: "2026-08-20", actNumber: "нов" }),
      ]),
    ]);
    expect(q.cultures[0].batches.map((b) => b.actNumber)).toEqual(["нов", "стар"]);
  });
});

describe("simple и calibre", () => {
  it("simple: «не в зачёт» = null, категории вырождаются в «Принято / Брак»", () => {
    const q = build([
      culture({ id: 10, acceptanceType: "simple" }, [
        item({ actualKg: 10000, brakPercent: 4 }),
      ]),
    ]);
    const c = q.cultures[0];
    expect(c.nonStandardPct).toBeNull();
    expect(c.categories.map((x) => x.label)).toEqual(["Принято", "Брак"]);
    expect(q.notes.hasCalibre).toBe(false);
  });

  it("calibre: «не в зачёт» — Σ непринятых категорий, брак в неё не входит", () => {
    const q = build([
      culture({ id: 10, acceptanceType: "calibre" }, [
        item({
          actualKg: 10000,
          brakPercent: 3,
          calibres: [cal(CAT.ok, 87), cal(CAT.big, 10)],
        }),
      ]),
    ]);
    expect(q.cultures[0].nonStandardPct).toBeCloseTo(10, 9);
    expect(q.notes.hasCalibre).toBe(true);
  });
});

describe("состав листа", () => {
  it("Σ принятого по культурам = kpi.acceptedKg", () => {
    const q = build([
      culture({ id: 10 }, [item({ actualKg: 10000, cultureId: 10, brakPercent: 5 })]),
      culture({ id: 20 }, [item({ actualKg: 4000, cultureId: 20, brakPercent: 10 })]),
      culture({ id: 30 }, [item({ actualKg: 2000, cultureId: 30 })]),
    ]);
    const sum = q.cultures.reduce((s, c) => s + c.acceptedKg, 0);
    expect(sum).toBeCloseTo(q.kpi.acceptedKg, 9);
    // принятый = факт × (1 − брак): 9 500 + 3 600 + 2 000
    expect(q.kpi.acceptedKg).toBeCloseTo(9500 + 3600 + 2000, 9);
  });

  it("культуры отсортированы по принятому объёму убыв.", () => {
    const q = build([
      culture({ id: 10, name: "Мало" }, [item({ actualKg: 1000, cultureId: 10 })]),
      culture({ id: 20, name: "Много" }, [item({ actualKg: 9000, cultureId: 20 })]),
    ]);
    expect(q.cultures.map((c) => c.name)).toEqual(["Много", "Мало"]);
  });

  it("культура со строкой контракта, но без актов: строка есть, значения — прочерки", () => {
    const q = build(
      [culture({ id: 30, name: "Перец" }, [], 40)],
      3, // поставки были, актов нет
    );
    const c = q.cultures[0];
    expect(c.contractTons).toBe(40);
    expect(c.acceptedKg).toBe(0);
    expect(c.brakPct).toBeNull();
    expect(c.othersBrakPct).toBeNull(); // у остальных актов тоже нет
    expect(c.rank).toBeNull();
    expect(c.batches).toEqual([]);
    expect(q.kpi.actsCount).toBe(0);
    expect(q.kpi.positionsTotal).toBe(3);
    expect(q.kpi.avgBrakPct).toBeNull();
  });

  it("начало сезона: у остальных акты ЕСТЬ → ориентир показывается, Δ всё равно нет", () => {
    const q = build([
      culture({ id: 30, name: "Перец" }, [
        item({ actualKg: 6000, cultureId: 30, farmerId: 2, farmerName: "Ф2", brakPercent: 3 }),
      ]),
    ]);
    const c = q.cultures[0];
    expect(c.othersBrakPct).toBeCloseTo(3, 9);
    expect(c.brakPct).toBeNull();
    expect(c.deltaPp).toBeNull();
  });

  it("фермер без культур сезона: лист пуст, но не сломан", () => {
    const q = build([], 0);
    expect(q.cultures).toEqual([]);
    expect(q.kpi.acceptedKg).toBe(0);
    expect(q.kpi.avgBrakPct).toBeNull();
    expect(q.totals.benchmark.verdict).toBeNull();
    expect(q.notes.chartReady).toBe(false);
    expect(Number.isFinite(q.kpi.acceptedKg)).toBe(true);
  });

  it("доля в культуре — от принятого веса культуры целиком", () => {
    const q = build([
      culture({ id: 10 }, [
        item({ actualKg: 6000, cultureId: 10 }),
        item({ actualKg: 4000, cultureId: 10, farmerId: 2, farmerName: "Ф2" }),
      ]),
    ]);
    expect(q.cultures[0].sharePct).toBeCloseTo(60, 9);
  });
});
