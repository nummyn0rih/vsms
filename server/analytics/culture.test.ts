import { describe, expect, it } from "vitest";

import {
  aggregateCultureItems,
  categoryShares,
  type CultureItem,
} from "./culture-agg";

// Инварианты профиля культуры: доля поставщика (Σ = 100%), оплачиваемый вес (BR-33)
// и доли категорий калибра. Всё, что ходит в БД, — в scripts/culture-analytics-verify.ts.

const W = new Date("2026-07-15T00:00:00Z"); // среда, ISO-неделя 29

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
        calibres: [
          { label: "станд.", isAccepted: true, percent: 50 },
          { label: "мелкий", isAccepted: true, percent: 30 },
          { label: "не в зачёт", isAccepted: false, percent: 12 },
        ],
      }),
    ]);
    expect(cats.map((c) => c.label)).toEqual([
      "станд.",
      "мелкий",
      "не в зачёт",
      "Брак",
    ]);
    expect(cats.reduce((s, c) => s + c.pct, 0)).toBeCloseTo(100, 9);
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
      item({
        actualKg: 10000,
        brakPercent: 0,
        calibres: [{ label: "станд.", isAccepted: true, percent: 100 }],
      }),
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
        calibres: [
          { label: "станд.", isAccepted: true, percent: 60 },
          { label: "не в зачёт", isAccepted: false, percent: 40 },
        ],
      }),
      item({
        actualKg: 10000,
        farmerId: 2,
        farmerName: "Ф2",
        shipmentId: 2,
        calibres: [{ label: "станд.", isAccepted: true, percent: 100 }],
      }),
    ]);
    // строки отсортированы по принятому убыв. → Ф2 (10 т) впереди Ф1 (6 т)
    const f1 = a.bySupplier.find((s) => s.farmerId === 1)!;
    const f2 = a.bySupplier.find((s) => s.farmerId === 2)!;
    expect(f1.categoryPct.map((c) => [c.label, c.pct])).toEqual([
      ["станд.", 60],
      ["не в зачёт", 40],
    ]);
    expect(f2.categoryPct.map((c) => [c.label, c.pct])).toEqual([["станд.", 100]]);
    // культура целиком — общая база: (6000 + 10000) / 20000 = 80%
    expect(a.calibre[0].pct).toBeCloseTo(80, 9);
  });
});
