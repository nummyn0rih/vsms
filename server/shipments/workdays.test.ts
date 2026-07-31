import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compareIsoWeek,
  FACTORY_TZ,
  formatWeekParam,
  isFactoryWorkday,
  isoWeek,
  isoWeekRange,
  parseDateUTC,
  parseWeekParam,
  seasonWeekBounds,
  seasonYearOf,
  subtractWorkdays,
  todayLocalISO,
  weekdayName,
  workdaysOfWeek,
  type SeasonWorkdays,
} from "./workdays";

// Инварианты BR-11/17/18: рабочие дни завода, UTC-дисциплина дат, ISO-недели.
// Ожидаемые номера ISO-недель выведены независимо (ординальный алгоритм ISO-8601
// week = ⌊(ordinal − weekday + 10)/7⌋), а не прогоном самой isoWeek.
//
// Календарь-опора (проверено нативным Date):
//   2026-06-01 Пн · 2026-06-06 Сб · 2026-07-04 Сб · 2026-07-05 Вс · 2026-07-15 Ср
//   2026-09-26 Сб · 2026-09-30 Ср · 2026-10-03 Сб · 2026-11-06 Пт · 2026-11-07 Сб
//   2026-01-01 Чт · 2026-12-31 Чт · 2027-01-01 Пт · 2027-01-04 Пн

// Конфиг «как в БД»: лето 01.06–30.09 Пн–Сб, зима Пн–Пт (дефолты BR-18).
const cfgDefault: SeasonWorkdays = {
  summer_start: new Date(Date.UTC(2026, 5, 1)),
  summer_end: new Date(Date.UTC(2026, 8, 30)),
  summer_workdays: [0, 1, 2, 3, 4, 5],
  winter_workdays: [0, 1, 2, 3, 4],
};

describe("parseDateUTC — UTC-дисциплина", () => {
  it("парсит YYYY-MM-DD в UTC-полночь, дата не уезжает на день", () => {
    const d = parseDateUTC("2026-07-15");
    expect(d.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(6);
    expect(d.getUTCDate()).toBe(15);
  });

  it("день недели считается от UTC, а не от локальной таймзоны", () => {
    // 2026-07-05 — воскресенье. При парсинге в локальной TZ (напр. UTC+3) полночь
    // сместилась бы на субботу, и isFactoryWorkday вернул бы true.
    expect(weekdayName(parseDateUTC("2026-07-05"))).toBe("воскресенье");
    expect(weekdayName(parseDateUTC("2026-07-04"))).toBe("суббота");
  });
});

describe("todayLocalISO — заводская TZ (П-10)", () => {
  // Морозим время: без этого тест зависел бы от момента запуска. tz передаём ЯВНО —
  // машина разработчика уже в Europe/Moscow, и проверка на TZ рантайма прошла бы
  // вхолостую, ничего не доказав.
  afterEach(() => {
    vi.useRealTimers();
  });
  function freeze(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  it("00:30 по местному времени, когда в UTC ещё вчера — берётся местная дата", () => {
    freeze("2026-08-01T21:30:00Z"); // 00:30 МСК 2 августа
    expect(todayLocalISO("Europe/Moscow")).toBe("2026-08-02");
    // Ровно то, что делал старый код (new Date().toISOString().slice(0,10)) — ещё вчера.
    expect(todayLocalISO("UTC")).toBe("2026-08-01");
  });

  it("22:30Z — тоже уже следующие сутки в Москве", () => {
    freeze("2026-08-01T22:30:00Z");
    expect(todayLocalISO("Europe/Moscow")).toBe("2026-08-02");
  });

  it("днём смещения нет — обе зоны дают один день", () => {
    freeze("2026-08-01T12:00:00Z");
    expect(todayLocalISO("Europe/Moscow")).toBe("2026-08-01");
    expect(todayLocalISO("UTC")).toBe("2026-08-01");
  });

  it("отрицательное смещение сдвигает дату назад", () => {
    freeze("2026-08-01T02:00:00Z"); // 22:00 31 июля в Нью-Йорке
    expect(todayLocalISO("America/New_York")).toBe("2026-07-31");
  });

  it("однозначные месяц и день паддятся до двух цифр", () => {
    freeze("2026-01-05T12:00:00Z");
    expect(todayLocalISO("Europe/Moscow")).toBe("2026-01-05");
    expect(todayLocalISO("Europe/Moscow")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("дефолт зоны = FACTORY_TZ (Europe/Moscow), молча не уедет", () => {
    freeze("2026-08-01T21:30:00Z");
    expect(FACTORY_TZ).toBe("Europe/Moscow");
    expect(todayLocalISO()).toBe(todayLocalISO(FACTORY_TZ));
    expect(todayLocalISO()).toBe("2026-08-02");
  });

  it("результат парсится parseDateUTC в UTC-полночь — формат хранения не сломан", () => {
    freeze("2026-08-01T21:30:00Z");
    expect(parseDateUTC(todayLocalISO()).toISOString()).toBe("2026-08-02T00:00:00.000Z");
  });
});

describe("isFactoryWorkday — BR-18", () => {
  it("без конфига: лето Пн–Сб (суббота рабочая)", () => {
    expect(isFactoryWorkday(parseDateUTC("2026-07-04"), null)).toBe(true);
  });

  it("без конфига: воскресенье не рабочее ни летом, ни зимой", () => {
    expect(isFactoryWorkday(parseDateUTC("2026-07-05"), null)).toBe(false);
    expect(isFactoryWorkday(parseDateUTC("2026-11-08"), null)).toBe(false);
  });

  it("без конфига: зима Пн–Пт (суббота нерабочая, пятница рабочая)", () => {
    expect(isFactoryWorkday(parseDateUTC("2026-11-07"), null)).toBe(false);
    expect(isFactoryWorkday(parseDateUTC("2026-11-06"), null)).toBe(true);
  });

  it("с конфигом: наборы дней берутся из SeasonConfig, а не из дефолтов", () => {
    // Летом работают только Пн и Вт, зимой — вся неделя включая воскресенье.
    const cfg: SeasonWorkdays = {
      ...cfgDefault,
      summer_workdays: [0, 1],
      winter_workdays: [0, 1, 2, 3, 4, 5, 6],
    };
    expect(isFactoryWorkday(parseDateUTC("2026-07-15"), cfg)).toBe(false); // среда, лето
    expect(isFactoryWorkday(parseDateUTC("2026-07-13"), cfg)).toBe(true); // понедельник
    expect(isFactoryWorkday(parseDateUTC("2026-11-08"), cfg)).toBe(true); // воскресенье, зима
  });

  it("граница сезона включительно: summer_end-суббота ещё летняя, следующая — уже зимняя", () => {
    const cfg: SeasonWorkdays = {
      ...cfgDefault,
      summer_end: new Date(Date.UTC(2026, 8, 26)), // 26.09.2026, суббота
    };
    expect(isFactoryWorkday(parseDateUTC("2026-09-26"), cfg)).toBe(true);
    expect(isFactoryWorkday(parseDateUTC("2026-10-03"), cfg)).toBe(false);
  });

  it("граница сезона включительно: summer_start-суббота уже летняя, предыдущая — ещё зимняя", () => {
    const cfg: SeasonWorkdays = {
      ...cfgDefault,
      summer_start: new Date(Date.UTC(2026, 5, 6)), // 06.06.2026, суббота
    };
    expect(isFactoryWorkday(parseDateUTC("2026-06-06"), cfg)).toBe(true);
    expect(isFactoryWorkday(parseDateUTC("2026-05-30"), cfg)).toBe(false);
  });

  it("год в summer_start/summer_end игнорируется — сравнение только по месяцу и дню", () => {
    // Конфиг выписан на 2020 год, дата — 2026-я: диапазон всё равно применяется.
    const cfg2020: SeasonWorkdays = {
      ...cfgDefault,
      summer_start: new Date(Date.UTC(2020, 5, 1)),
      summer_end: new Date(Date.UTC(2020, 8, 30)),
    };
    expect(isFactoryWorkday(parseDateUTC("2026-07-04"), cfg2020)).toBe(true); // суббота, лето
    expect(isFactoryWorkday(parseDateUTC("2026-11-07"), cfg2020)).toBe(false); // суббота, зима
  });
});

describe("workdaysOfWeek / subtractWorkdays", () => {
  it("летняя неделя даёт 6 рабочих дней, зимняя — 5", () => {
    const summer = workdaysOfWeek(2026, 29, cfgDefault); // 13–19 июля
    const winter = workdaysOfWeek(2026, 46, cfgDefault); // 09–15 ноября
    expect(summer).toHaveLength(6);
    expect(winter).toHaveLength(5);
    expect(summer[0]).toEqual({ date: "2026-07-13", weekdayName: "понедельник" });
    expect(summer[5].date).toBe("2026-07-18"); // суббота включена
    expect(winter[4].date).toBe("2026-11-13"); // пятница — последняя
  });

  it("subtractWorkdays перешагивает нерабочие дни (зима: понедельник −2 → четверг)", () => {
    const from = parseDateUTC("2026-11-09"); // понедельник, зима
    expect(subtractWorkdays(from, 2, cfgDefault).toISOString().slice(0, 10)).toBe(
      "2026-11-05",
    );
  });

  it("subtractWorkdays летом считает субботу рабочим днём", () => {
    const from = parseDateUTC("2026-07-13"); // понедельник, лето
    expect(subtractWorkdays(from, 2, cfgDefault).toISOString().slice(0, 10)).toBe(
      "2026-07-10", // Сб 11-е и Пт 10-е — оба рабочие
    );
  });
});

describe("isoWeek — BR-17, стык года", () => {
  it("2026-07-15 → 2026-W29", () => {
    expect(isoWeek(parseDateUTC("2026-07-15"))).toEqual({ isoYear: 2026, isoWeek: 29 });
  });

  it("31.12.2026 (четверг) → 2026-W53", () => {
    expect(isoWeek(parseDateUTC("2026-12-31"))).toEqual({ isoYear: 2026, isoWeek: 53 });
  });

  it("01.01.2027 (пятница) остаётся в 2026-W53 — ISO-год ≠ календарному", () => {
    expect(isoWeek(parseDateUTC("2027-01-01"))).toEqual({ isoYear: 2026, isoWeek: 53 });
  });

  it("29.12.2025 (понедельник) уже принадлежит 2026-W01", () => {
    expect(isoWeek(parseDateUTC("2025-12-29"))).toEqual({ isoYear: 2026, isoWeek: 1 });
  });

  it("01.01.2026 (четверг) → 2026-W01, 04.01.2027 (понедельник) → 2027-W01", () => {
    expect(isoWeek(parseDateUTC("2026-01-01"))).toEqual({ isoYear: 2026, isoWeek: 1 });
    expect(isoWeek(parseDateUTC("2027-01-04"))).toEqual({ isoYear: 2027, isoWeek: 1 });
  });

  it("isoWeekRange даёт Пн–Вс и round-trip'ится через isoWeek", () => {
    const { start, end } = isoWeekRange(2026, 29);
    expect(start.toISOString().slice(0, 10)).toBe("2026-07-13"); // понедельник
    expect(end.toISOString().slice(0, 10)).toBe("2026-07-19"); // воскресенье
    for (const [y, w] of [
      [2026, 1],
      [2026, 29],
      [2026, 53],
      [2027, 1],
    ] as const) {
      expect(isoWeek(isoWeekRange(y, w).start)).toEqual({ isoYear: y, isoWeek: w });
    }
  });
});

describe("seasonYearOf / seasonWeekBounds — BR-17", () => {
  it("сезон начинается 1 июня", () => {
    expect(seasonYearOf(parseDateUTC("2026-06-01"))).toBe(2026);
    expect(seasonYearOf(parseDateUTC("2026-05-31"))).toBe(2025);
    expect(seasonYearOf(parseDateUTC("2026-12-31"))).toBe(2026);
    expect(seasonYearOf(parseDateUTC("2027-01-15"))).toBe(2026);
  });

  it("границы сезона 2026: первая неделя 2026-W23, последняя 2027-W22", () => {
    const { first, last } = seasonWeekBounds(2026);
    expect(first).toEqual({ isoYear: 2026, isoWeek: 23 });
    expect(last).toEqual({ isoYear: 2027, isoWeek: 22 });
    expect(compareIsoWeek(first, last)).toBe(-1);
  });
});

describe("compareIsoWeek", () => {
  it("сравнивает недели разных лет по ISO-году", () => {
    expect(compareIsoWeek({ isoYear: 2026, isoWeek: 52 }, { isoYear: 2027, isoWeek: 1 })).toBe(-1);
    expect(compareIsoWeek({ isoYear: 2027, isoWeek: 1 }, { isoYear: 2026, isoWeek: 52 })).toBe(1);
  });

  it("внутри года сравнивает по номеру недели, равные → 0", () => {
    expect(compareIsoWeek({ isoYear: 2026, isoWeek: 5 }, { isoYear: 2026, isoWeek: 29 })).toBe(-1);
    expect(compareIsoWeek({ isoYear: 2026, isoWeek: 29 }, { isoYear: 2026, isoWeek: 29 })).toBe(0);
  });
});

describe("formatWeekParam / parseWeekParam", () => {
  it("номер недели паддится до двух цифр", () => {
    expect(formatWeekParam({ isoYear: 2026, isoWeek: 5 })).toBe("2026-W05");
    expect(formatWeekParam({ isoYear: 2026, isoWeek: 29 })).toBe("2026-W29");
  });

  it("валидная неделя разбирается вместе с сезоном", () => {
    expect(parseWeekParam("2026-W29")).toEqual({
      seasonYear: 2026,
      isoYear: 2026,
      isoWeek: 29,
    });
    // Неделя 2026-W05 начинается 26.01.2026 → сезон ещё 2025-й.
    expect(parseWeekParam("2026-W05").seasonYear).toBe(2025);
  });

  it("2026-W53 существует (2026 начинается с четверга), 2025-W53 — нет", () => {
    expect(parseWeekParam("2026-W53")).toMatchObject({ isoYear: 2026, isoWeek: 53 });
    // 2025 — 52-недельный год: round-trip не сходится, отдаётся текущая неделя.
    const fallback = parseWeekParam("2025-W53");
    expect(fallback).not.toMatchObject({ isoYear: 2025, isoWeek: 53 });
  });

  it("мусор и отсутствие параметра дают текущую неделю (не бросают)", () => {
    for (const raw of [undefined, "", "abc", "2026-W00", "2026-W54", "2026-29"]) {
      const r = parseWeekParam(raw);
      expect(r.isoWeek).toBeGreaterThanOrEqual(1);
      expect(r.isoWeek).toBeLessThanOrEqual(53);
    }
  });

  it("массив из searchParams — берётся первый элемент", () => {
    expect(parseWeekParam(["2026-W29", "2026-W30"])).toMatchObject({ isoWeek: 29 });
  });
});
