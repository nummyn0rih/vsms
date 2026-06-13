import {
  DEFAULT_SUMMER_WORKDAYS,
  DEFAULT_WINTER_WORKDAYS,
} from "@/server/seasons/schema";

// Рабочие дни завода (BR-11, BR-17, BR-18). Чистые функции БЕЗ обращения к БД —
// SeasonConfig приходит параметром. Переиспользуются в B5 (доска) и при правках дат.

// Узкий тип: нужны только поля рабочих дней и границы лета. Совместим с Prisma
// SeasonConfig (там это DateTime + Int[]), но не тянем зависимость от клиента.
export type SeasonWorkdays = {
  summer_start: Date;
  summer_end: Date;
  summer_workdays: number[];
  winter_workdays: number[];
};

// Парсинг YYYY-MM-DD в UTC-полночь: день недели не должен плыть от таймзоны сервера.
export function parseDateUTC(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

// season_year = год начала сезона (июнь, BR-17). Месяц >= июнь → год даты, иначе год−1.
export function seasonYearOf(date: Date): number {
  const month = date.getUTCMonth(); // 0=янв … 5=июнь
  const year = date.getUTCFullYear();
  return month >= 5 ? year : year - 1;
}

// Дефолтные летние месяцы (июнь–сентябрь, BR-18), когда SeasonConfig не заведён.
const DEFAULT_SUMMER_MONTHS = [5, 6, 7, 8]; // 0-индекс: июнь..сентябрь

// Сравнение «дата внутри [start, end]» по (месяц, день), без учёта года: лето
// (июнь–сент) не пересекает границу года, поэтому это безопасно и не зависит от
// того, на какой год выписан SeasonConfig.
function withinSummerRange(date: Date, start: Date, end: Date): boolean {
  const md = (d: Date) => d.getUTCMonth() * 100 + d.getUTCDate();
  return md(date) >= md(start) && md(date) <= md(end);
}

// 0=Пн … 6=Вс (формат SeasonConfig). JS getUTCDay(): 0=Вс … 6=Сб.
function weekdayMonFirst(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/**
 * Рабочий ли это день завода. cfg=null → дефолты BR-18 (лето Пн–Сб, зима Пн–Пт).
 * Дата ожидается в UTC (см. parseDateUTC).
 */
export function isFactoryWorkday(date: Date, cfg: SeasonWorkdays | null): boolean {
  const isSummer = cfg
    ? withinSummerRange(date, cfg.summer_start, cfg.summer_end)
    : DEFAULT_SUMMER_MONTHS.includes(date.getUTCMonth());

  const workdays = isSummer
    ? (cfg?.summer_workdays ?? DEFAULT_SUMMER_WORKDAYS)
    : (cfg?.winter_workdays ?? DEFAULT_WINTER_WORKDAYS);

  return workdays.includes(weekdayMonFirst(date));
}

// Названия дней недели в формате 0=Пн … 6=Вс — для текста ошибки BR-11.
const WEEKDAY_NAMES = [
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
];

export function weekdayName(date: Date): string {
  return WEEKDAY_NAMES[weekdayMonFirst(date)];
}

// --- ISO-недели (BR-17). Единый источник для ленты B3 (группировка/скролл). ---

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Номер ISO-недели + ISO-год (могут отличаться от календарного у краёв года).
// Алгоритм «ближайший четверг»: неделя, которой принадлежит четверг этой даты.
export function isoWeek(date: Date): { isoYear: number; isoWeek: number } {
  // Четверг текущей ISO-недели (Пн=0 … Вс=6 → сдвиг к четвергу).
  const thursday = new Date(date);
  thursday.setUTCDate(thursday.getUTCDate() - weekdayMonFirst(date) + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - weekdayMonFirst(firstThursday) + 3,
  );
  const week =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * MS_PER_DAY));
  return { isoYear, isoWeek: week };
}

// Пн и Вс ISO-недели (UTC-полночь) — для дат в шапке недели и обхода дней.
export function isoWeekRange(
  isoYear: number,
  week: number,
): { start: Date; end: Date } {
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - weekdayMonFirst(firstThursday) + 3,
  );
  // Понедельник нужной недели = четверг недели 1 − 3 дня + (week−1) недель.
  const monday = new Date(firstThursday);
  monday.setUTCDate(monday.getUTCDate() - 3 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { start: monday, end: sunday };
}

// ISO-неделя + сезон «сегодня» (по умолчанию) — для авто-скролла и правил
// сворачивания ленты (срез 2/3).
export function currentSeasonWeek(date: Date = new Date()): {
  isoYear: number;
  isoWeek: number;
  seasonYear: number;
} {
  const { isoYear, isoWeek: week } = isoWeek(date);
  return { isoYear, isoWeek: week, seasonYear: seasonYearOf(date) };
}

// Сравнение (isoYear, isoWeek) для классификации past/current/future.
export function compareIsoWeek(
  a: { isoYear: number; isoWeek: number },
  b: { isoYear: number; isoWeek: number },
): -1 | 0 | 1 {
  if (a.isoYear !== b.isoYear) return a.isoYear < b.isoYear ? -1 : 1;
  if (a.isoWeek !== b.isoWeek) return a.isoWeek < b.isoWeek ? -1 : 1;
  return 0;
}
