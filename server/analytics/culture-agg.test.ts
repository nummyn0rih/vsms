import { describe, expect, it } from "vitest";

import {
  aggregateCultureItems,
  brakPctOfItems,
  excludeSupplier,
  filterItemsBySuppliers,
  nonStandardPctOfItems,
  type CultureItem,
} from "./culture-agg";

// Инварианты РАЗБИЕНИЯ набора позиций на «его» и «остальных» — базу бенчмарка вкладки
// «Качество». Профиль культуры целиком покрыт culture.test.ts; здесь только то, что
// добавлено ради второго разреза.

const W = new Date("2026-07-15T00:00:00Z");

const CAT = {
  ok: { label: "6–9 см", isAccepted: true, minCm: 6, maxCm: 9, rangeId: 3 },
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

const full = [
  item({ actualKg: 10000, farmerId: 1, brakPercent: 2 }),
  item({ actualKg: 5000, farmerId: 1, brakPercent: 4, shipmentId: 2 }),
  item({ actualKg: 8000, farmerId: 2, farmerName: "Ф2", brakPercent: 6, shipmentId: 3 }),
  item({ actualKg: 4000, farmerId: 3, farmerName: "Ф3", brakPercent: 1, shipmentId: 4 }),
];

describe("excludeSupplier — база бенчмарка «все, кроме него»", () => {
  it("режет ровно дополнение к filterItemsBySuppliers: вместе дают исходный набор", () => {
    const mine = filterItemsBySuppliers(full, [1]);
    const others = excludeSupplier(full, 1);
    expect(mine).toHaveLength(2);
    expect(others).toHaveLength(2);
    expect(mine.length + others.length).toBe(full.length);
    // Пересечения нет: ни одна позиция не попала в обе половины.
    expect(others.some((o) => mine.includes(o))).toBe(false);
    expect([...mine, ...others].sort()).toEqual([...full].sort());
  });

  it("в остатке нет позиций исключённого фермера", () => {
    expect(excludeSupplier(full, 1).every((i) => i.farmerId !== 1)).toBe(true);
  });

  it("неизвестный фермер: набор не изменился", () => {
    expect(excludeSupplier(full, 99)).toHaveLength(full.length);
  });

  it("единственный поставщик: база бенчмарка пуста, брак у остальных — null", () => {
    const solo = [item({ actualKg: 3000, farmerId: 7, brakPercent: 5 })];
    expect(excludeSupplier(solo, 7)).toEqual([]);
    expect(brakPctOfItems(excludeSupplier(solo, 7))).toBeNull();
  });
});

describe("brakPctOfItems — то же выражение, что bySupplier[].brakPct", () => {
  it("брак набора одного поставщика совпадает со строкой агрегата", () => {
    const agg = aggregateCultureItems(full);
    for (const s of agg.bySupplier) {
      const mine = filterItemsBySuppliers(full, [s.farmerId]);
      expect(brakPctOfItems(mine)).toBeCloseTo(s.brakPct!, 9);
    }
  });

  it("взвешен по факт. весу, а не по числу партий", () => {
    // 10 000 кг × 2% + 5 000 кг × 4% = 400 кг → 400 / 15 000 = 2,666…%
    expect(brakPctOfItems(filterItemsBySuppliers(full, [1]))).toBeCloseTo(
      (10000 * 2 + 5000 * 4) / 15000,
      9,
    );
  });

  it("пустой набор и набор без перевески дают null, а не 0", () => {
    expect(brakPctOfItems([])).toBeNull();
    expect(brakPctOfItems([item({ actualKg: null, brakPercent: 9 })])).toBeNull();
  });
});

describe("nonStandardPctOfItems — «не в зачёт»", () => {
  it("simple-набор (категорий нет) даёт null: там «не в зачёт» это брак", () => {
    expect(nonStandardPctOfItems(filterItemsBySuppliers(full, [1]))).toBeNull();
  });

  it("считает только НЕпринятые категории, взвешенно по факту", () => {
    const items = [
      item({ actualKg: 10000, calibres: [cal(CAT.ok, 90), cal(CAT.big, 10)] }),
      item({ actualKg: 5000, calibres: [cal(CAT.ok, 80), cal(CAT.big, 20)] }),
    ];
    // (10 000×10% + 5 000×20%) / 15 000 = 2 000 / 15 000
    expect(nonStandardPctOfItems(items)).toBeCloseTo((2000 / 15000) * 100, 9);
  });
});
