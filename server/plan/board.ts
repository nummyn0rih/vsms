import { prisma } from "@/lib/prisma";
import {
  isoWeekRange,
  weekdayName,
  isFactoryWorkday,
  type SeasonWorkdays,
} from "@/server/shipments/workdays";
import type { PlanDay, PlanRow, PlanWeek } from "./schema";

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
  const [cultures, plans, cfg] = await Promise.all([
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
  ]);

  const { start, end } = isoWeekRange(isoYear, isoWeek);
  const days = workdaysOfWeek(isoYear, isoWeek, cfg);

  // Группируем строки плана по культуре: недельная (date=null) или дневные (date).
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

  const rows: PlanRow[] = cultures.map((c) => {
    const weekTarget = weekTargetByCulture.get(c.id) ?? null;
    const dayTargets = dayTargetsByCulture.get(c.id) ?? {};
    // Режим: есть недельная → week; есть дневные → day; пусто → day (дефолт ввода).
    const mode: "day" | "week" = weekTarget != null ? "week" : "day";
    return {
      cultureId: c.id,
      cultureName: c.name,
      color: c.color,
      mode,
      weekTarget,
      dayTargets,
    };
  });

  return {
    seasonYear,
    isoYear,
    isoWeek,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    days,
    rows,
  };
}
