import type { PlanRow, PlanWeek } from "@/server/plan/schema";

// Общая чистая логика итогов «Плана» (десктоп PlanView + печатный лист /print/plan) —
// см. BR-22/23. Единственный источник этих формул, не дублировать. Симметрично
// summary-fill.ts для «Сводки». Эффективный факт (dayTotalsProgress/weekTotalProgress)
// уже просуммирован в граммах в board.ts — читать оттуда, здесь только суммы целей.

export const EPS = 0.0005;

// Недельная цель строки: week-режим → weekTarget; day-режим → Σ дневных целей.
export function rowWeekTotal(r: PlanRow): number {
  return r.mode === "week"
    ? (r.weekTarget ?? 0)
    : Object.values(r.dayTargets).reduce((s, v) => s + v, 0);
}

// Цель недели по строке для бара/итогов: null, если целей нет (0).
export function rowWeekTarget(r: PlanRow): number | null {
  const t = rowWeekTotal(r);
  return t > 0 ? t : null;
}

// Итоги целей по колонкам-дням (только day-режим; выровнено с week.days).
export function planDayTotals(week: PlanWeek): number[] {
  return week.days.map((d) =>
    week.rows.reduce(
      (s, r) => s + (r.mode === "day" ? (r.dayTargets[d.date] ?? 0) : 0),
      0,
    ),
  );
}

// Σ недельных целей всех строк.
export function weekGrandTotal(week: PlanWeek): number {
  return week.rows.reduce((s, r) => s + rowWeekTotal(r), 0);
}

// Headline «набрано» (BR-22): Σ эффективного только по строкам, у которых есть цель.
// Факт неплановых культур в выполнение плана не идёт.
export function planHeadlineEffective(week: PlanWeek): number {
  return week.rows.reduce(
    (s, r) => s + (rowWeekTarget(r) != null ? r.weekProgress.effectiveTons : 0),
    0,
  );
}
