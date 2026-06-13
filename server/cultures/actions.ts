"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import type { Prisma } from "@/lib/generated/prisma/client";
import { cultureSchema, type CultureInput, type PackagingOption } from "./schema";
import { persistCalibreScheme } from "./calibre";

const ENTITY = "Culture";
const PATH = "/reference/cultures";

type Tx = Prisma.TransactionClient;

// Синк разрешённых типов тары культуры: полная замена набора (delete + createMany).
// На CulturePackagingType никто не ссылается по id, пересоздание безопасно. Возвращает
// сводку для ChangeLog. typeIds/defaultId уже валидированы zod (ровно один дефолт).
async function syncCulturePackagingTypes(
  tx: Tx,
  cultureId: number,
  typeIds: string[],
  defaultId: string | undefined,
): Promise<string> {
  await tx.culturePackagingType.deleteMany({ where: { culture_id: cultureId } });
  if (typeIds.length === 0) return "навал (без тары)";

  await tx.culturePackagingType.createMany({
    data: typeIds.map((id) => ({
      culture_id: cultureId,
      packaging_type_id: Number(id),
      is_default: id === defaultId,
    })),
  });
  return `${typeIds.length} тип(ов), дефолт #${defaultId}`;
}

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

export async function listCultures(params?: {
  q?: string;
  includeInactive?: boolean;
}) {
  const q = params?.q?.trim();
  return prisma.culture.findMany({
    where: {
      ...(params?.includeInactive ? {} : { active: true }),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    include: {
      packagingTypes: {
        include: { packagingType: { select: { name: true, active: true } } },
      },
      calibreScheme: {
        include: { ranges: { orderBy: { min_cm: "asc" } } },
      },
    },
    orderBy: { name: "asc" },
  });
}

// Active-типы тары для Select формы культуры.
export async function listPackagingOptions(): Promise<PackagingOption[]> {
  const types = await prisma.packagingType.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return types;
}

export async function createCulture(input: CultureInput): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = cultureSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    // Культура + схема калибров — атомарно (либо обе, либо никак).
    await prisma.$transaction(async (tx) => {
      const created = await tx.culture.create({
        data: {
          name: parsed.data.name,
          color: parsed.data.color,
          acceptance_type: parsed.data.acceptance_type,
        },
      });

      const packagingSummary = await syncCulturePackagingTypes(
        tx,
        created.id,
        parsed.data.packaging_type_ids ?? [],
        parsed.data.default_packaging_type_id,
      );

      const schemeSummary = await persistCalibreScheme(
        tx,
        created.id,
        parsed.data.acceptance_type,
        parsed.data.ranges ?? [],
      );

      const entries = [
        { entity: ENTITY, entityId: created.id, field: "created", newValue: created.name },
        { entity: ENTITY, entityId: created.id, field: "packaging_types", newValue: packagingSummary },
      ];
      if (parsed.data.acceptance_type === "calibre") {
        entries.push({
          entity: ENTITY,
          entityId: created.id,
          field: "calibre_scheme",
          newValue: schemeSummary,
        });
      }
      await logChange(entries, Number(user.id), tx);
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось создать культуру" };
  }
}

export async function updateCulture(
  id: number,
  input: CultureInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = cultureSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const existing = await prisma.culture.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Культура не найдена" };

    // Диф изменённых полей → отдельная запись в ChangeLog на каждое (BR-16).
    const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [
      { field: "name", oldValue: existing.name, newValue: parsed.data.name },
      { field: "color", oldValue: existing.color, newValue: parsed.data.color },
      {
        field: "acceptance_type",
        oldValue: existing.acceptance_type,
        newValue: parsed.data.acceptance_type,
      },
    ].filter((c) => c.oldValue !== c.newValue);

    // Культура + типы тары + схема калибров — атомарно в одной транзакции.
    await prisma.$transaction(async (tx) => {
      await tx.culture.update({
        where: { id },
        data: {
          name: parsed.data.name,
          color: parsed.data.color,
          acceptance_type: parsed.data.acceptance_type,
        },
      });

      // Типы тары: полная замена набора (синк CulturePackagingType).
      const packagingSummary = await syncCulturePackagingTypes(
        tx,
        id,
        parsed.data.packaging_type_ids ?? [],
        parsed.data.default_packaging_type_id,
      );

      // calibre → заменить набор диапазонов; simple → удалить схему (Cascade).
      const schemeSummary = await persistCalibreScheme(
        tx,
        id,
        parsed.data.acceptance_type,
        parsed.data.ranges ?? [],
      );

      const entries = changes.map((c) => ({ entity: ENTITY, entityId: id, ...c }));
      entries.push({
        entity: ENTITY,
        entityId: id,
        field: "packaging_types",
        oldValue: null,
        newValue: packagingSummary,
      });
      // Схему логируем при calibre (правка набора) и при уходе на simple (удаление).
      if (
        parsed.data.acceptance_type === "calibre" ||
        existing.acceptance_type === "calibre"
      ) {
        entries.push({
          entity: ENTITY,
          entityId: id,
          field: "calibre_scheme",
          oldValue: null,
          newValue: schemeSummary,
        });
      }
      if (entries.length > 0) {
        await logChange(entries, Number(user.id), tx);
      }
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить" };
  }
}

// Soft delete (BR-15) в обе стороны: active=false/true одной операцией.
export async function setCultureActive(
  id: number,
  active: boolean,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.culture.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Культура не найдена" };
    if (existing.active === active) return { ok: true }; // идемпотентно

    await prisma.culture.update({ where: { id }, data: { active } });

    await logChange(
      {
        entity: ENTITY,
        entityId: id,
        field: "active",
        oldValue: String(existing.active),
        newValue: String(active),
      },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось изменить статус" };
  }
}
