"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import {
  alertRuleSchema,
  LOCATION_ANY,
  type AlertRuleInput,
  type AlertRuleRow,
  type ItemOption,
  type FarmerOption,
} from "./schema";

const ENTITY = "AlertRule";
const PATH = "/settings/alert-rules";

function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

// location_scope из Select (строка) → Farmer.id или null («у любого фермера»).
function toLocation(v: string): number | null {
  return v === LOCATION_ANY ? null : Number(v);
}

export async function listOptions(): Promise<{
  packaging: ItemOption[];
  ingredients: ItemOption[];
  farmers: FarmerOption[];
}> {
  const [packaging, ingredients, farmers] = await Promise.all([
    prisma.packagingType.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.ingredient.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.farmer.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { packaging, ingredients, farmers };
}

export async function listAlertRules(): Promise<AlertRuleRow[]> {
  const [rules, packaging, ingredients, farmers] = await Promise.all([
    prisma.alertRule.findMany({ orderBy: { id: "desc" } }),
    prisma.packagingType.findMany({ select: { id: true, name: true } }),
    prisma.ingredient.findMany({ select: { id: true, name: true } }),
    prisma.farmer.findMany({ select: { id: true, name: true } }),
  ]);

  const pkgMap = new Map(packaging.map((p) => [p.id, p.name]));
  const ingMap = new Map(ingredients.map((i) => [i.id, i.name]));
  const farmerMap = new Map(farmers.map((f) => [f.id, f.name]));

  return rules.map((r) => {
    const itemName =
      r.item_kind === "packaging"
        ? pkgMap.get(r.item_id)
        : ingMap.get(r.item_id);
    return {
      id: r.id,
      item_kind: r.item_kind,
      item_id: r.item_id,
      item_name: itemName ?? `#${r.item_id}`,
      location_scope: r.location_scope,
      location_name:
        r.location_scope == null
          ? "У любого фермера"
          : (farmerMap.get(r.location_scope) ?? `#${r.location_scope}`),
      threshold: Number(r.threshold),
    };
  });
}

// item_id должен указывать на существующую активную позицию нужного kind.
async function validateItem(
  itemKind: "packaging" | "ingredient",
  itemId: number,
): Promise<boolean> {
  if (itemKind === "packaging") {
    const p = await prisma.packagingType.findFirst({
      where: { id: itemId, active: true },
      select: { id: true },
    });
    return !!p;
  }
  const i = await prisma.ingredient.findFirst({
    where: { id: itemId, active: true },
    select: { id: true },
  });
  return !!i;
}

export async function createAlertRule(
  input: AlertRuleInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = alertRuleSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const itemId = Number(parsed.data.item_id);
    if (!(await validateItem(parsed.data.item_kind, itemId))) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: { item_id: ["Позиция не найдена или неактивна"] },
      };
    }

    const created = await prisma.alertRule.create({
      data: {
        item_kind: parsed.data.item_kind,
        item_id: itemId,
        location_scope: toLocation(parsed.data.location_scope),
        threshold: Number(parsed.data.threshold),
      },
    });

    await logChange(
      {
        entity: ENTITY,
        entityId: created.id,
        field: "created",
        newValue: `${parsed.data.item_kind}=${itemId} threshold=${parsed.data.threshold}`,
      },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось создать правило" };
  }
}

export async function updateAlertRule(
  id: number,
  input: AlertRuleInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = alertRuleSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const itemId = Number(parsed.data.item_id);
    if (!(await validateItem(parsed.data.item_kind, itemId))) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: { item_id: ["Позиция не найдена или неактивна"] },
      };
    }

    const existing = await prisma.alertRule.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Правило не найдено" };

    const nextLocation = toLocation(parsed.data.location_scope);
    const nextThreshold = Number(parsed.data.threshold);

    // Диф изменённых полей → отдельная запись в ChangeLog на каждое (BR-16).
    const changes = [
      {
        field: "item_kind",
        oldValue: existing.item_kind,
        newValue: parsed.data.item_kind,
      },
      {
        field: "item_id",
        oldValue: String(existing.item_id),
        newValue: String(itemId),
      },
      {
        field: "location_scope",
        oldValue: existing.location_scope == null ? "" : String(existing.location_scope),
        newValue: nextLocation == null ? "" : String(nextLocation),
      },
      {
        field: "threshold",
        oldValue: String(Number(existing.threshold)),
        newValue: String(nextThreshold),
      },
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.alertRule.update({
      where: { id },
      data: {
        item_kind: parsed.data.item_kind,
        item_id: itemId,
        location_scope: nextLocation,
        threshold: nextThreshold,
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
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить" };
  }
}

// Жёсткое удаление: у AlertRule нет входящих связей и поля active.
export async function deleteAlertRule(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.alertRule.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Правило не найдено" };

    await prisma.alertRule.delete({ where: { id } });

    await logChange(
      {
        entity: ENTITY,
        entityId: id,
        field: "deleted",
        oldValue: `${existing.item_kind}=${existing.item_id}`,
      },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось удалить правило" };
  }
}
