"use server";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import {
  isoWeek,
  isoWeekRange,
  parseDateUTC,
  isFactoryWorkday,
  type SeasonWorkdays,
} from "@/server/shipments/workdays";
import {
  ENTITY,
  planKeySchema,
  upsertPlanTargetSchema,
  deletePlanTargetSchema,
  type PlanKey,
  type UpsertPlanTargetInput,
  type DeletePlanTargetInput,
  type PlanWeek,
} from "./schema";
import { getPlanWeek } from "./board";

function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

// Дробь после запятой в Decimal(12,3) — 3 знака. Считаем в милли-тоннах (целых),
// чтобы суммы/распределение были точными (без float-погрешности).
const MT = 1000;
const toMt = (tons: number) => Math.round(tons * MT);
const fromMt = (mt: number) => mt / MT;

// Загрузка сетки недели для клиента (смена недели — на клиенте). Чтение доступно
// всем аутентифицированным; правки/конверсия — только admin (ниже).
export async function loadPlanWeek(args: {
  seasonYear: number;
  isoYear: number;
  isoWeek: number;
}): Promise<PlanWeek | null> {
  try {
    await requireRole();
    return await getPlanWeek(args);
  } catch {
    return null;
  }
}

// Проверка BR-20: в (неделя,культура) одна гранулярность. Возвращает текст ошибки
// при конфликте, иначе null. db — клиент транзакции или глобальный prisma.
async function granularityConflict(
  key: PlanKey,
  writingDay: boolean,
  db: Pick<typeof prisma, "weeklyPlan"> = prisma,
): Promise<string | null> {
  if (writingDay) {
    // Пишем дневную цель — не должно быть недельной строки.
    const weekly = await db.weeklyPlan.findFirst({
      where: {
        iso_year: key.isoYear,
        iso_week: key.isoWeek,
        culture_id: key.cultureId,
        date: null,
      },
      select: { id: true },
    });
    return weekly
      ? "На неделе задана цель «на неделю». Сначала смените гранулярность на «по дням»."
      : null;
  }
  // Пишем недельную цель — не должно быть дневных строк.
  const daily = await db.weeklyPlan.findFirst({
    where: {
      iso_year: key.isoYear,
      iso_week: key.isoWeek,
      culture_id: key.cultureId,
      date: { not: null },
    },
    select: { id: true },
  });
  return daily
    ? "На неделе заданы цели «по дням». Сначала смените гранулярность на «на неделю»."
    : null;
}

export async function upsertPlanTarget(
  input: UpsertPlanTargetInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = upsertPlanTargetSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Проверьте значение цели" };
    }
    const { seasonYear, isoYear, isoWeek: week, cultureId, date, targetTons } =
      parsed.data;

    // Дневная дата обязана принадлежать указанной ISO-неделе (защита от рассинхрона).
    if (date != null) {
      const w = isoWeek(parseDateUTC(date));
      if (w.isoYear !== isoYear || w.isoWeek !== week) {
        return { ok: false, error: "Дата не входит в указанную неделю" };
      }
    }

    const conflict = await granularityConflict(
      { seasonYear, isoYear, isoWeek: week, cultureId },
      date != null,
    );
    if (conflict) return { ok: false, error: conflict };

    // Partial-unique нельзя использовать в prisma upsert (условный индекс) — читаем
    // существующую строку и пишем вручную.
    const existing = await prisma.weeklyPlan.findFirst({
      where: {
        iso_year: isoYear,
        iso_week: week,
        culture_id: cultureId,
        date: date == null ? null : parseDateUTC(date),
      },
      select: { id: true, target_tons: true },
    });

    const next = fromMt(toMt(targetTons));
    if (existing && existing.target_tons.toNumber() === next) {
      return { ok: true };
    }

    if (existing) {
      await prisma.weeklyPlan.update({
        where: { id: existing.id },
        data: { target_tons: next, season_year: seasonYear },
      });
      await logChange(
        {
          entity: ENTITY,
          entityId: existing.id,
          field: "target_tons",
          oldValue: String(existing.target_tons.toNumber()),
          newValue: String(next),
        },
        Number(user.id),
      );
    } else {
      const created = await prisma.weeklyPlan.create({
        data: {
          season_year: seasonYear,
          iso_year: isoYear,
          iso_week: week,
          culture_id: cultureId,
          date: date == null ? null : parseDateUTC(date),
          target_tons: next,
        },
      });
      await logChange(
        {
          entity: ENTITY,
          entityId: created.id,
          field: "created",
          newValue: String(next),
        },
        Number(user.id),
      );
    }

    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить цель" };
  }
}

export async function deletePlanTarget(
  input: DeletePlanTargetInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = deletePlanTargetSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Некорректные данные" };
    const { isoYear, isoWeek: week, cultureId, date } = parsed.data;

    const existing = await prisma.weeklyPlan.findFirst({
      where: {
        iso_year: isoYear,
        iso_week: week,
        culture_id: cultureId,
        date: date == null ? null : parseDateUTC(date),
      },
      select: { id: true, target_tons: true },
    });
    if (!existing) return { ok: true }; // идемпотентно: нечего удалять

    await prisma.weeklyPlan.delete({ where: { id: existing.id } });
    await logChange(
      {
        entity: ENTITY,
        entityId: existing.id,
        field: "deleted",
        oldValue: String(existing.target_tons.toNumber()),
      },
      Number(user.id),
    );

    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось удалить цель" };
  }
}

// BR-21: день→неделя. Дневные строки заменяются одной недельной, target = Σ дневных.
export async function convertDaysToWeek(input: PlanKey): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = planKeySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Некорректные данные" };
    const { seasonYear, isoYear, isoWeek: week, cultureId } = parsed.data;

    await prisma.$transaction(async (tx) => {
      const daily = await tx.weeklyPlan.findMany({
        where: {
          iso_year: isoYear,
          iso_week: week,
          culture_id: cultureId,
          date: { not: null },
        },
        select: { id: true, target_tons: true },
      });
      if (daily.length === 0) return; // нечего конвертировать

      const sumMt = daily.reduce((s, r) => s + toMt(r.target_tons.toNumber()), 0);

      await tx.weeklyPlan.deleteMany({
        where: { id: { in: daily.map((d) => d.id) } },
      });
      const created = await tx.weeklyPlan.create({
        data: {
          season_year: seasonYear,
          iso_year: isoYear,
          iso_week: week,
          culture_id: cultureId,
          date: null,
          target_tons: fromMt(sumMt),
        },
      });

      await logChange(
        [
          {
            entity: ENTITY,
            entityId: cultureId,
            field: "convert_days_to_week",
            oldValue: `${daily.length} дн.`,
            newValue: String(fromMt(sumMt)),
          },
          {
            entity: ENTITY,
            entityId: created.id,
            field: "created",
            newValue: String(fromMt(sumMt)),
          },
        ],
        Number(user.id),
        tx,
      );
    });

    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось сменить гранулярность" };
  }
}

// BR-21: неделя→дни. Недельная строка заменяется дневными по рабочим дням недели;
// target распределяется равномерно, остаток — на последний рабочий день (Σ точно).
export async function convertWeekToDays(input: PlanKey): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = planKeySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Некорректные данные" };
    const { seasonYear, isoYear, isoWeek: week, cultureId } = parsed.data;

    const cfg: SeasonWorkdays | null = await prisma.seasonConfig.findUnique({
      where: { season_year: seasonYear },
    });

    // Рабочие дни этой ISO-недели (Пн→Вс).
    const { start } = isoWeekRange(isoYear, week);
    const workdays: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      if (isFactoryWorkday(d, cfg)) workdays.push(d);
    }
    if (workdays.length === 0) {
      return { ok: false, error: "В неделе нет рабочих дней" };
    }

    const result = await prisma.$transaction(async (tx) => {
      const weekly = await tx.weeklyPlan.findFirst({
        where: {
          iso_year: isoYear,
          iso_week: week,
          culture_id: cultureId,
          date: null,
        },
        select: { id: true, target_tons: true },
      });
      if (!weekly) return false; // нечего конвертировать

      const totalMt = toMt(weekly.target_tons.toNumber());
      const n = workdays.length;
      const base = Math.floor(totalMt / n);
      const remainder = totalMt - base * n; // на последний рабочий день

      await tx.weeklyPlan.delete({ where: { id: weekly.id } });

      for (let i = 0; i < n; i++) {
        const mt = i === n - 1 ? base + remainder : base;
        await tx.weeklyPlan.create({
          data: {
            season_year: seasonYear,
            iso_year: isoYear,
            iso_week: week,
            culture_id: cultureId,
            date: workdays[i],
            target_tons: fromMt(mt),
          },
        });
      }

      await logChange(
        {
          entity: ENTITY,
          entityId: cultureId,
          field: "convert_week_to_days",
          oldValue: String(weekly.target_tons.toNumber()),
          newValue: `${n} дн.`,
        },
        Number(user.id),
        tx,
      );
      return true;
    });

    if (result === false) return { ok: true }; // недельной строки не было
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось сменить гранулярность" };
  }
}
