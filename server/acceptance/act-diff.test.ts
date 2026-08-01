import { describe, expect, it } from "vitest";

import { diffCalibreResults, type CalibreSnapshot } from "./act-diff";

// Инвариант: пересохранение акта БЕЗ изменений категорий не должно оставлять след в
// журнале (иначе аудит зашумляется), а любое изменение percent/привязки — обязано.

const LABELS: Record<number, string> = {
  1: "6–9 см",
  2: ">12 см",
  3: "<4 см",
};
const labelOf = (id: number) => LABELS[id] ?? String(id);

function c(
  calibreRangeId: number,
  percent: number,
  contractLineId: number | null = null,
): CalibreSnapshot {
  return { calibreRangeId, percent, contractLineId };
}

describe("diffCalibreResults", () => {
  it("одинаковые наборы → null (записи в журнал нет)", () => {
    const set = [c(1, 40, 7), c(2, 55, 8)];
    expect(diffCalibreResults(set, [...set], labelOf)).toBeNull();
  });

  it("пустые наборы → null", () => {
    expect(diffCalibreResults([], [], labelOf)).toBeNull();
  });

  it("изменился процент категории", () => {
    expect(
      diffCalibreResults([c(1, 40, 7)], [c(1, 45, 7)], labelOf),
    ).toBe("6–9 см 40 %→45 %");
  });

  it("изменилась привязка строки контракта, в т.ч. снятие", () => {
    expect(diffCalibreResults([c(2, 10, null)], [c(2, 10, 12)], labelOf)).toBe(
      ">12 см строка: —→12",
    );
    expect(diffCalibreResults([c(2, 10, 12)], [c(2, 10, null)], labelOf)).toBe(
      ">12 см строка: 12→—",
    );
  });

  it("процент и строка сразу — одной записью через запятую", () => {
    expect(diffCalibreResults([c(1, 40, 7)], [c(1, 45, 9)], labelOf)).toBe(
      "6–9 см 40 %→45 %, строка: 7→9",
    );
  });

  it("категория добавлена и категория убрана", () => {
    expect(diffCalibreResults([], [c(1, 100, 7)], labelOf)).toBe(
      "6–9 см добавлена 100 %",
    );
    expect(diffCalibreResults([c(3, 5, null)], [], labelOf)).toBe("<4 см убрана");
  });

  it("несколько изменений — порядок нового набора, удалённые в конце", () => {
    const before = [c(1, 40, 7), c(2, 55, 8), c(3, 5, null)];
    const after = [c(1, 45, 7), c(2, 55, 8)];
    expect(diffCalibreResults(before, after, labelOf)).toBe(
      "6–9 см 40 %→45 %; <4 см убрана",
    );
  });

  it("дробные проценты — до 2 знаков, запятая", () => {
    expect(diffCalibreResults([c(1, 4.5, 7)], [c(1, 6.25, 7)], labelOf)).toBe(
      "6–9 см 4,5 %→6,25 %",
    );
  });

  it("неизвестный id категории — сырой номер вместо подписи, без падения", () => {
    expect(diffCalibreResults([c(99, 1, null)], [c(99, 2, null)], labelOf)).toBe(
      "99 1 %→2 %",
    );
  });
});
