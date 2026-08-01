import { describe, expect, it } from "vitest";

import {
  aggregateCultureItems,
  categoryShares,
  type CultureItem,
} from "./culture-agg";

// Инварианты профиля культуры: доля поставщика (Σ = 100%), оплачиваемый вес (BR-33)
// и доли категорий калибра. Всё, что ходит в БД, — в scripts/culture-analytics-verify.ts.

const W = new Date("2026-07-15T00:00:00Z"); // среда, ISO-неделя 29

// Категории калибра фикстур. id намеренно вразнобой относительно размеров: порядок
// показа обязан идти от границ, а не от порядка ввода в форме культуры.
const CAT = {
  small: { label: "6–9 см", isAccepted: true, minCm: 6, maxCm: 9, rangeId: 3 },
  mid: { label: "9–12 см", isAccepted: true, minCm: 9, maxCm: 12, rangeId: 1 },
  big: { label: ">12 см", isAccepted: false, minCm: 12, maxCm: null, rangeId: 2 },
} as const;

function cal(cat: (typeof CAT)[keyof typeof CAT], percent: number) {
  return { ...cat, percent };
}

function item(p: Partial<CultureItem> & { actualKg: number | null }): CultureItem {
  return {
    shipmentId: p.shipmentId ?? 1,
    farmerId: p.farmerId ?? 1,
    farmerName: p.farmerName ?? "Ф1",
    arrival: p.arrival ?? W,
    actualKg: p.actualKg,
    brakPercent: p.brakPercent ?? null,
    settlementPercent: p.settlementPercent ?? null,
    calibres: p.calibres ?? [],
  };
}

const sumShare = (rows: { sharePct: number }[]) =>
  rows.reduce((s, r) => s + r.sharePct, 0);

describe("доля поставщика в культуре", () => {
  it("три поставщика: доли различаются и в сумме дают 100%", () => {
    const a = aggregateCultureItems([
      item({ actualKg: 12000, farmerId: 1 }),
      item({ actualKg: 5000, farmerId: 2, farmerName: "Ф2", shipmentId: 2 }),
      item({ actualKg: 3000, farmerId: 3, farmerName: "Ф3", shipmentId: 3 }),
    ]);
    expect(a.bySupplier.map((s) => s.sharePct)).toEqual([60, 25, 15]);
    expect(sumShare(a.bySupplier)).toBeCloseTo(100, 9);
  });

  it("доля считается от принятого, а не от фактического веса", () => {
    // Ф1: 10 000 кг брак 50% → принято 5 000. Ф2: 5 000 кг без брака → принято 5 000.
    // По факту 2:1, по принятому — поровну.
    const a = aggregateCultureItems([
      item({ actualKg: 10000, brakPercent: 50, farmerId: 1 }),
      item({ actualKg: 5000, farmerId: 2, farmerName: "Ф2", shipmentId: 2 }),
    ]);
    expect(a.bySupplier.map((s) => s.sharePct)).toEqual([50, 50]);
  });

  it("несколько позиций одного фермера складываются в одну строку", () => {
    const a = aggregateCultureItems([
      item({ actualKg: 4000, farmerId: 1 }),
      item({ actualKg: 6000, farmerId: 1, shipmentId: 2 }),
      item({ actualKg: 10000, farmerId: 2, farmerName: "Ф2", shipmentId: 3 }),
    ]);
    expect(a.bySupplier).toHaveLength(2);
    expect(sumShare(a.bySupplier)).toBeCloseTo(100, 9);
  });

  it("один поставщик → 100%", () => {
    const a = aggregateCultureItems([item({ actualKg: 8500 })]);
    expect(a.bySupplier).toHaveLength(1);
    expect(a.bySupplier[0].sharePct).toBe(100);
  });

  it("нулевой знаменатель (нет перевески) → 0 без деления на ноль", () => {
    const a = aggregateCultureItems([
      item({ actualKg: null, farmerId: 1 }),
      item({ actualKg: null, farmerId: 2, farmerName: "Ф2", shipmentId: 2 }),
    ]);
    expect(a.acceptedKgTotal).toBe(0);
    expect(a.bySupplier.map((s) => s.sharePct)).toEqual([0, 0]);
    expect(a.bySupplier.every((s) => Number.isFinite(s.sharePct))).toBe(true);
  });
});

describe("оплачиваемый вес поставщика (BR-33)", () => {
  it("без корректировки расчёта к оплате = принято", () => {
    const a = aggregateCultureItems([item({ actualKg: 10000, brakPercent: 5 })]);
    expect(a.bySupplier[0].paidKg).toBeCloseTo(9500, 9);
    expect(a.bySupplier[0].paidKg).toBe(a.bySupplier[0].acceptedKg);
  });

  it("settlement 95% при браке 9% → доплата 4% факта", () => {
    // живой кейс dev: факт 9850, принято 91% = 8963,5; доплата 4% = 394 → к оплате 9357,5
    const a = aggregateCultureItems([
      item({ actualKg: 9850, brakPercent: 9, settlementPercent: 95 }),
    ]);
    expect(a.bySupplier[0].acceptedKg).toBeCloseTo(8963.5, 9);
    expect(a.bySupplier[0].paidKg).toBeCloseTo(9357.5, 9);
  });

  it("доплата не попадает в принятый вес (тонны выполнения не растут)", () => {
    const withFix = aggregateCultureItems([
      item({ actualKg: 10000, brakPercent: 10, settlementPercent: 95 }),
    ]);
    const without = aggregateCultureItems([item({ actualKg: 10000, brakPercent: 10 })]);
    expect(withFix.acceptedKgTotal).toBe(without.acceptedKgTotal);
    expect(withFix.paidKgTotal).toBeGreaterThan(withFix.acceptedKgTotal);
  });

  it("settlement не выше принятого % → доплаты нет", () => {
    const a = aggregateCultureItems([
      item({ actualKg: 10000, brakPercent: 5, settlementPercent: 90 }),
    ]);
    expect(a.paidKgTotal).toBe(a.acceptedKgTotal);
  });

  it("Σ к оплате по поставщикам = paidKgTotal", () => {
    const a = aggregateCultureItems([
      item({ actualKg: 9850, brakPercent: 9, settlementPercent: 95, farmerId: 1 }),
      item({ actualKg: 5000, farmerId: 2, farmerName: "Ф2", shipmentId: 2 }),
    ]);
    expect(a.bySupplier.reduce((s, r) => s + r.paidKg, 0)).toBeCloseTo(a.paidKgTotal, 9);
  });
});

describe("доли категорий калибра", () => {
  it("calibre: категории + брак дают 100% факта", () => {
    const cats = categoryShares([
      item({
        actualKg: 10000,
        brakPercent: 8,
        // на входе — «9–12 · 6–9 · >12», как приходит из БД
        calibres: [cal(CAT.mid, 30), cal(CAT.small, 50), cal(CAT.big, 12)],
      }),
    ]);
    expect(cats.map((c) => c.label)).toEqual([
      "6–9 см",
      "9–12 см",
      ">12 см",
      "Брак",
    ]);
    expect(cats.reduce((s, c) => s + c.pct, 0)).toBeCloseTo(100, 9);
  });

  // Главный инвариант показа: порядок категорий размерный и не зависит ни от долей, ни от
  // is_accepted, ни от порядка строк в БД. Иначе у каждого фермера свой порядок колонок.
  it("порядок размерный: доли и is_accepted на него не влияют", () => {
    const order = (cats: { label: string }[]) => cats.map((c) => c.label);
    const big = categoryShares([
      item({ actualKg: 10000, calibres: [cal(CAT.big, 80), cal(CAT.small, 15), cal(CAT.mid, 5)] }),
    ]);
    const small = categoryShares([
      item({ actualKg: 10000, calibres: [cal(CAT.small, 80), cal(CAT.mid, 15), cal(CAT.big, 5)] }),
    ]);
    expect(order(big)).toEqual(["6–9 см", "9–12 см", ">12 см"]);
    expect(order(small)).toEqual(order(big));
  });

  it("simple: «Принято» + «Брак» дают 100% факта", () => {
    const cats = categoryShares([item({ actualKg: 10000, brakPercent: 4 })]);
    expect(cats).toEqual([
      { label: "Принято", isAccepted: true, pct: 96, tons: 9.6 },
      { label: "Брак", isAccepted: false, pct: 4, tons: 0.4 },
    ]);
  });

  it("брак 0 → пустая категория не создаётся", () => {
    const cats = categoryShares([
      item({ actualKg: 10000, brakPercent: 0, calibres: [cal(CAT.small, 100)] }),
    ]);
    expect(cats).toHaveLength(1);
  });

  it("нет перевески → пустой список, без NaN", () => {
    expect(categoryShares([item({ actualKg: null, brakPercent: 5 })])).toEqual([]);
  });

  it("категории поставщиков не смешиваются", () => {
    const a = aggregateCultureItems([
      item({
        actualKg: 10000,
        farmerId: 1,
        calibres: [cal(CAT.small, 60), cal(CAT.big, 40)],
      }),
      item({
        actualKg: 10000,
        farmerId: 2,
        farmerName: "Ф2",
        shipmentId: 2,
        calibres: [cal(CAT.small, 100)],
      }),
    ]);
    // строки отсортированы по принятому убыв. → Ф2 (10 т) впереди Ф1 (6 т)
    const f1 = a.bySupplier.find((s) => s.farmerId === 1)!;
    const f2 = a.bySupplier.find((s) => s.farmerId === 2)!;
    expect(f1.categoryPct.map((c) => [c.label, c.pct])).toEqual([
      ["6–9 см", 60],
      [">12 см", 40],
    ]);
    expect(f2.categoryPct.map((c) => [c.label, c.pct])).toEqual([["6–9 см", 100]]);
    // культура целиком — общая база: (6000 + 10000) / 20000 = 80%
    expect(a.calibre[0].pct).toBeCloseTo(80, 9);
  });
});

// Серия «по перевеске» на графике динамики. ⚠ Две разные базы веса в одной точке
// (DOMAIN §1): tons — принятый, actualTons — фактический. Разрыв = брак + нестандарт.
describe("недельные тонны: приёмка и перевеска", () => {
  const week = (a: ReturnType<typeof aggregateCultureItems>) =>
    a.weekTons.get("2026-29")!;

  it("actualTons = Σ фактического веса недели, tons = Σ принятого", () => {
    const a = aggregateCultureItems([
      item({ actualKg: 10000, brakPercent: 8, calibres: [cal(CAT.small, 80), cal(CAT.big, 12)] }),
      item({ actualKg: 5000, brakPercent: 4, shipmentId: 2 }),
    ]);
    // факт 10 + 5 = 15 т; принято 10×80% + 5×96% = 8 + 4,8 = 12,8 т
    expect(week(a).actualTons).toBeCloseTo(15, 9);
    expect(week(a).tons).toBeCloseTo(12.8, 9);
  });

  it("перевеска всегда ≥ приёмки (принятый = факт × Σ принятых %)", () => {
    const a = aggregateCultureItems([
      item({ actualKg: 9850, brakPercent: 9, calibres: [cal(CAT.mid, 61), cal(CAT.big, 30)] }),
      item({ actualKg: 4000, brakPercent: 0, shipmentId: 2 }),
    ]);
    expect(week(a).actualTons).toBeGreaterThanOrEqual(week(a).tons);
  });

  it("позиция без перевески не ломает неделю (0, не NaN)", () => {
    const a = aggregateCultureItems([
      item({ actualKg: null, brakPercent: 5 }),
      item({ actualKg: 2000, shipmentId: 2 }),
    ]);
    expect(week(a).actualTons).toBeCloseTo(2, 9);
  });
});
