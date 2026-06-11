"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import {
  recipeSchema,
  type RecipeInput,
  type RecipeRow,
  type CultureOption,
  type IngredientOption,
} from "./schema";

const ENTITY = "IngredientRecipe";
const PATH = "/settings/recipes";

function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

// Нарушение @@unique(culture_id, ingredient_id) — код Prisma P2002.
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

export async function listCultureOptions(): Promise<CultureOption[]> {
  return prisma.culture.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function listIngredientOptions(): Promise<IngredientOption[]> {
  return prisma.ingredient.findMany({
    where: { active: true },
    select: { id: true, name: true, unit: true },
    orderBy: { name: "asc" },
  });
}

export async function listRecipesByCulture(
  cultureId: number,
): Promise<RecipeRow[]> {
  const list = await prisma.ingredientRecipe.findMany({
    where: { culture_id: cultureId },
    include: { ingredient: { select: { name: true, unit: true } } },
    orderBy: { ingredient: { name: "asc" } },
  });
  return list.map((r) => ({
    id: r.id,
    ingredient_id: r.ingredient_id,
    ingredient_name: r.ingredient.name,
    ingredient_unit: r.ingredient.unit,
    qty_per_kg_product: Number(r.qty_per_kg_product),
  }));
}

export async function addRecipe(input: RecipeInput): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = recipeSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const created = await prisma.ingredientRecipe.create({
      data: {
        culture_id: parsed.data.culture_id,
        ingredient_id: parsed.data.ingredient_id,
        qty_per_kg_product: parsed.data.qty_per_kg_product,
      },
    });

    await logChange(
      {
        entity: ENTITY,
        entityId: created.id,
        field: "created",
        newValue: `culture=${parsed.data.culture_id} ingredient=${parsed.data.ingredient_id} qty=${parsed.data.qty_per_kg_product}`,
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
        fieldErrors: { ingredient_id: ["Ингредиент уже добавлен к культуре"] },
      };
    }
    return authFail(e) ?? { ok: false, error: "Не удалось добавить строку" };
  }
}

export async function updateRecipeQty(
  id: number,
  qty: number,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    if (!(qty > 0)) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: { qty_per_kg_product: ["Расход должен быть больше 0"] },
      };
    }

    const existing = await prisma.ingredientRecipe.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Строка не найдена" };

    const oldQty = Number(existing.qty_per_kg_product);
    if (oldQty === qty) return { ok: true };

    await prisma.ingredientRecipe.update({
      where: { id },
      data: { qty_per_kg_product: qty },
    });

    await logChange(
      {
        entity: ENTITY,
        entityId: id,
        field: "qty_per_kg_product",
        oldValue: String(oldQty),
        newValue: String(qty),
      },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить" };
  }
}

// Жёсткое удаление строки рецепта (сама связка M:N, без входящих связей).
export async function deleteRecipe(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.ingredientRecipe.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Строка не найдена" };

    await prisma.ingredientRecipe.delete({ where: { id } });

    await logChange(
      {
        entity: ENTITY,
        entityId: id,
        field: "deleted",
        oldValue: `culture=${existing.culture_id} ingredient=${existing.ingredient_id}`,
      },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось удалить строку" };
  }
}
