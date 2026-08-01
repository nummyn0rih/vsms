import { describe, expect, it } from "vitest";

import {
  actNumbersSummary,
  calibreRangeLabel,
  computeAcceptedKg,
  computeAcceptedPercent,
  computeSettlement,
  computeWeightedBrak,
  findSettlementConflict,
  settlementConflictMessage,
  type SettlementCalibre,
} from "./accepted";

// Ядро четырёх баз веса (DOMAIN §1): принятый (тонны выполнения), оплачиваемый
// (деньги, BR-33), фактический (база брака). Округления здесь нет — значения
// точные, округление только на показе, поэтому сравнения через toBeCloseTo.

// --- Эталон BR-33 из PROMPTS-SETTLEMENT-ADJUSTMENT.md ---
// Огурцы, факт 6850 кг: 6–9 см 53,7% · 9–12 см 34,5% (принятые, строки 101/102),
// >12 нестандарт 10,4% (без строки), брак 1,4%. Договорённость — 97% от факта.
const ACTUAL = 6850;
const LINE_69 = 101;
const LINE_912 = 102;
const REF_CALIBRES: SettlementCalibre[] = [
  { percent: 53.7, isAccepted: true, contractLineId: LINE_69 },
  { percent: 34.5, isAccepted: true, contractLineId: LINE_912 },
  { percent: 10.4, isAccepted: false, contractLineId: null },
];

describe("computeAcceptedKg — BR-10", () => {
  it("simple: actual × (1 − brak%)", () => {
    expect(computeAcceptedKg(1000, 5, [])).toBeCloseTo(950, 9);
  });

  it("simple: брак null трактуется как 0", () => {
    expect(computeAcceptedKg(1000, null, [])).toBeCloseTo(1000, 9);
  });

  it("actual = null → null (веса ещё нет)", () => {
    expect(computeAcceptedKg(null, 5, [])).toBeNull();
    expect(computeAcceptedKg(null, null, REF_CALIBRES)).toBeNull();
  });

  it("пустой набор категорий уходит в ветку simple", () => {
    // Тот же брак, но без категорий — считается по (1 − brak%), а не «Σ принятых = 0».
    expect(computeAcceptedKg(6850, 1.4, [])).toBeCloseTo(6850 * 0.986, 9);
  });

  it("calibre: actual × Σ(принятых %)", () => {
    expect(computeAcceptedKg(ACTUAL, 1.4, REF_CALIBRES)).toBeCloseTo(6041.7, 9);
  });

  it("брак НЕ вычитается дважды: в calibre-ветке brakPercent игнорируется", () => {
    // Брак — одна из долей 100% факта наравне с категориями (BR-10), поэтому
    // результат не зависит от переданного brakPercent при непустых категориях.
    const withBrak = computeAcceptedKg(ACTUAL, 1.4, REF_CALIBRES);
    const withoutBrak = computeAcceptedKg(ACTUAL, 0, REF_CALIBRES);
    const withNull = computeAcceptedKg(ACTUAL, null, REF_CALIBRES);
    expect(withBrak).toBe(withoutBrak);
    expect(withBrak).toBe(withNull);
    // Если бы брак вычитался вторым шагом, вышло бы 5957,1 кг.
    expect(withBrak).not.toBeCloseTo(6041.7 * 0.986, 1);
  });

  it("все категории неприёмные → 0", () => {
    expect(
      computeAcceptedKg(ACTUAL, 1.4, [{ percent: 98.6, isAccepted: false }]),
    ).toBe(0);
  });
});

describe("computeAcceptedPercent", () => {
  it("simple: 100 − brak%, null → 100", () => {
    expect(computeAcceptedPercent(5, [])).toBeCloseTo(95, 9);
    expect(computeAcceptedPercent(null, [])).toBe(100);
  });

  it("calibre: Σ percent принятых категорий", () => {
    expect(computeAcceptedPercent(1.4, REF_CALIBRES)).toBeCloseTo(88.2, 9);
  });
});

describe("computeWeightedBrak — база ФАКТ", () => {
  it("взвешивает по фактическому весу, а не арифметическим средним", () => {
    const rows = [
      { actualKg: 6850, brakPercent: 1.4 },
      { actualKg: 1000, brakPercent: 10 },
    ];
    // (6850×1,4 + 1000×10) / 7850 = 19590 / 7850
    expect(computeWeightedBrak(rows)).toBeCloseTo(19590 / 7850, 9);
    // Среднее арифметическое дало бы 5,7 — грубая ошибка на порядок.
    expect(computeWeightedBrak(rows)).not.toBeCloseTo(5.7, 1);
  });

  it("пустой набор → 0", () => {
    expect(computeWeightedBrak([])).toBe(0);
  });

  it("Σ actual = 0 → 0 (деление на ноль защищено)", () => {
    expect(computeWeightedBrak([{ actualKg: 0, brakPercent: 12 }])).toBe(0);
  });
});

describe("computeSettlement — BR-33, эталон числом в число", () => {
  const acceptedKg = computeAcceptedKg(ACTUAL, 1.4, REF_CALIBRES);
  const s = computeSettlement({
    actualKg: ACTUAL,
    acceptedKg,
    settlementPercent: 97,
    itemLineId: LINE_69,
    calibres: REF_CALIBRES,
  });

  it("принятый вес 6041,7 кг", () => {
    expect(acceptedKg).toBeCloseTo(6041.7, 9);
  });

  it("доплата 602,8 кг (97% − 88,2% от факта)", () => {
    expect(s.surchargeKg).toBeCloseTo(602.8, 9);
  });

  it("оплачиваемый вес 6644,5 кг", () => {
    expect(s.paidKg).toBeCloseTo(6644.5, 9);
  });

  it("разнос доплаты: 367,0 кг на строку 6–9 и 235,8 кг на строку 9–12", () => {
    const kg = (line: number) =>
      s.allocation.find((a) => a.contractLineId === line)?.kg ?? null;
    expect(kg(LINE_69)).toBeCloseTo(367.0, 1);
    expect(kg(LINE_912)).toBeCloseTo(235.8, 1);
  });

  it("Σ разноса равна доплате — ничего не потеряно", () => {
    expect(s.allocation.reduce((acc, a) => acc + a.kg, 0)).toBeCloseTo(s.surchargeKg, 9);
  });

  it("нестандарт без строки доплату не получает", () => {
    expect(s.allocation).toHaveLength(2);
    expect(s.allocation.every((a) => a.contractLineId !== null)).toBe(true);
  });

  it("доплата в принятый вес НЕ входит (тонны выполнения от принятого)", () => {
    expect(s.paidKg - s.surchargeKg).toBeCloseTo(acceptedKg!, 9);
  });
});

describe("computeSettlement — краевые случаи", () => {
  const acceptedKg = computeAcceptedKg(ACTUAL, 1.4, REF_CALIBRES);

  it("settlementPercent = null → оплачиваемый равен принятому, доплаты нет", () => {
    const s = computeSettlement({
      actualKg: ACTUAL,
      acceptedKg,
      settlementPercent: null,
      itemLineId: LINE_69,
      calibres: REF_CALIBRES,
    });
    expect(s.paidKg).toBe(acceptedKg);
    expect(s.surchargeKg).toBe(0);
    expect(s.allocation).toEqual([]);
  });

  it("процент не выше принятого (скидка) → доплаты нет", () => {
    for (const percent of [88.2, 80]) {
      const s = computeSettlement({
        actualKg: ACTUAL,
        acceptedKg,
        settlementPercent: percent,
        itemLineId: LINE_69,
        calibres: REF_CALIBRES,
      });
      expect(s.surchargeKg).toBe(0);
      expect(s.paidKg).toBe(acceptedKg);
    }
  });

  it("Σ принятых % = 0 → доплата 0 без падения (деление на ноль)", () => {
    const allRejected: SettlementCalibre[] = [
      { percent: 98.6, isAccepted: false, contractLineId: null },
    ];
    const s = computeSettlement({
      actualKg: ACTUAL,
      acceptedKg: 0,
      settlementPercent: 97,
      itemLineId: LINE_69,
      calibres: allRejected,
    });
    expect(s.surchargeKg).toBe(0);
    expect(s.paidKg).toBe(0);
    expect(s.allocation).toEqual([]);
  });

  it("simple: вся доплата уходит на строку позиции", () => {
    const simpleAccepted = computeAcceptedKg(1000, 5, []); // 950
    const s = computeSettlement({
      actualKg: 1000,
      acceptedKg: simpleAccepted,
      settlementPercent: 100,
      itemLineId: LINE_912,
      calibres: [],
    });
    expect(s.surchargeKg).toBeCloseTo(50, 9);
    expect(s.paidKg).toBeCloseTo(1000, 9);
    expect(s.allocation).toEqual([{ contractLineId: LINE_912, kg: s.surchargeKg }]);
  });

  it("actual = 0 или null → доплаты нет (деление на ноль защищено)", () => {
    for (const actualKg of [0, null]) {
      const s = computeSettlement({
        actualKg,
        acceptedKg: 0,
        settlementPercent: 97,
        itemLineId: LINE_69,
        calibres: REF_CALIBRES,
      });
      expect(s.surchargeKg).toBe(0);
    }
  });

  it("категория без своей строки наследует строку позиции", () => {
    const s = computeSettlement({
      actualKg: 1000,
      acceptedKg: 900,
      settlementPercent: 95,
      itemLineId: LINE_69,
      calibres: [{ percent: 90, isAccepted: true, contractLineId: null }],
    });
    expect(s.allocation).toEqual([{ contractLineId: LINE_69, kg: s.surchargeKg }]);
  });
});

describe("calibreRangeLabel", () => {
  it("размерная категория: обе границы, только min, только max", () => {
    expect(calibreRangeLabel(6, 9, "Стандарт")).toBe("6–9 см");
    expect(calibreRangeLabel(12, null, "Стандарт")).toBe(">12 см");
    expect(calibreRangeLabel(null, 6, "Стандарт")).toBe("<6 см");
  });

  it("безразмерная категория показывается своим label", () => {
    expect(calibreRangeLabel(null, null, "Пульпа")).toBe("Пульпа");
  });
});

// --- BR-33 × C3d-2: два механизма оплаты нестандарта взаимоисключающие ---
// Гейт оплаты в execution.ts — contract_line_id, НЕ is_accepted: нестандарт со строкой
// оплачивается целиком по своей строке. Доплата BR-33 считается от факта и накрывает тот
// же вес ещё раз → двойной счёт (реальный дефект прод-данных). Комбинация запрещается.
describe("findSettlementConflict — BR-33 × C3d-2", () => {
  const NS_WITH_LINE = { label: ">12 см", isAccepted: false, contractLineId: 103 };
  const NS_NO_LINE = { label: ">12 см", isAccepted: false, contractLineId: null };
  const STD = { label: "6–9 см", isAccepted: true, contractLineId: LINE_69 };

  it("нестандарт со строкой + процент к оплате → конфликт с подписью категории", () => {
    expect(findSettlementConflict(97, [STD, NS_WITH_LINE])).toBe(">12 см");
  });

  it("тот же набор без процента → конфликта нет (C3d-2 продолжает работать)", () => {
    expect(findSettlementConflict(null, [STD, NS_WITH_LINE])).toBeNull();
  });

  it("нестандарт БЕЗ строки + процент → конфликта нет (эталон BR-33)", () => {
    expect(findSettlementConflict(97, [STD, NS_NO_LINE])).toBeNull();
  });

  it("принятая категория со строкой + процент → конфликта нет", () => {
    expect(findSettlementConflict(97, [STD])).toBeNull();
  });

  it("simple (категорий нет) → конфликта нет", () => {
    expect(findSettlementConflict(97, [])).toBeNull();
  });

  it("процент 0 — это заданная корректировка, а не «нет»: конфликт ловится", () => {
    expect(findSettlementConflict(0, [NS_WITH_LINE])).toBe(">12 см");
  });

  it("сообщение называет конкретную категорию и оба выхода", () => {
    const msg = settlementConflictMessage(">12 см");
    expect(msg).toContain("«>12 см»");
    expect(msg).toContain("Уберите строку контракта");
    expect(msg).toContain("очистите процент");
  });
});

// --- Сводка № актов для свёрнутой карточки (acceptance-ux-2) ---

describe("actNumbersSummary", () => {
  it("позиции без акта отбрасываются", () => {
    expect(actNumbersSummary([null, "12", null])).toEqual({
      shown: ["12"],
      rest: 0,
    });
    expect(actNumbersSummary([null, null])).toEqual({ shown: [], rest: 0 });
    expect(actNumbersSummary([])).toEqual({ shown: [], rest: 0 });
  });

  it("повторяющийся номер (один акт на несколько позиций) схлопывается", () => {
    expect(actNumbersSummary(["12", "12", "13"])).toEqual({
      shown: ["12", "13"],
      rest: 0,
    });
  });

  it("переполнение сворачивается в остаток, порядок позиций сохраняется", () => {
    expect(actNumbersSummary(["12", "13", "14", "15", "16"])).toEqual({
      shown: ["12", "13", "14"],
      rest: 2,
    });
  });

  it("остаток считается по уникальным номерам, а не по позициям", () => {
    expect(actNumbersSummary(["12", "12", "13", "14", "15"])).toEqual({
      shown: ["12", "13", "14"],
      rest: 1,
    });
  });

  it("предел настраивается", () => {
    expect(actNumbersSummary(["12", "13", "14"], 1)).toEqual({
      shown: ["12"],
      rest: 2,
    });
  });

  it("пустая строка номером не считается", () => {
    expect(actNumbersSummary(["", "  ", "12"])).toEqual({
      shown: ["12"],
      rest: 0,
    });
  });
});
