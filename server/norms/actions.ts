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

const whereKey = (farmerId: number, cultureId: number) => ({
  farmer_id_culture_id: { farmer_id: farmerId, culture_id: cultureId },
});

// Прямые ветки по режиму: обе модели имеют одинаковую форму ключей, различается
// только поле-значение. Ветвим явно (типобезопасно), а не через общий делегат.
async function readNorm(
  kind: NormKind,
  farmerId: number,
  cultureId: number,
): Promise<{ id: number; value: number } | null> {
  const where = whereKey(farmerId, cultureId);
  if (kind === "packaging") {
    const r = await prisma.packagingNorm.findUnique({ where });
    return r ? { id: r.id, value: Number(r.avg_unit_weight_kg) } : null;
  }
  const r = await prisma.tripWeightNorm.findUnique({ where });
  return r ? { id: r.id, value: Number(r.planned_trip_weight_kg) } : null;
}

async function writeNorm(
  kind: NormKind,
  farmerId: number,
  cultureId: number,
  value: number,
): Promise<{ id: number }> {
  const where = whereKey(farmerId, cultureId);
  if (kind === "packaging") {
    return prisma.packagingNorm.upsert({
      where,
      create: { farmer_id: farmerId, culture_id: cultureId, avg_unit_weight_kg: value },
      update: { avg_unit_weight_kg: value },
    });
  }
  return prisma.tripWeightNorm.upsert({
    where,
    create: { farmer_id: farmerId, culture_id: cultureId, planned_trip_weight_kg: value },
    update: { planned_trip_weight_kg: value },
  });
}

async function removeNorm(kind: NormKind, farmerId: number, cultureId: number) {
  const where = whereKey(farmerId, cultureId);
  if (kind === "packaging") return prisma.packagingNorm.delete({ where });
  return prisma.tripWeightNorm.delete({ where });
}

export async function listNorms(kind: NormKind): Promise<NormCell[]> {
  if (kind === "packaging") {
    const rows = await prisma.packagingNorm.findMany({
      select: { farmer_id: true, culture_id: true, avg_unit_weight_kg: true },
    });
    return rows.map((r) => ({
      farmer_id: r.farmer_id,
      culture_id: r.culture_id,
      value: Number(r.avg_unit_weight_kg),
    }));
  }
  const rows = await prisma.tripWeightNorm.findMany({
    select: { farmer_id: true, culture_id: true, planned_trip_weight_kg: true },
  });
  return rows.map((r) => ({
    farmer_id: r.farmer_id,
    culture_id: r.culture_id,
    value: Number(r.planned_trip_weight_kg),
  }));
}

export async function upsertNorm(
  kind: NormKind,
  farmerId: number,
  cultureId: number,
  value: number,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = normValueSchema.safeParse(value);
    if (!parsed.success) {
      return { ok: false, error: "Значение должно быть больше 0" };
    }
    const next = parsed.data;

    // Двойная защита: норму тары нельзя задать культуре без типа тары
    // (на клиенте ячейка disabled, но сервер тоже обязан проверить).
    if (kind === "packaging") {
      const culture = await prisma.culture.findUnique({
        where: { id: cultureId },
        select: { packaging_type_id: true },
      });
      if (!culture) return { ok: false, error: "Культура не найдена" };
      if (culture.packaging_type_id == null) {
        return { ok: false, error: "У культуры не задан тип тары" };
      }
    }

    const existing = await readNorm(kind, farmerId, cultureId);
    if (existing && existing.value === next) return { ok: true };

    const saved = await writeNorm(kind, farmerId, cultureId, next);

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
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await readNorm(kind, farmerId, cultureId);
    if (!existing) return { ok: true }; // идемпотентно: нечего удалять

    await removeNorm(kind, farmerId, cultureId);

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
