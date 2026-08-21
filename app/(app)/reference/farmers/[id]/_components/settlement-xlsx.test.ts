import { describe, expect, it } from "vitest";

import type {
  FarmerSettlement,
  SettlementBatch,
  SettlementLine,
} from "@/server/farmers/settlement-agg";
import type { SettlementPeriod } from "@/server/farmers/settlement-period";
import { buildSettlementBook, settlementFileName } from "./settlement-xlsx";

// Инварианты выгрузки расчётного листа. Проверяется РАСКЛАДКА по ячейкам, не арифметика:
// числа приходят посчитанными ядром, модуль их только раскладывает.
//
// Главный инвариант — контекст партии (факт / принято по акту / нестандарт / брак /
// число строк) при делении партии на несколько строк контракта ПОВТОРЯЕТСЯ и потому
// нигде не суммируется. Деньги и зачтённый вес, наоборот, разложены без задвоения.

const SEASON: SettlementPeriod = {
  kind: "season",
  from: null,
  to: null,
  label: "Сезон 2026",
  isSeason: true,
};

const MONTH: SettlementPeriod = {
  kind: "month",
  from: "2026-08-01",
  to: "2026-08-31",
  label: "Август 2026",
  isSeason: false,
};

// Партия #1 приехала одной машиной и разложена на ДВЕ строки контракта: 5 000 кг в
// «стандарт» и 1 000 кг в «нестандарт». position одинаков в обеих строках — это факт
// всей машины (6 000 кг), а не вклад в строку.
const SPLIT_POSITION: SettlementBatch["position"] = {
  actualKg: 6000,
  acceptedKg: 5000,
  acceptedPercent: 83.3,
  brakPercent: 0,
  nonStandardPercent: 16.7,
  linesCount: 2,
};

const batchStd: SettlementBatch = {
  itemId: 1,
  actNumber: "007",
  date: "2026-08-12",
  cultureName: "Огурец",
  color: "#3ba55d",
  countedKg: 5000,
  surchargeKg: 0,
  paidKg: 5000,
  costRub: 150_000,
  settlementPercent: null,
  position: SPLIT_POSITION,
};

const batchNonStd: SettlementBatch = {
  ...batchStd,
  countedKg: 1000,
  paidKg: 1000,
  costRub: 10_000,
};

const batchSecond: SettlementBatch = {
  itemId: 2,
  actNumber: "008",
  date: "2026-08-20",
  cultureName: "Огурец",
  color: "#3ba55d",
  countedKg: 3000,
  surchargeKg: 0,
  paidKg: 3000,
  costRub: 90_000,
  settlementPercent: 97.5,
  position: {
    actualKg: 3200,
    acceptedKg: 3000,
    acceptedPercent: 93.8,
    brakPercent: 6.25,
    nonStandardPercent: 0,
    linesCount: 1,
  },
};

const lineStd: SettlementLine = {
  lineId: 11,
  contractId: 5,
  cultureId: 3,
  cultureName: "Огурец",
  color: "#3ba55d",
  label: "стандарт",
  pricePerKg: 30,
  countedKg: 8000,
  surchargeKg: 0,
  paidKg: 8000,
  costRub: 240_000,
  season: { countedKg: 8000, targetKg: 100_000, pct: 8, remainingKg: 92_000 },
  batches: [batchStd, batchSecond],
};

const lineNonStd: SettlementLine = {
  lineId: 12,
  contractId: 5,
  cultureId: 3,
  cultureName: "Огурец",
  color: "#3ba55d",
  label: "нестандарт >12",
  pricePerKg: 10,
  countedKg: 1000,
  surchargeKg: 0,
  paidKg: 1000,
  costRub: 10_000,
  season: { countedKg: 1000, targetKg: 20_000, pct: 5, remainingKg: 19_000 },
  batches: [batchNonStd],
};

function sheet(period: SettlementPeriod = SEASON): FarmerSettlement {
  return {
    farmer: { id: 7, name: "Иванов И. И." },
    season: 2026,
    period,
    generatedAt: "2026-08-21",
    lines: [lineStd, lineNonStd],
    totals: {
      countedKg: 9000,
      surchargeKg: 0,
      paidKg: 9000,
      costRub: 250_000,
      season: { countedKg: 9000, targetKg: 120_000, pct: 7.5 },
    },
    unpaid: [
      {
        itemId: 3,
        actNumber: "009",
        date: "2026-08-25",
        cultureName: "Томат",
        color: "#e5484d",
        reason: "foreign_line",
        foreignLineId: 99,
        actualKg: 2000,
        acceptedKg: 1800,
        unpaidKg: 1800,
        partial: true,
      },
    ],
    unpaidTotals: { unpaidKg: 1800, positions: 1 },
    pending: [
      {
        itemId: 4,
        date: "2026-08-28",
        cultureName: "Кабачок",
        color: "#f5a623",
        status: "sent",
        plannedKg: 12_000,
        actualKg: null,
      },
    ],
    notes: {
      hasSurcharge: false,
      hasZeroPrice: false,
      undatedCount: 0,
      splitBatchCount: 1,
    },
  };
}

const empty: FarmerSettlement = {
  farmer: { id: 8, name: "Петров" },
  season: 2026,
  period: SEASON,
  generatedAt: "2026-08-21",
  lines: [],
  totals: {
    countedKg: 0,
    surchargeKg: 0,
    paidKg: 0,
    costRub: 0,
    season: { countedKg: 0, targetKg: 0, pct: 0 },
  },
  unpaid: [],
  unpaidTotals: { unpaidKg: 0, positions: 0 },
  pending: [],
  notes: { hasSurcharge: false, hasZeroPrice: false, undatedCount: 0, splitBatchCount: 0 },
};

const num = (v: string | number | null) => (typeof v === "number" ? v : 0);

describe("buildSettlementBook", () => {
  it("книга — всегда три листа в фиксированном порядке", () => {
    expect(buildSettlementBook(sheet()).map((s) => s.sheetName)).toEqual([
      "Расчёт",
      "Без привязки",
      "Ожидают приёмки",
    ]);
  });

  it("строки контракта и их партии идут в порядке data, итог — последней строкой", () => {
    const [calc] = buildSettlementBook(sheet());
    expect(calc.rows.map((r) => r["Уровень"])).toEqual([
      "строка", // стандарт
      "партия", // акт 007
      "партия", // акт 008
      "строка", // нестандарт
      "партия", // акт 007, вторая доля той же машины
      "итого",
    ]);
  });

  it("Σ «Сумма, ₽» по строкам уровня «строка» равна строке «итого»", () => {
    const [calc] = buildSettlementBook(sheet());
    const lines = calc.rows.filter((r) => r["Уровень"] === "строка");
    const total = calc.rows.find((r) => r["Уровень"] === "итого")!;
    expect(lines.reduce((s, r) => s + num(r["Сумма, ₽"]), 0)).toBe(total["Сумма, ₽"]);
    expect(total["Сумма, ₽"]).toBe(250_000);
  });

  it("зачтённый вес не задвоен: Σ по партиям равна Σ по строкам контракта", () => {
    const [calc] = buildSettlementBook(sheet());
    const by = (level: string) =>
      calc.rows
        .filter((r) => r["Уровень"] === level)
        .reduce((s, r) => s + num(r["Зачтено, т"]), 0);
    expect(by("партия")).toBe(by("строка"));
    expect(by("строка")).toBe(9);
  });

  it("контекст партии повторён в каждой строке контракта и не попадает в «итого»", () => {
    const [calc] = buildSettlementBook(sheet());
    const split = calc.rows.filter((r) => r["№ акта"] === "007");
    expect(split).toHaveLength(2);
    for (const r of split) {
      // Факт машины — 6 000 кг; сумма по этим двум ячейкам (12 000) смысла не имеет,
      // поэтому колонка помечена «Строк контракта у партии».
      expect(r["Факт партии, кг"]).toBe(6000);
      expect(r["Принято по акту, кг"]).toBe(5000);
      expect(r["Строк контракта у партии"]).toBe(2);
    }
    // А вклад в строку у долей разный — это и есть неудвоенный вес.
    expect(split.map((r) => r["Зачтено, т"])).toEqual([5, 1]);

    const total = calc.rows.find((r) => r["Уровень"] === "итого")!;
    for (const col of [
      "Факт партии, кг",
      "Принято по акту, кг",
      "Нестандарт, %",
      "Брак, %",
      "Строк контракта у партии",
    ]) {
      expect(total[col]).toBeNull();
    }
  });

  it("сезонные величины — только у строки контракта, дата и акт — только у партии", () => {
    const [calc] = buildSettlementBook(sheet());
    const line = calc.rows[0];
    const batch = calc.rows[1];

    expect(line["Заявлено, т"]).toBe(100);
    expect(line["Выполнение, %"]).toBe(8);
    expect(line["Цена, ₽/кг"]).toBe(30);
    expect(line["Дата"]).toBeNull();
    expect(line["№ акта"]).toBeNull();

    expect(batch["Заявлено, т"]).toBeNull();
    expect(batch["Выполнение, %"]).toBeNull();
    expect(batch["Цена, ₽/кг"]).toBeNull();
    expect(batch["Дата"]).toBe("12.08.2026");
    expect(batch["№ акта"]).toBe("007");
    // Культура и строка дублируются со строки контракта — иначе после автофильтра
    // «Уровень = партия» непонятно, к чему партия относится.
    expect(batch["Культура"]).toBe("Огурец");
    expect(batch["Строка"]).toBe("стандарт");
  });

  it("нулевая доплата — пустая ячейка, а не 0; корректировка и проценты приёмки — числами", () => {
    const [calc] = buildSettlementBook(sheet());
    expect(calc.rows[0]["Доплата, кг"]).toBeNull();
    const second = calc.rows[2]; // акт 008
    expect(second["Корректировка, %"]).toBe(97.5);
    expect(second["Брак, %"]).toBe(6.3);
    expect(second["Нестандарт, %"]).toBeNull();
  });

  it("лист «Без привязки»: причина как на экране, итог в первой колонке, сумм нет", () => {
    const [, unpaid] = buildSettlementBook(sheet());
    expect(unpaid.columns).not.toContain("Сумма, ₽");
    expect(unpaid.rows[0]["Причина"]).toBe("строка другого контракта или сезона (#99)");
    expect(unpaid.rows[0]["Часть партии оплачена"]).toBe("да");
    expect(unpaid.rows[1]).toMatchObject({
      "Дата": "Итого",
      "Причина": "1 поз.",
      "Не оплачивается, кг": 1800,
    });
  });

  it("лист «Ожидают приёмки»: статус подписан словарём экрана", () => {
    const [, , pending] = buildSettlementBook(sheet());
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0]).toMatchObject({
      "Дата": "28.08.2026",
      "Статус": "в пути",
      "План, кг": 12_000,
      "Факт, кг": null,
    });
  });

  it("пустой лист сохраняет шапку: состав книги не зависит от данных", () => {
    const book = buildSettlementBook(empty);
    expect(book).toHaveLength(3);
    for (const s of book) {
      expect(s.rows).toHaveLength(0);
      expect(s.columns.length).toBeGreaterThan(0);
    }
    // Строки «итого» с нулями у поставщика без контракта нет — она читалась бы как сбой.
    expect(book[0].rows).toEqual([]);
  });
});

describe("settlementFileName", () => {
  it("сезон — без периода в имени, недопустимые символы заменены", () => {
    expect(settlementFileName(sheet())).toBe("vsms-расчёт-Иванов-И-И-2026.xlsx");
  });

  it("узкий период — границы в имени файла", () => {
    expect(settlementFileName(sheet(MONTH))).toBe(
      "vsms-расчёт-Иванов-И-И-2026-2026-08-01..2026-08-31.xlsx",
    );
  });

  it("слэши и двоеточия из имени не уезжают в путь", () => {
    const d = sheet();
    expect(
      settlementFileName({ ...d, farmer: { id: 9, name: 'КФХ "Заря" / Юг: цех*1' } }),
    ).toBe("vsms-расчёт-КФХ-Заря-Юг-цех1-2026.xlsx");
  });

  it("имя из одних запрещённых символов вырождается в id, а не в пустое место", () => {
    const d = sheet();
    expect(settlementFileName({ ...d, farmer: { id: 42, name: "///" } })).toBe(
      "vsms-расчёт-42-2026.xlsx",
    );
  });
});
