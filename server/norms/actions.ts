"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { KIND_META, normValueSchema, type NormCell, type NormKind } from "./schema";

const PATH = "/settings/norms";

function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

// Норма тары — по тройке (фермер×культура×тип), вес рейса — по паре. packagingTypeId
// обязателен для packaging, игнорируется для trip.
async function readNorm(
  kind: NormKind,
  farmerId: number,
  cultureId: number,
  packagingTypeId?: number,
): Promise<{ id: number; value: number } | null> {
  if (kind === "packaging") {
    const r = await prisma.packagingNorm.findUnique({
      where: {
        farmer_id_culture_id_packaging_type_id: {
          farmer_id: farmerId,
          culture_id: cultureId,
          packaging_type_id: packagingTypeId!,
        },
      },
    });
    return r ? { id: r.id, value: Number(r.avg_unit_weight_kg) } : null;
  }
  const r = await prisma.tripWeightNorm.findUnique({
    where: { farmer_id_culture_id: { farmer_id: farmerId, culture_id: cultureId } },
  });
  return r ? { id: r.id, value: Number(r.planned_trip_weight_kg) } : null;
}

async function writeNorm(
  kind: NormKind,
  farmerId: number,
  cultureId: number,
  value: number,
  packagingTypeId?: number,
): Promise<{ id: number }> {
  if (kind === "packaging") {
    return prisma.packagingNorm.upsert({
      where: {
        farmer_id_culture_id_packaging_type_id: {
          farmer_id: farmerId,
          culture_id: cultureId,
          packaging_type_id: packagingTypeId!,
        },
      },
      create: {
        farmer_id: farmerId,
        culture_id: cultureId,
        packaging_type_id: packagingTypeId!,
        avg_unit_weight_kg: value,
      },
      update: { avg_unit_weight_kg: value },
    });
  }
  return prisma.tripWeightNorm.upsert({
    where: { farmer_id_culture_id: { farmer_id: farmerId, culture_id: cultureId } },
    create: { farmer_id: farmerId, culture_id: cultureId, planned_trip_weight_kg: value },
    update: { planned_trip_weight_kg: value },
  });
}

async function removeNorm(
  kind: NormKind,
  farmerId: number,
  cultureId: number,
  packagingTypeId?: number,
) {
  if (kind === "packaging") {
    return prisma.packagingNorm.delete({
      where: {
        farmer_id_culture_id_packaging_type_id: {
          farmer_id: farmerId,
          culture_id: cultureId,
          packaging_type_id: packagingTypeId!,
        },
      },
    });
  }
  return prisma.tripWeightNorm.delete({
    where: { farmer_id_culture_id: { farmer_id: farmerId, culture_id: cultureId } },
  });
}

export async function listNorms(kind: NormKind): Promise<NormCell[]> {
  if (kind === "packaging") {
    const rows = await prisma.packagingNorm.findMany({
      select: {
        farmer_id: true,
        culture_id: true,
        packaging_type_id: true,
        avg_unit_weight_kg: true,
      },
    });
    return rows.map((r) => ({
      farmer_id: r.farmer_id,
      culture_id: r.culture_id,
      packaging_type_id: r.packaging_type_id,
      value: Number(r.avg_unit_weight_kg),
    }));
  }
  const rows = await prisma.tripWeightNorm.findMany({
    select: { farmer_id: true, culture_id: true, planned_trip_weight_kg: true },
  });
  return rows.map((r) => ({
    farmer_id: r.farmer_id,
    culture_id: r.culture_id,
    packaging_type_id: null,
    value: Number(r.planned_trip_weight_kg),
  }));
}

export async function upsertNorm(
  kind: NormKind,
  farmerId: number,
  cultureId: number,
  value: number,
  packagingTypeId?: number,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = normValueSchema.safeParse(value);
    if (!parsed.success) {
      return { ok: false, error: "Значение должно быть больше 0" };
    }
    const next = parsed.data;

    // Норму тары можно задать только для разрешённой тройки (тип тары должен быть
    // в списке разрешённых у культуры). Сервер обязан проверить, не только UI.
    if (kind === "packaging") {
      if (packagingTypeId == null) {
        return { ok: false, error: "Не указан тип тары" };
      }
      const allowed = await prisma.culturePackagingType.findUnique({
        where: {
          culture_id_packaging_type_id: {
            culture_id: cultureId,
            packaging_type_id: packagingTypeId,
          },
        },
      });
      if (!allowed) {
        return { ok: false, error: "Этот тип тары не разрешён для культуры" };
      }
    }

    const existing = await readNorm(kind, farmerId, cultureId, packagingTypeId);
    if (existing && existing.value === next) return { ok: true };

    const saved = await writeNorm(kind, farmerId, cultureId, next, packagingTypeId);

    await logChange(
      {
        entity: KIND_META[kind].entity,
        entityId: saved.id,
        field: existing == null ? "created" : KIND_META[kind].valueField,
        oldValue: existing == null ? null : String(existing.value),
        newValue: String(next),
      },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить" };
  }
}

export async function deleteNorm(
  kind: NormKind,
  farmerId: number,
  cultureId: number,
  packagingTypeId?: number,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await readNorm(kind, farmerId, cultureId, packagingTypeId);
    if (!existing) return { ok: true }; // идемпотентно: нечего удалять

    await removeNorm(kind, farmerId, cultureId, packagingTypeId);

    await logChange(
      {
        entity: KIND_META[kind].entity,
        entityId: existing.id,
        field: "deleted",
        oldValue: String(existing.value),
      },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось удалить норму" };
  }
}
