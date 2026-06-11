"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { seasonSchema, type SeasonInput, type SeasonRow } from "./schema";

const ENTITY = "SeasonConfig";
const PATH = "/settings/seasons";

// Единый перехват ошибок RBAC → ActionResult (страницу не валим).
function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

// Нарушение @@unique(season_year) — код Prisma P2002.
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

// DateTime → "YYYY-MM-DD" для клиента.
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function listSeasons(): Promise<SeasonRow[]> {
  const list = await prisma.seasonConfig.findMany({
    orderBy: { season_year: "desc" },
  });
  return list.map((s) => ({
    id: s.id,
    season_year: s.season_year,
    summer_start: toDateStr(s.summer_start),
    summer_end: toDateStr(s.summer_end),
    summer_workdays: s.summer_workdays,
    winter_workdays: s.winter_workdays,
  }));
}

export async function createSeason(input: SeasonInput): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = seasonSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const created = await prisma.seasonConfig.create({
      data: {
        season_year: Number(parsed.data.season_year),
        summer_start: new Date(parsed.data.summer_start),
        summer_end: new Date(parsed.data.summer_end),
        summer_workdays: parsed.data.summer_workdays,
        winter_workdays: parsed.data.winter_workdays,
      },
    });

    await logChange(
      {
        entity: ENTITY,
        entityId: created.id,
        field: "created",
        newValue: String(created.season_year),
      },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: { season_year: ["Сезон с таким годом уже есть"] },
      };
    }
    return authFail(e) ?? { ok: false, error: "Не удалось создать сезон" };
  }
}

export async function updateSeason(
  id: number,
  input: SeasonInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = seasonSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const existing = await prisma.seasonConfig.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Сезон не найден" };

    // Диф изменённых полей → отдельная запись в ChangeLog на каждое (BR-16).
    // Массивы сравниваем по join — порядок нормализован сортировкой WEEKDAYS.
    const changes = [
      {
        field: "season_year",
        oldValue: String(existing.season_year),
        newValue: String(Number(parsed.data.season_year)),
      },
      {
        field: "summer_start",
        oldValue: toDateStr(existing.summer_start),
        newValue: parsed.data.summer_start,
      },
      {
        field: "summer_end",
        oldValue: toDateStr(existing.summer_end),
        newValue: parsed.data.summer_end,
      },
      {
        field: "summer_workdays",
        oldValue: existing.summer_workdays.join(","),
        newValue: parsed.data.summer_workdays.join(","),
      },
      {
        field: "winter_workdays",
        oldValue: existing.winter_workdays.join(","),
        newValue: parsed.data.winter_workdays.join(","),
      },
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.seasonConfig.update({
      where: { id },
      data: {
        season_year: Number(parsed.data.season_year),
        summer_start: new Date(parsed.data.summer_start),
        summer_end: new Date(parsed.data.summer_end),
        summer_workdays: parsed.data.summer_workdays,
        winter_workdays: parsed.data.winter_workdays,
      },
    });

    if (changes.length > 0) {
      await logChange(
        changes.map((c) => ({ entity: ENTITY, entityId: id, ...c })),
        Number(user.id),
      );
    }

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: { season_year: ["Сезон с таким годом уже есть"] },
      };
    }
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить" };
  }
}

// Жёсткое удаление: у SeasonConfig нет входящих связей и поля active.
export async function deleteSeason(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.seasonConfig.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Сезон не найден" };

    await prisma.seasonConfig.delete({ where: { id } });

    await logChange(
      {
        entity: ENTITY,
        entityId: id,
        field: "deleted",
        oldValue: String(existing.season_year),
      },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось удалить сезон" };
  }
}
