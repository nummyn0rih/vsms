import type { PlanDay, PlanRow, PlanWeek } from "@/server/plan/schema";

// Общая чистая логика Сводки (десктоп SummaryView + мобильный MobileSummaryView) —
// см. BR-22. Единственный источник этих формул, не дублировать.

export const EPS = 0.0005;

// План культуры для итогов: недельная цель или Σ дневных целей (0 → нет цели).
export function rowPlan(r: PlanRow): number {
  if (r.weekTarget != null) return r.weekTarget;
  return Object.values(r.dayTargets).reduce((s, v) => s + v, 0);
}

// Макс. дневная ячейка строки — база интенсивности заливки (см. cellFill).
// week-mode строки (нет дневной разбивки) → 0, заливка не считается.
export function rowMax(r: PlanRow, days: PlanDay[]): number {
  if (r.mode === "week") return 0;
  return days.reduce((m, d) => Math.max(m, r.dayProgress[d.date]?.effectiveTons ?? 0), 0);
}

// Заливка ячейки по строке (BR-22): интенсивность ∝ значение / макс. ячейка строки.
// opacity% = 18 + 82·value/rowMax (минимальный видимый порог 18%), нулевая → без фона.
// Текст белый при насыщенной заливке (порог по читаемости, как в прототипе).
export const WHITE_TEXT_OPACITY = 58;
export function cellFill(
  value: number,
  rowMax: number,
  color: string,
): { bg?: string; white: boolean } {
  if (value <= EPS || rowMax <= 0) return { white: false };
  const opacity = Math.round(18 + 82 * (value / rowMax));
  return {
    bg: `color-mix(in srgb, ${color} ${opacity}%, transparent)`,
    white: opacity >= WHITE_TEXT_OPACITY,
  };
}

// Headline недели: Σ эффективного / Σ целей — только культуры, у которых есть план
// (BR-22). actualTons/planRemainingTons — та же фильтрация, нужны для прогресс-бара
// итога недели (MobileSummaryView); десктоп их не использует.
export function weekHeadline(week: PlanWeek): {
  plan: number;
  fact: number;
  pct: number | null;
  actualTons: number;
  planRemainingTons: number;
} {
  let plan = 0;
  let fact = 0;
  let actualTons = 0;
  let planRemainingTons = 0;
  for (const r of week.rows) {
    const p = rowPlan(r);
    if (p > EPS) {
      plan += p;
      fact += r.weekProgress.effectiveTons;
      actualTons += r.weekProgress.actualTons;
      planRemainingTons += r.weekProgress.planRemainingTons;
    }
  }
  const pct = plan > EPS ? Math.round((fact / plan) * 100) : null;
  return { plan, fact, pct, actualTons, planRemainingTons };
}

export type WeekBarGeometry = {
  actualPct: number;
  planPct: number;
  overPct: number;
  tickLeft: number | null;
  hasPlan: boolean;
};

// Геометрия итог-бара недели (MobileSummaryView): линейная шкала 0–100% до
// max(plan, fact), без "полки" 95.2% планировщика (barGeometry в PlanView.tsx —
// другой компонент, per-строчный бар BR-22 с риской-целью; здесь простой totals-бар).
export function weekBarGeometry(week: PlanWeek): WeekBarGeometry {
  const { plan, fact, actualTons, planRemainingTons } = weekHeadline(week);
  const hasPlan = plan > EPS;
  const scaleMax = Math.max(plan, fact);
  const overTons = Math.max(0, fact - plan);
  const actualPct = scaleMax > 0 ? Math.min(100, (actualTons / scaleMax) * 100) : 0;
  const planPct =
    scaleMax > 0
      ? Math.max(0, Math.min(100 - actualPct, (planRemainingTons / scaleMax) * 100))
      : 0;
  const overPct =
    hasPlan && scaleMax > 0 ? Math.min(100 - actualPct - planPct, (overTons / scaleMax) * 100) : 0;
  const tickLeft = hasPlan && scaleMax > 0 ? Math.min(100, (plan / scaleMax) * 100) : null;
  return { actualPct, planPct, overPct, tickLeft, hasPlan };
}
