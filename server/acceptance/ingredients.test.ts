import { describe, expect, it } from "vitest";

import { Prisma } from "@/lib/generated/prisma/client";

import { calcIngredientConsumption } from "./ingredients";

// BR-4 / DOMAIN §1: ингредиенты расходуются по ФАКТИЧЕСКОМУ весу (перевеска),
// не по принятому. Ключевой инвариант точности — микродозы: StockMovement.quantity
// расширена до Decimal(15,6) именно ради аскорбинки (~0,00005 на кг продукта).
// Сравнения через toString()/equals — это Prisma.Decimal, не number.
const D = (v: string | number) => new Prisma.Decimal(v);

describe("calcIngredientConsumption — Decimal(15,6)", () => {
  it("микродоза не схлопывается в 0: 6850 кг × 0,00005 = 0,3425", () => {
    const [m] = calcIngredientConsumption(D(6850), [
      { ingredientId: 7, qtyPerKgProduct: D("0.00005") },
    ]);
    expect(m.quantity.toString()).toBe("0.3425");
  });

  it("на 1 кг продукта микродоза сохраняется полностью (6 знаков)", () => {
    const [m] = calcIngredientConsumption(D(1), [
      { ingredientId: 7, qtyPerKgProduct: D("0.00005") },
    ]);
    expect(m.quantity.toString()).toBe("0.00005");
    expect(m.quantity.gt(0)).toBe(true);
  });

  it("округление до 6 знаков — ROUND_HALF_UP, а не отбрасывание", () => {
    const [up] = calcIngredientConsumption(D(1), [
      { ingredientId: 1, qtyPerKgProduct: D("0.0000005") },
    ]);
    expect(up.quantity.toString()).toBe("0.000001");
  });

  it("то, что округлилось в ноль, отбрасывается (движение не создаётся)", () => {
    const rows = calcIngredientConsumption(D(1), [
      { ingredientId: 1, qtyPerKgProduct: D("0.0000004") },
    ]);
    expect(rows).toEqual([]);
  });

  it("культура без рецептуры → пустой массив (акт без движений)", () => {
    expect(calcIngredientConsumption(D(6850), [])).toEqual([]);
  });

  it("несколько ингредиентов: порядок и ingredientId сохраняются", () => {
    const rows = calcIngredientConsumption(D(1000), [
      { ingredientId: 3, qtyPerKgProduct: D("0.02") },
      { ingredientId: 7, qtyPerKgProduct: D("0.00005") },
    ]);
    expect(rows.map((r) => r.ingredientId)).toEqual([3, 7]);
    expect(rows.map((r) => r.quantity.toString())).toEqual(["20", "0.05"]);
  });

  it("база — переданный фактический вес: удвоение факта удваивает расход", () => {
    const recipe = [{ ingredientId: 3, qtyPerKgProduct: D("0.02") }];
    const [one] = calcIngredientConsumption(D(1000), recipe);
    const [two] = calcIngredientConsumption(D(2000), recipe);
    expect(two.quantity.equals(one.quantity.mul(2))).toBe(true);
  });
});
