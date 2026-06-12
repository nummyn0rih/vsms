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
