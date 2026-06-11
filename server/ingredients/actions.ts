"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { ingredientSchema, type IngredientInput } from "./schema";

const ENTITY = "Ingredient";
const PATH = "/reference/ingredients";

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

export async function listIngredients(params?: {
  q?: string;
  includeInactive?: boolean;
}) {
  const q = params?.q?.trim();
  return prisma.ingredient.findMany({
    where: {
      ...(params?.includeInactive ? {} : { active: true }),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
  });
}

export async function createIngredient(
  input: IngredientInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = ingredientSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const created = await prisma.ingredient.create({
      data: { name: parsed.data.name, unit: parsed.data.unit },
    });

    await logChange(
      { entity: ENTITY, entityId: created.id, field: "created", newValue: created.name },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось создать ингредиент" };
  }
}

export async function updateIngredient(
  id: number,
  input: IngredientInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = ingredientSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const existing = await prisma.ingredient.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Ингредиент не найден" };

    // Диф изменённых полей → отдельная запись в ChangeLog на каждое (BR-16).
    const changes = [
      { field: "name", oldValue: existing.name, newValue: parsed.data.name },
      { field: "unit", oldValue: existing.unit, newValue: parsed.data.unit },
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.ingredient.update({
      where: { id },
      data: { name: parsed.data.name, unit: parsed.data.unit },
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
export async function setIngredientActive(
  id: number,
  active: boolean,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.ingredient.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Ингредиент не найден" };
    if (existing.active === active) return { ok: true }; // идемпотентно

    await prisma.ingredient.update({ where: { id }, data: { active } });

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
