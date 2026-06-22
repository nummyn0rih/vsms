"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/action-result";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import {
  FACTORY_LOCATION_ID,
  TRANSIT_TO_FACTORY,
  TRANSIT_TO_FARMER,
} from "@/server/shipments/packaging";

// D1: начальные остатки тары (movement_type=opening, DOMAIN §3).
// opening — ЕДИНСТВЕННЫЙ тип движения, который можно править заменой (setup-данные);
// операционный леджер (return/delivery/...) неизменяем. Баланс не хранится — это
// Σ движений; после сброса D2 единственные packaging-движения = opening, поэтому
// баланс локации = введённому значению.

const PATH = "/settings/opening-stock";

function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

export type OpeningBalances = {
  locations: { id: number; name: string; isFactory: boolean }[];
  types: { id: number; name: string }[];
  values: { locationId: number; packagingTypeId: number; quantity: number }[];
};

// Завод (id=0) первой строкой, затем активные фермеры по имени; колонки — активные
// типы тары. values — текущие opening-движения (одно на тройку локация×тип).
export async function getOpeningBalances(): Promise<OpeningBalances> {
  const [farmers, types, movements] = await Promise.all([
    prisma.farmer.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.packagingType.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.stockMovement.findMany({
      where: { kind: "packaging", movement_type: "opening" },
      select: { to_location_id: true, packaging_type_id: true, quantity: true },
    }),
  ]);

  const locations = [
    { id: FACTORY_LOCATION_ID, name: "Завод", isFactory: true },
    ...farmers.map((f) => ({ id: f.id, name: f.name, isFactory: false })),
  ];

  const values = movements
    .filter((m) => m.to_location_id != null && m.packaging_type_id != null)
    .map((m) => ({
      locationId: m.to_location_id!,
      packagingTypeId: m.packaging_type_id!,
      quantity: m.quantity.toNumber(),
    }));

  return { locations, types, values };
}

// Локация opening: завод (0) или активный фермер. Транзит/null — запрещены.
async function isValidLocation(locationId: number): Promise<boolean> {
  if (locationId === TRANSIT_TO_FACTORY || locationId === TRANSIT_TO_FARMER) {
    return false;
  }
  if (locationId === FACTORY_LOCATION_ID) return true;
  const farmer = await prisma.farmer.findFirst({
    where: { id: locationId, active: true },
    select: { id: true },
  });
  return farmer != null;
}

// Замена opening-движения тройки: удалить старое + создать новое (qty>0).
// qty=0 → только удаление. requireRole(admin), ChangeLog в той же транзакции.
export async function setOpeningBalance(input: {
  locationId: number;
  packagingTypeId: number;
  quantity: number;
}): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const { locationId, packagingTypeId, quantity } = input;

    if (!Number.isInteger(quantity) || quantity < 0) {
      return { ok: false, error: "Количество — целое число ≥ 0" };
    }
    if (!(await isValidLocation(locationId))) {
      return { ok: false, error: "Недопустимая локация" };
    }
    const type = await prisma.packagingType.findFirst({
      where: { id: packagingTypeId, active: true },
      select: { id: true },
    });
    if (!type) return { ok: false, error: "Тип тары не найден" };

    await prisma.$transaction(async (tx) => {
      const existing = await tx.stockMovement.findFirst({
        where: {
          kind: "packaging",
          movement_type: "opening",
          to_location_id: locationId,
          packaging_type_id: packagingTypeId,
        },
        select: { id: true, quantity: true },
      });

      if (existing) {
        await tx.stockMovement.delete({ where: { id: existing.id } });
      }

      let newId = existing?.id ?? 0;
      if (quantity > 0) {
        const created = await tx.stockMovement.create({
          data: {
            kind: "packaging",
            packaging_type_id: packagingTypeId,
            quantity,
            from_location_id: null,
            to_location_id: locationId,
            from_state: null,
            to_state: "good",
            movement_type: "opening",
            source_doc_type: "manual",
            source_doc_id: null,
          },
          select: { id: true },
        });
        newId = created.id;
      }

      await logChange(
        {
          entity: "StockMovement",
          entityId: newId,
          field: "opening",
          oldValue: existing ? String(existing.quantity.toNumber()) : null,
          newValue: quantity > 0 ? String(quantity) : null,
        },
        Number(user.id),
        tx,
      );
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить" };
  }
}
