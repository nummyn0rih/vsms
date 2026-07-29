import { describe, expect, it } from "vitest";

import { Prisma } from "@/lib/generated/prisma/client";

import { calcPackagingUnits, tripleKey } from "./packaging";

// BR-3 / DOMAIN §1: тара двигается по ПЛАНОВОМУ весу, единицы считаются от
// нетто-нормы тройки (фермер × культура × тип тары). capacity_kg не участвует.
// Округление — ВВЕРХ: недосчитать тару нельзя, физически её везут целыми штуками.
const D = (v: string | number) => new Prisma.Decimal(v);

describe("calcPackagingUnits", () => {
  it("округляет вверх, а не математически: 1000 / 12 = 83,33 → 84", () => {
    const r = calcPackagingUnits(D(1000), 5, { avg_unit_weight_kg: D(12) });
    expect(r).toEqual({ status: "ok", packagingTypeId: 5, units: 84 });
  });

  it("остаток меньше половины единицы всё равно даёт +1 ящик", () => {
    // 1201 / 12 = 100,08 — round дал бы 100, ceil даёт 101.
    const r = calcPackagingUnits(D(1201), 5, { avg_unit_weight_kg: D(12) });
    expect(r).toMatchObject({ status: "ok", units: 101 });
  });

  it("ровное деление не добавляет лишнюю единицу", () => {
    const r = calcPackagingUnits(D(1200), 5, { avg_unit_weight_kg: D(12) });
    expect(r).toMatchObject({ status: "ok", units: 100 });
  });

  it("дробная норма считается в Decimal без потери точности", () => {
    // 100 / 0,3 = 333,33… → 334 (в double 100/0.3 = 333.3333333333333, ceil тот же,
    // но считаем именно Decimal-математикой, как в проде).
    const r = calcPackagingUnits(D(100), 5, { avg_unit_weight_kg: D("0.3") });
    expect(r).toMatchObject({ status: "ok", units: 334 });
  });

  it("навал (тип тары не выбран) → none, даже если норма передана", () => {
    const r = calcPackagingUnits(D(1000), null, { avg_unit_weight_kg: D(12) });
    expect(r).toEqual({ status: "none" });
  });

  it("нет нормы по тройке → missing_norm (блокирует planned → sent)", () => {
    expect(calcPackagingUnits(D(1000), 5, null)).toEqual({ status: "missing_norm" });
    expect(calcPackagingUnits(D(1000), 5, undefined)).toEqual({ status: "missing_norm" });
    expect(calcPackagingUnits(D(1000), 5)).toEqual({ status: "missing_norm" });
  });
});

describe("tripleKey", () => {
  it("ключ нормы — фермер:культура:тип", () => {
    expect(tripleKey(1, 2, 3)).toBe("1:2:3");
  });

  it("разные тройки не коллизируют", () => {
    expect(tripleKey(1, 23, 4)).not.toBe(tripleKey(12, 3, 4));
  });
});
