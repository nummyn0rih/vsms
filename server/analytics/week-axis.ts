import { isoWeek, isoWeekRange } from "@/server/shipments/workdays";

// Ось ISO-недель и подпись недели — БЕЗ prisma, чтобы ими могли пользоваться чистые ядра
// (server/farmers/quality-agg.ts тестируется без БД). Раньше эти три функции жили в
// ./dashboard, который импортирует prisma на верхнем уровне: юнит-тест ядра тянул бы за
// собой клиент БД. Тела перенесены вербатим; dashboard их ре-экспортирует.

// Порог показа недельного графика: меньше четырёх точек — линия рисует шум как тренд.
// Общий для «Качества» и «Аналитики» карточки поставщика: «тот же порог» не должен
// существовать в двух копиях, иначе одна из вкладок однажды поедет.
export const MIN_WEEKS_FOR_CHART = 4;

export function weekLabel(week: number): string {
  return `W${String(week).padStart(2, "0")}`;
}

// Следующая ISO-неделя (через дату — корректно на границе года).
export function nextIsoWeek(
  isoYear: number,
  week: number,
): { isoYear: number; isoWeek: number } {
  const { start } = isoWeekRange(isoYear, week);
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + 7);
  return isoWeek(d);
}

// Сплошная ось ISO-недель min..max по набору присутствующих недель (дырки не пропускаем —
// иначе график врёт по длительности пауз). Общая для дашборда и профиля культуры.
export function buildWeekAxis(
  weeks: { isoYear: number; isoWeek: number }[],
): { isoYear: number; isoWeek: number; label: string }[] {
  if (weeks.length === 0) return [];
  const sorted = [...weeks].sort((a, b) => a.isoYear - b.isoYear || a.isoWeek - b.isoWeek);
  const last = sorted[sorted.length - 1];
  const axis: { isoYear: number; isoWeek: number; label: string }[] = [];
  let cur = { isoYear: sorted[0].isoYear, isoWeek: sorted[0].isoWeek };
  // защитный предел итераций (сезон ≤ ~60 недель)
  for (let guard = 0; guard < 70; guard++) {
    axis.push({ ...cur, label: weekLabel(cur.isoWeek) });
    if (cur.isoYear === last.isoYear && cur.isoWeek === last.isoWeek) break;
    cur = nextIsoWeek(cur.isoYear, cur.isoWeek);
  }
  return axis;
}
