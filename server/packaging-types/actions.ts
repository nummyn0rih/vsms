"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { packagingTypeSchema, type PackagingTypeInput } from "./schema";

const ENTITY = "PackagingType";
const PATH = "/reference/packaging-types";

// capacity_kg: для ящика всегда null (вес берётся из PackagingNorm по фермеру);
// для бочки — тримленная строка (Prisma Decimal принимает строку) или null.
function normCapacity(kind: "box" | "barrel", v: string | undefined): string | null {
  if (kind === "box") return null;
  const t = v?.trim();
  return t ? t : null;
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

export async function listPackagingTypes(params?: {
  q?: string;
  includeInactive?: boolean;
}) {
  const q = params?.q?.trim();
  return prisma.packagingType.findMany({
    where: {
      ...(params?.includeInactive ? {} : { active: true }),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
  });
}

export async function createPackagingType(
  input: PackagingTypeInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = packagingTypeSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const created = await prisma.packagingType.create({
      data: {
        name: parsed.data.name,
        kind: parsed.data.kind,
        capacity_kg: normCapacity(parsed.data.kind, parsed.data.capacity_kg),
      },
    });

    await logChange(
      { entity: ENTITY, entityId: created.id, field: "created", newValue: created.name },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось создать тип тары" };
  }
}

export async function updatePackagingType(
  id: number,
  input: PackagingTypeInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = packagingTypeSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const existing = await prisma.packagingType.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Тип тары не найден" };

    const nextCapacity = normCapacity(parsed.data.kind, parsed.data.capacity_kg);
    const next = { name: parsed.data.name, kind: parsed.data.kind };

    // Диф изменённых полей → отдельная запись в ChangeLog на каждое (BR-16).
    // Decimal сравниваем строкой (toString), чтобы 250 и 250.000 не давали ложный диф.
    const changes = [
      { field: "name", oldValue: existing.name, newValue: next.name },
      { field: "kind", oldValue: existing.kind, newValue: next.kind },
      {
        field: "capacity_kg",
        oldValue: existing.capacity_kg?.toString() ?? null,
        newValue: nextCapacity,
      },
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.packagingType.update({
      where: { id },
      data: { ...next, capacity_kg: nextCapacity },
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
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить" };
  }
}

// Soft delete (BR-15) в обе стороны: active=false/true одной операцией.
export async function setPackagingTypeActive(
  id: number,
  active: boolean,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.packagingType.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Тип тары не найден" };
    if (existing.active === active) return { ok: true }; // идемпотентно

    await prisma.packagingType.update({ where: { id }, data: { active } });

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
