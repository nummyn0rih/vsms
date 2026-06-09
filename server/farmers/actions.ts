"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { farmerSchema, type FarmerInput } from "./schema";

const ENTITY = "Farmer";
const PATH = "/reference/farmers";

// Пустую строку контактов/заметок храним как null, иначе тримленную строку.
function norm(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

// JsonValue → строка для сравнения/лога (contacts хранится строкой в Json-колонке).
function asText(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
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

export async function listFarmers(params?: {
  q?: string;
  includeInactive?: boolean;
}) {
  const q = params?.q?.trim();
  return prisma.farmer.findMany({
    where: {
      ...(params?.includeInactive ? {} : { active: true }),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
  });
}

export async function createFarmer(input: FarmerInput): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = farmerSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const farmer = await prisma.farmer.create({
      data: {
        name: parsed.data.name,
        // Json-колонка: для записи NULL нужен Prisma.DbNull, не JS null.
        contacts: norm(parsed.data.contacts) ?? Prisma.DbNull,
        notes: norm(parsed.data.notes),
      },
    });

    await logChange(
      { entity: ENTITY, entityId: farmer.id, field: "created", newValue: farmer.name },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось создать фермера" };
  }
}

export async function updateFarmer(
  id: number,
  input: FarmerInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = farmerSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const existing = await prisma.farmer.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Фермер не найден" };

    const next = {
      name: parsed.data.name,
      contacts: norm(parsed.data.contacts),
      notes: norm(parsed.data.notes),
    };

    // Диф изменённых полей → отдельная запись в ChangeLog на каждое (BR-16).
    const changes = [
      { field: "name", oldValue: existing.name, newValue: next.name },
      { field: "contacts", oldValue: asText(existing.contacts), newValue: next.contacts },
      { field: "notes", oldValue: existing.notes, newValue: next.notes },
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.farmer.update({
      where: { id },
      // contacts (Json): NULL пишем через Prisma.DbNull.
      data: { ...next, contacts: next.contacts ?? Prisma.DbNull },
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

// Soft delete (BR-15): active=false, без физического удаления.
export async function deactivateFarmer(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.farmer.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Фермер не найден" };
    if (!existing.active) return { ok: true };

    await prisma.farmer.update({ where: { id }, data: { active: false } });

    await logChange(
      { entity: ENTITY, entityId: id, field: "active", oldValue: "true", newValue: "false" },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось деактивировать" };
  }
}
