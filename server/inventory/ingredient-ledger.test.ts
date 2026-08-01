import { describe, expect, it } from "vitest";

import { Prisma } from "@/lib/generated/prisma/client";
import {
  FACTORY_LOCATION_ID,
  TRANSFER_TRANSIT,
  TRANSIT_TO_FARMER,
} from "@/server/shipments/packaging";

import {
  summarizeIngredientLedger,
  type IngredientLedgerSummary,
  type LedgerRow,
} from "./ingredient-ledger";

// ingredients-factory-source: сводка леджера ингредиента у поставщика.
// Ключевые инварианты — тождество компонентов с остатком, НЕТТО-дисциплина откатов
// (сторно вычитается, а не «движение существует → пропустить») и Decimal(15,6):
// микродоза аскорбинки ~0,00005 не должна схлопнуться в 0 ни в одном показателе.
// Сравнения через toString()/equals — это Prisma.Decimal, не number.
const D = (v: string | number) => new Prisma.Decimal(v);

const FARMER = 5;
const OTHER_FARMER = 7;

const row = (p: Partial<LedgerRow> & { quantity: Prisma.Decimal }): LedgerRow => ({
  from_location_id: p.from_location_id ?? null,
  to_location_id: p.to_location_id ?? null,
  movement_type: p.movement_type ?? "delivery",
  quantity: p.quantity,
});

// Движения-хелперы: ровно те плечи, что пишет движок (DOMAIN §3).
const opening = (qty: string) =>
  row({ to_location_id: FARMER, movement_type: "opening", quantity: D(qty) });
const delivered = (qty: string) =>
  row({
    from_location_id: TRANSIT_TO_FARMER,
    to_location_id: FARMER,
    quantity: D(qty),
  });
const deliveryReverted = (qty: string) =>
  row({
    from_location_id: FARMER,
    to_location_id: TRANSIT_TO_FARMER,
    quantity: D(qty),
  });
const consumed = (qty: string) =>
  row({
    from_location_id: FARMER,
    movement_type: "consumption",
    quantity: D(qty),
  });
const consumptionReverted = (qty: string) =>
  row({
    to_location_id: FARMER,
    movement_type: "consumption",
    quantity: D(qty),
  });
const transferIn = (qty: string) =>
  row({
    from_location_id: TRANSFER_TRANSIT,
    to_location_id: FARMER,
    quantity: D(qty),
  });
const transferOut = (qty: string) =>
  row({
    from_location_id: FARMER,
    to_location_id: TRANSFER_TRANSIT,
    quantity: D(qty),
  });

// Тождество, которое обязано выполняться на ЛЮБОМ наборе движений.
function expectIdentity(s: IngredientLedgerSummary) {
  const sum = s.openingQty
    .plus(s.receivedQty)
    .plus(s.transferNet)
    .plus(s.otherNet)
    .minus(s.consumedQty);
  expect(sum.toString()).toBe(s.balance.toString());
}

describe("summarizeIngredientLedger — категории движений", () => {
  it("opening + поступило − израсходовано = остаток (базовый случай спеки)", () => {
    const s = summarizeIngredientLedger(
      [opening("0.5"), delivered("12"), consumed("3.425")],
      FARMER,
    );

    expect(s.openingQty.toString()).toBe("0.5");
    expect(s.receivedQty.toString()).toBe("12");
    expect(s.consumedQty.toString()).toBe("3.425");
    expect(s.transferNet.toString()).toBe("0");
    expect(s.otherNet.toString()).toBe("0");
    expect(s.balance.toString()).toBe("9.075");
    expectIdentity(s);
  });

  it("сторно расхода уменьшает «израсходовано», а не увеличивает поступление", () => {
    const s = summarizeIngredientLedger(
      [delivered("10"), consumed("4"), consumptionReverted("4")],
      FARMER,
    );

    expect(s.consumedQty.toString()).toBe("0");
    expect(s.receivedQty.toString()).toBe("10");
    expect(s.balance.toString()).toBe("10");
    expectIdentity(s);
  });

  it("opening засчитывается только приходом (to = локация)", () => {
    const s = summarizeIngredientLedger(
      [
        opening("3"),
        // opening чужой локации: в выборку пары попасть не может, но и подмешаться не должен
        row({
          to_location_id: OTHER_FARMER,
          movement_type: "opening",
          quantity: D("100"),
        }),
      ],
      FARMER,
    );

    expect(s.openingQty.toString()).toBe("3");
    expect(s.balance.toString()).toBe("3");
    expectIdentity(s);
  });

  it("отправка с завода (0 → −2) не попадает в поступление фермера", () => {
    // Груз ещё в пути: у фермера движений нет, сводка пустая.
    const s = summarizeIngredientLedger(
      [
        row({
          from_location_id: FACTORY_LOCATION_ID,
          to_location_id: TRANSIT_TO_FARMER,
          quantity: D("20"),
        }),
      ],
      FARMER,
    );

    expect(s.receivedQty.toString()).toBe("0");
    expect(s.balance.toString()).toBe("0");
    expectIdentity(s);
  });

  it("неизвестный тип движения уходит в otherNet — тождество не ломается", () => {
    const s = summarizeIngredientLedger(
      [
        opening("1"),
        row({
          to_location_id: FARMER,
          movement_type: "adjustment",
          quantity: D("2.5"),
        }),
      ],
      FARMER,
    );

    expect(s.otherNet.toString()).toBe("2.5");
    expect(s.balance.toString()).toBe("3.5");
    expectIdentity(s);
  });
});

describe("summarizeIngredientLedger — НЕТТО откатов (не «по существованию»)", () => {
  it("откат доставки уменьшает «поступило» на нетто", () => {
    const s = summarizeIngredientLedger(
      [delivered("12"), deliveryReverted("12")],
      FARMER,
    );

    expect(s.receivedQty.toString()).toBe("0");
    expect(s.balance.toString()).toBe("0");
    expectIdentity(s);
  });

  it("полный цикл доставка → откат → доставка возвращает исходную величину", () => {
    const s = summarizeIngredientLedger(
      [delivered("12"), deliveryReverted("12"), delivered("12")],
      FARMER,
    );

    // Гард «if (existing) skip» дал бы здесь 0 или 24 — это и был баг materials-fix.
    expect(s.receivedQty.toString()).toBe("12");
    expect(s.balance.toString()).toBe("12");
    expectIdentity(s);
  });

  it("частичный откат: сторно меньше оригинала", () => {
    const s = summarizeIngredientLedger(
      [delivered("12"), deliveryReverted("5")],
      FARMER,
    );

    expect(s.receivedQty.toString()).toBe("7");
    expectIdentity(s);
  });
});

describe("summarizeIngredientLedger — переносы фермер→фермер (транзит −3)", () => {
  it("приход переносом не смешивается с поступлением с завода", () => {
    const s = summarizeIngredientLedger(
      [delivered("10"), transferIn("4"), consumed("1")],
      FARMER,
    );

    expect(s.receivedQty.toString()).toBe("10");
    expect(s.transferNet.toString()).toBe("4");
    expect(s.balance.toString()).toBe("13");
    expectIdentity(s);
  });

  it("отдача переносом даёт отрицательный transferNet, тождество держится", () => {
    const s = summarizeIngredientLedger(
      [opening("6"), transferOut("2.5")],
      FARMER,
    );

    expect(s.transferNet.toString()).toBe("-2.5");
    expect(s.balance.toString()).toBe("3.5");
    expectIdentity(s);
  });

  it("тождество на смешанном наборе всех категорий", () => {
    const s = summarizeIngredientLedger(
      [
        opening("0.5"),
        delivered("12"),
        deliveryReverted("2"),
        transferIn("4"),
        transferOut("1.25"),
        consumed("3.425"),
        consumptionReverted("0.425"),
      ],
      FARMER,
    );

    expect(s.openingQty.toString()).toBe("0.5");
    expect(s.receivedQty.toString()).toBe("10");
    expect(s.transferNet.toString()).toBe("2.75");
    expect(s.consumedQty.toString()).toBe("3");
    expect(s.balance.toString()).toBe("10.25");
    expectIdentity(s);
  });
});

describe("summarizeIngredientLedger — Decimal(15,6), микродозы", () => {
  it("микродоза расхода не схлопывается в 0", () => {
    const s = summarizeIngredientLedger(
      [delivered("0.001"), consumed("0.00005")],
      FARMER,
    );

    expect(s.consumedQty.toString()).toBe("0.00005");
    expect(s.consumedQty.isZero()).toBe(false);
    expect(s.balance.toString()).toBe("0.00095");
    expectIdentity(s);
  });

  it("сумма микродоз точна — без плавающей арифметики", () => {
    const rows = Array.from({ length: 3 }, () => consumed("0.00005"));
    const s = summarizeIngredientLedger([delivered("1"), ...rows], FARMER);

    // 0.1 + 0.2 !== 0.3 в number; в Decimal — точно.
    expect(s.consumedQty.toString()).toBe("0.00015");
    expect(s.balance.toString()).toBe("0.99985");
    expectIdentity(s);
  });

  it("остаток может быть отрицательным (расход раньше прибытия доставки, BR-27)", () => {
    const s = summarizeIngredientLedger([consumed("0.5")], FARMER);

    expect(s.balance.toString()).toBe("-0.5");
    expect(s.consumedQty.toString()).toBe("0.5");
    expectIdentity(s);
  });

  it("пустой леджер — все нули, тождество выполняется", () => {
    const s = summarizeIngredientLedger([], FARMER);

    expect(s.balance.toString()).toBe("0");
    expectIdentity(s);
  });
});
