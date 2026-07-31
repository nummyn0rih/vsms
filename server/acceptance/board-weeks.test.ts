import { describe, expect, it } from "vitest";

import {
  groupByArrivalWeek,
  parseAcceptanceView,
  weekGroupKey,
} from "./board-weeks";

// Недельный вид приёмки. Ось — ДАТА ПРИБЫТИЯ (та же, что у ленты отгрузок), недели —
// ISO (год недели у краёв года не равен календарному). Классификация past/current/future
// считается от ПЕРЕДАННОГО «сегодня» — тесты не должны зависеть от реального времени.

const TODAY = new Date("2026-07-15T00:00:00Z"); // среда, ISO-неделя 29 2026 года

const m = (id: number, arrivalDate: string | null) => ({ id, arrivalDate });

describe("groupByArrivalWeek", () => {
  it("пустой вход — пустые недели и пустая корзина «без даты»", () => {
    expect(groupByArrivalWeek([], TODAY)).toEqual({ weeks: [], undated: [] });
  });

  it("группирует по ISO-неделе прибытия, недели — по возрастанию", () => {
    const { weeks } = groupByArrivalWeek(
      [m(1, "2026-07-15"), m(2, "2026-07-06"), m(3, "2026-07-13")],
      TODAY,
    );
    expect(weeks.map((w) => w.isoWeek)).toEqual([28, 29]);
    expect(weeks[0].machines.map((x) => x.id)).toEqual([2]);
    expect(weeks[1].machines.map((x) => x.id)).toEqual([1, 3]);
  });

  it("границы недели — понедельник и воскресенье", () => {
    const [w] = groupByArrivalWeek([m(1, "2026-07-15")], TODAY).weeks;
    expect(w.startDate).toBe("2026-07-13");
    expect(w.endDate).toBe("2026-07-19");
  });

  it("position считается от переданного «сегодня»", () => {
    const { weeks } = groupByArrivalWeek(
      [m(1, "2026-07-06"), m(2, "2026-07-15"), m(3, "2026-07-22")],
      TODAY,
    );
    expect(weeks.map((w) => w.position)).toEqual(["past", "current", "future"]);
  });

  it("машины без даты прибытия уходят в undated и не теряются", () => {
    const input = [m(1, "2026-07-15"), m(2, null), m(3, null), m(4, "2026-07-06")];
    const { weeks, undated } = groupByArrivalWeek(input, TODAY);
    expect(undated.map((x) => x.id)).toEqual([2, 3]);
    expect(weeks.flatMap((w) => w.machines).length + undated.length).toBe(input.length);
  });

  it("порядок машин внутри недели сохраняется (порядок лоадера)", () => {
    const { weeks } = groupByArrivalWeek(
      [m(10, "2026-07-13"), m(20, "2026-07-15"), m(30, "2026-07-14")],
      TODAY,
    );
    expect(weeks[0].machines.map((x) => x.id)).toEqual([10, 20, 30]);
  });

  it("стык года: 29 декабря 2025 — это ISO-неделя 1 2026 года", () => {
    const [w] = groupByArrivalWeek([m(1, "2025-12-29")], TODAY).weeks;
    expect({ isoYear: w.isoYear, isoWeek: w.isoWeek }).toEqual({
      isoYear: 2026,
      isoWeek: 1,
    });
    expect(w.position).toBe("past");
  });

  it("недели сортируются по ISO-году, а не по номеру недели", () => {
    const { weeks } = groupByArrivalWeek(
      [m(1, "2026-07-15"), m(2, "2025-12-29")],
      TODAY,
    );
    expect(weeks.map((w) => `${w.isoYear}-${w.isoWeek}`)).toEqual(["2026-1", "2026-29"]);
  });
});

describe("weekGroupKey", () => {
  it("одна и та же неделя в разных зонах даёт РАЗНЫЕ ключи", () => {
    const week = { isoYear: 2026, isoWeek: 31 };
    expect(weekGroupKey("z1", week)).toBe("z1:2026-31");
    expect(weekGroupKey("z3", week)).not.toBe(weekGroupKey("z1", week));
  });

  it("корзина «без даты» — свой ключ на зону", () => {
    expect(weekGroupKey("z2", null)).toBe("z2:undated");
  });
});

describe("parseAcceptanceView", () => {
  it("«weeks» включает недельный вид", () => {
    expect(parseAcceptanceView("weeks")).toBe("weeks");
    expect(parseAcceptanceView(["weeks", "list"])).toBe("weeks");
  });

  it("отсутствие и мусор дают сплошной список (текущее поведение экрана)", () => {
    expect(parseAcceptanceView(undefined)).toBe("list");
    expect(parseAcceptanceView("")).toBe("list");
    expect(parseAcceptanceView("недели")).toBe("list");
    expect(parseAcceptanceView([])).toBe("list");
  });
});
