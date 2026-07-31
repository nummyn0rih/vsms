import { isoWeek, isoWeekRange, parseDateUTC } from "@/server/shipments/workdays";

// Период расчётного листа (вкладка «Расчёты»): сезон · месяц · неделя · свой диапазон.
// Состояние живёт в URL (?period=&from=&to=), НЕ в localStorage.
//
// Отдельный файл от settlement-agg.ts намеренно: его импортирует КЛИЕНТСКИЙ
// SettlementPeriodBar, а settlement-agg тянет Prisma.Decimal (сгенерированный клиент
// в браузерном бандле недопустим). Здесь — только workdays.ts, он тоже prisma-free
// и уже используется клиентскими компонентами ленты/планировщика.

export type SettlementPeriodKind = "season" | "month" | "week" | "custom";

export type SettlementPeriod = {
  kind: SettlementPeriodKind;
  from: string | null; // YYYY-MM-DD, граница ВКЛЮЧИТЕЛЬНАЯ; null = с начала сезона
  to: string | null; // ВКЛЮЧИТЕЛЬНАЯ; null = до конца сезона
  label: string; // «Сезон 2026» · «Август 2026» · «Неделя 32 · 3–9 авг»
  isSeason: boolean; // true → периодные и сезонные числа тождественны
};

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTHS_SHORT = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// YYYY-MM-DD, существующая дата. Round-trip отсекает 2026-02-30 (Date его «донормирует»).
function isValidISODate(s: string | undefined): s is string {
  if (typeof s !== "string" || !ISO_DATE_RE.test(s)) return false;
  const d = parseDateUTC(s);
  return !Number.isNaN(d.getTime()) && toISO(d) === s;
}

function fmtRuDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function seasonPeriod(season: number): SettlementPeriod {
  return { kind: "season", from: null, to: null, label: `Сезон ${season}`, isSeason: true };
}

// Календарный месяц, содержащий anchor. Day 0 следующего месяца = последний день текущего.
function monthPeriod(anchorISO: string): SettlementPeriod {
  const d = parseDateUTC(anchorISO);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    kind: "month",
    from: toISO(new Date(Date.UTC(y, m, 1))),
    to: toISO(new Date(Date.UTC(y, m + 1, 0))),
    label: `${MONTHS[m]} ${y}`,
    isSeason: false,
  };
}

// ISO-неделя, содержащая anchor (тот же алгоритм, что у ленты и планировщика).
function weekPeriod(anchorISO: string): SettlementPeriod {
  const w = isoWeek(parseDateUTC(anchorISO));
  const { start, end } = isoWeekRange(w.isoYear, w.isoWeek);
  const m1 = start.getUTCMonth();
  const m2 = end.getUTCMonth();
  const range =
    m1 === m2
      ? `${start.getUTCDate()}–${end.getUTCDate()} ${MONTHS_SHORT[m1]}`
      : `${start.getUTCDate()} ${MONTHS_SHORT[m1]} – ${end.getUTCDate()} ${MONTHS_SHORT[m2]}`;
  return {
    kind: "week",
    from: toISO(start),
    to: toISO(end),
    label: `Неделя ${w.isoWeek} · ${range}`,
    isSeason: false,
  };
}

// Разбор ?period=&from=&to= из URL. Любой невалид (чужой формат, 2026-02-30, from > to,
// отсутствующий anchor) молча падает в «сезон» — то же правило, что у parseWeekParam.
// Для month/week `from` — это ЯКОРЬ (любая дата внутри периода), границы пересчитываются,
// поэтому устаревший `to` в URL испортить ничего не может.
export function resolveSettlementPeriod(input: {
  period?: string;
  from?: string;
  to?: string;
  season: number;
  today: string; // todayLocalISO()
}): SettlementPeriod {
  const { period, from, to, season, today } = input;
  const anchor = isValidISODate(from) ? from : isValidISODate(today) ? today : null;

  if (period === "month" && anchor) return monthPeriod(anchor);
  if (period === "week" && anchor) return weekPeriod(anchor);
  if (period === "custom" && isValidISODate(from) && isValidISODate(to) && from <= to) {
    return {
      kind: "custom",
      from,
      to,
      label: `${fmtRuDate(from)} – ${fmtRuDate(to)}`,
      isSeason: false,
    };
  }
  return seasonPeriod(season);
}

// Стрелки ‹ ›: сдвиг на месяц / на ISO-неделю. Сезон и свой диапазон не сдвигаются
// (у них стрелок нет) — возвращаем период без изменений.
export function shiftSettlementPeriod(
  p: SettlementPeriod,
  dir: -1 | 1,
): SettlementPeriod {
  if (p.from == null) return p;
  const d = parseDateUTC(p.from);
  if (p.kind === "month") {
    return monthPeriod(
      toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1))),
    );
  }
  if (p.kind === "week") {
    return weekPeriod(toISO(new Date(d.getTime() + dir * 7 * DAY_MS)));
  }
  return p;
}

// Границы ВКЛЮЧИТЕЛЬНЫЕ. Позиция без даты входит только в «сезон»: в узкое окно её
// положить некуда, поэтому она считается отдельно (notes.undatedCount) — иначе Σ по
// месяцам молча не сошлась бы с сезоном.
export function isInPeriod(dateISO: string | null, p: SettlementPeriod): boolean {
  if (p.from == null && p.to == null) return true;
  if (dateISO == null) return false;
  if (p.from != null && dateISO < p.from) return false;
  if (p.to != null && dateISO > p.to) return false;
  return true;
}

// Подпись периода для заголовков колонок: «за август», «за неделю 33», «за период».
// Для сезона — пусто (колонка и так сезонная, суффикс был бы шумом).
export function periodColumnSuffix(p: SettlementPeriod): string {
  if (p.kind === "season") return "";
  if (p.kind === "month") return `за ${MONTHS[parseDateUTC(p.from!).getUTCMonth()].toLowerCase()}`;
  if (p.kind === "week") return `за неделю ${isoWeek(parseDateUTC(p.from!)).isoWeek}`;
  return "за период";
}
