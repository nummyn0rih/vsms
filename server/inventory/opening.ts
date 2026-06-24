"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import type { ItemKind } from "@/lib/generated/prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import {
  FACTORY_LOCATION_ID,
  TRANSIT_TO_FACTORY,
  TRANSIT_TO_FARMER,
} from "@/server/shipments/packaging";
import { revalidateStockDashboards } from "@/server/inventory/revalidate";

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

// Обобщено под оба kind (E3): тара (целое, шт) и ингредиент (Decimal, кг/л).
// columns у ингредиента несут unit (разные колонки для кг и л — не складывать).
export type OpeningBalances = {
  kind: ItemKind;
  locations: { id: number; name: string; isFactory: boolean }[];
  columns: { id: number; name: string; unit?: "kg" | "l" }[];
  values: { locationId: number; itemId: number; quantity: number }[];
};

// FK-поле движения по kind (полиморфизм StockMovement: ровно один FK заполнен).
function refByKind(kind: ItemKind, itemId: number) {
  return kind === "ingredient"
    ? {
        kind: "ingredient" as const,
        packaging_type_id: null,
        ingredient_id: itemId,
        to_state: null,
      }
    : {
        kind: "packaging" as const,
        packaging_type_id: itemId,
        ingredient_id: null,
        to_state: "good" as const,
      };
}

// Завод (id=0) первой строкой, затем активные фермеры по имени; колонки — активные
// типы тары ИЛИ активные ингредиенты (по kind). values — текущие opening-движения
// (одно на тройку локация×предмет).
export async function getOpeningBalances(
  kind: ItemKind,
): Promise<OpeningBalances> {
  const [farmers, columns, movements] = await Promise.all([
    prisma.farmer.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    kind === "ingredient"
      ? prisma.ingredient.findMany({
          where: { active: true },
          select: { id: true, name: true, unit: true },
          orderBy: { name: "asc" },
        })
      : prisma.packagingType.findMany({
          where: { active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
    prisma.stockMovement.findMany({
      where: { kind, movement_type: "opening" },
      select: {
        to_location_id: true,
        packaging_type_id: true,
        ingredient_id: true,
        quantity: true,
      },
    }),
  ]);

  const locations = [
    { id: FACTORY_LOCATION_ID, name: "Завод", isFactory: true },
    ...farmers.map((f) => ({ id: f.id, name: f.name, isFactory: false })),
  ];

  const values = movements
    .map((m) => ({
      locationId: m.to_location_id,
      itemId: kind === "ingredient" ? m.ingredient_id : m.packaging_type_id,
      quantity: m.quantity.toNumber(),
    }))
    .filter(
      (v): v is { locationId: number; itemId: number; quantity: number } =>
        v.locationId != null && v.itemId != null,
    );

  return { kind, locations, columns, values };
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
// kind: тара — целое (шт); ингредиент — Decimal (кг/л, дробное разрешено).
export async function setOpeningBalance(input: {
  kind: ItemKind;
  locationId: number;
  itemId: number;
  quantity: number;
}): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const { kind, locationId, itemId, quantity } = input;

    if (kind === "ingredient") {
      if (!Number.isFinite(quantity) || quantity < 0) {
        return { ok: false, error: "Количество — число ≥ 0" };
      }
    } else if (!Number.isInteger(quantity) || quantity < 0) {
      return { ok: false, error: "Количество — целое число ≥ 0" };
    }
    if (!(await isValidLocation(locationId))) {
      return { ok: false, error: "Недопустимая локация" };
    }
    if (kind === "ingredient") {
      const ing = await prisma.ingredient.findFirst({
        where: { id: itemId, active: true },
        select: { id: true },
      });
      if (!ing) return { ok: false, error: "Ингредиент не найден" };
    } else {
      const type = await prisma.packagingType.findFirst({
        where: { id: itemId, active: true },
        select: { id: true },
      });
      if (!type) return { ok: false, error: "Тип тары не найден" };
    }

    const fkWhere =
      kind === "ingredient"
        ? { ingredient_id: itemId }
        : { packaging_type_id: itemId };

    await prisma.$transaction(async (tx) => {
      const existing = await tx.stockMovement.findFirst({
        where: {
          kind,
          movement_type: "opening",
          to_location_id: locationId,
          ...fkWhere,
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
            ...refByKind(kind, itemId),
            quantity,
            from_location_id: null,
            to_location_id: locationId,
            from_state: null,
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
    revalidateStockDashboards();
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить" };
  }
}
