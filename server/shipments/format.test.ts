import { describe, expect, it } from "vitest";

import { formatTareTotals, pluralRu, tareUnitWord } from "./format";

// RU-склонение для итогов тары. Классический источник ошибок — исключение 11–14
// (одиннадцать ящикОВ, а не ящик).

describe("pluralRu", () => {
  it("основные формы: 1 / 2 / 5", () => {
    expect(pluralRu(1, "ящик", "ящика", "ящиков")).toBe("ящик");
    expect(pluralRu(2, "ящик", "ящика", "ящиков")).toBe("ящика");
    expect(pluralRu(5, "ящик", "ящика", "ящиков")).toBe("ящиков");
  });

  it("исключение 11–14 берёт форму «многих», а не единицы", () => {
    for (const n of [11, 12, 13, 14]) {
      expect(pluralRu(n, "ящик", "ящика", "ящиков")).toBe("ящиков");
    }
  });

  it("после сотен склонение считается по последним разрядам", () => {
    expect(pluralRu(21, "ящик", "ящика", "ящиков")).toBe("ящик");
    expect(pluralRu(101, "ящик", "ящика", "ящиков")).toBe("ящик");
    expect(pluralRu(102, "ящик", "ящика", "ящиков")).toBe("ящика");
    expect(pluralRu(111, "ящик", "ящика", "ящиков")).toBe("ящиков");
    expect(pluralRu(112, "ящик", "ящика", "ящиков")).toBe("ящиков");
  });

  it("ноль — форма «многих»", () => {
    expect(pluralRu(0, "ящик", "ящика", "ящиков")).toBe("ящиков");
  });
});

describe("tareUnitWord / formatTareTotals", () => {
  it("слово подбирается по виду тары", () => {
    expect(tareUnitWord("box", 103)).toBe("ящика");
    expect(tareUnitWord("barrel", 9)).toBe("бочек");
  });

  it("итог собирается через разделитель, нули опускаются", () => {
    expect(formatTareTotals(62, 8)).toBe("62 ящика · 8 бочек");
    expect(formatTareTotals(0, 3)).toBe("3 бочки");
    expect(formatTareTotals(1, 0)).toBe("1 ящик");
  });

  it("пустые итоги дают пустую строку", () => {
    expect(formatTareTotals(0, 0)).toBe("");
  });
});
