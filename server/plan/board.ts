import { prisma } from "@/lib/prisma";
import {
  isoWeekRange,
  weekdayName,
  isFactoryWorkday,
  type SeasonWorkdays,
} from "@/server/shipments/workdays";
import type { CellProgress, PlanDay, PlanRow, PlanWeek } from "./schema";

// Веса — Decimal(12,3) кг. Накапливаем целыми граммами (kg×1000), чтобы суммы были
// точными без float-погрешности; на выходе граммы→тонны (÷1e6).
const KG_TO_G = 1000;
const G_PER_TON = 1_000_000;
const toGrams = (d: { toNumber(): number }): number => Math.round(d.toNumber() * KG_TO_G);
const gramsToTons = (g: number): number => g / G_PER_TON;

// Аккумулятор прогресса в граммах. actual ?? planned (BR-22): позиция с перевеской
// идёт в actual, без — в planRemaining.
type ProgAcc = { actualG: number; planG: number };
const newAcc = (): ProgAcc => ({ actualG: 0, planG: 0 });
function addItem(acc: ProgAcc, plannedG: number, actualG: number | null): void {
  if (actualG != null) acc.actualG += actualG;
  else acc.planG += plannedG;
}
function finishAcc(acc: ProgAcc): CellProgress {
  return {
    actualTons: gramsToTons(acc.actualG),
    planRemainingTons: gramsToTons(acc.planG),
    effectiveTons: gramsToTons(acc.actualG + acc.planG),
  };
}
const EMPTY_PROGRESS: CellProgress = {
  actualTons: 0,
  planRemainingTons: 0,
  effectiveTons: 0,
};

// Загрузчик сетки плана (B4a). Server-only (тянет prisma) — типы для client лежат
// в schema.ts. Колонки = рабочие дни ISO-недели (SeasonConfig). Режим гранулярности
// культуры выводится из наличия дневных/недельной строк WeeklyPlan (BR-20).

// Рабочие дни ISO-недели в порядке Пн→Вс (только рабочие, BR-18).
function workdaysOfWeek(
  isoYear: number,
  isoWeek: number,
  cfg: SeasonWorkdays | null,
): PlanDay[] {
  const { start } = isoWeekRange(isoYear, isoWeek);
  const days: PlanDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    if (!isFactoryWorkday(d, cfg)) continue;
    days.push({ date: d.toISOString().slice(0, 10), weekdayName: weekdayName(d) });
  }
  return days;
}

export async function getPlanWeek({
  seasonYear,
  isoYear,
  isoWeek,
}: {
  seasonYear: number;
  isoYear: number;
  isoWeek: number;
}): Promise<PlanWeek> {
  const { start, end } = isoWeekRange(isoYear, isoWeek);
  // Полуинтервал [Пн, следующий Пн): покрывает Пн–Вс целиком (отгрузки нерабочих
  // дней попадут в недельный итог, но не в дневную колонку).
  const nextMonday = new Date(start);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);

  const [cultures, plans, cfg, items] = await Promise.all([
    prisma.culture.findMany({
      where: { active: true },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
    prisma.weeklyPlan.findMany({
      where: { iso_year: isoYear, iso_week: isoWeek },
      select: { culture_id: true, date: true, target_tons: true },
    }),
    prisma.seasonConfig.findUnique({ where: { season_year: seasonYear } }),
    // Прогресс (BR-22): все неудалённые отгрузки всех статусов за неделю по дате
    // прибытия. Soft-delete у Shipment нет — отдельный фильтр не нужен.
    prisma.shipmentItem.findMany({
      where: { shipment: { arrival_date: { gte: start, lt: nextMonday } } },
      select: {
        culture_id: true,
        planned_weight_kg: true,
        actual_weight_kg: true,
        shipment: { select: { arrival_date: true } },
      },
    }),
  ]);

  const days = workdaysOfWeek(isoYear, isoWeek, cfg);
  const dayDates = new Set(days.map((d) => d.date));

  // Группируем строки плана по культуре: недельная (date=null) или дневные (date).
  // Считаем заранее — нужно ДО агрегации прогресса (week-mode культуры не идут в
  // дневные ячейки/подытоги, BR-23).
  const weekTargetByCulture = new Map<number, number>();
  const dayTargetsByCulture = new Map<number, Record<string, number>>();
  for (const p of plans) {
    const tons = p.target_tons.toNumber();
    if (p.date == null) {
      weekTargetByCulture.set(p.culture_id, tons);
    } else {
      const key = p.date.toISOString().slice(0, 10);
      const m = dayTargetsByCulture.get(p.culture_id) ?? {};
      m[key] = tons;
      dayTargetsByCulture.set(p.culture_id, m);
    }
  }
  const weekModeCultureIds = new Set(weekTargetByCulture.keys());

  // Агрегация прогресса: по (культура, дата) — дневные ячейки; по культуре — недельный
  // итог; по дате — колонки tfoot; общий — grand total. Все суммы в граммах.
  const dayAccByCulture = new Map<number, Map<string, ProgAcc>>();
  const weekAccByCulture = new Map<number, ProgAcc>();
  const dayTotalAcc = new Map<string, ProgAcc>();
  const grandAcc = newAcc();
  for (const it of items) {
    if (!it.shipment.arrival_date) continue;
    const dateStr = it.shipment.arrival_date.toISOString().slice(0, 10);
    const plannedG = toGrams(it.planned_weight_kg);
    const actualG = it.actual_weight_kg != null ? toGrams(it.actual_weight_kg) : null;

    // Недельный итог культуры — по всем дням недели.
    let wk = weekAccByCulture.get(it.culture_id);
    if (!wk) weekAccByCulture.set(it.culture_id, (wk = newAcc()));
    addItem(wk, plannedG, actualG);
    addItem(grandAcc, plannedG, actualG);

    // Дневные ячейки/колонки — только по отображаемым рабочим дням. week-mode
    // культура (цель date=null) в дневные ячейки и подытоги НЕ идёт (BR-23) —
    // её факт виден только в колонке «Неделя».
    if (!dayDates.has(dateStr)) continue;
    if (weekModeCultureIds.has(it.culture_id)) continue;
    let perDate = dayAccByCulture.get(it.culture_id);
    if (!perDate) dayAccByCulture.set(it.culture_id, (perDate = new Map()));
    let cell = perDate.get(dateStr);
    if (!cell) perDate.set(dateStr, (cell = newAcc()));
    addItem(cell, plannedG, actualG);

    let col = dayTotalAcc.get(dateStr);
    if (!col) dayTotalAcc.set(dateStr, (col = newAcc()));
    addItem(col, plannedG, actualG);
  }

  const rows: PlanRow[] = cultures.map((c) => {
    const weekTarget = weekTargetByCulture.get(c.id) ?? null;
    const dayTargets = dayTargetsByCulture.get(c.id) ?? {};
    // Режим: есть недельная → week; есть дневные → day; пусто → day (дефолт ввода).
    const mode: "day" | "week" = weekTarget != null ? "week" : "day";

    const perDate = dayAccByCulture.get(c.id);
    const dayProgress: Record<string, CellProgress> = {};
    if (perDate) {
      for (const [date, acc] of perDate) dayProgress[date] = finishAcc(acc);
    }
    const wk = weekAccByCulture.get(c.id);
    const weekProgress = wk ? finishAcc(wk) : EMPTY_PROGRESS;

    return {
      cultureId: c.id,
      cultureName: c.name,
      color: c.color,
      mode,
      weekTarget,
      dayTargets,
      dayProgress,
      weekProgress,
    };
  });

  const dayTotalsProgress: CellProgress[] = days.map((d) => {
    const acc = dayTotalAcc.get(d.date);
    return acc ? finishAcc(acc) : EMPTY_PROGRESS;
  });
  const weekTotalProgress = finishAcc(grandAcc);

  return {
    seasonYear,
    isoYear,
    isoWeek,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    days,
    rows,
    dayTotalsProgress,
    weekTotalProgress,
  };
}
