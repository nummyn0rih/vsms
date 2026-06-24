"use server";

import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/action-result";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import {
  FACTORY_LOCATION_ID,
  TRANSIT_TO_FACTORY,
  TRANSIT_TO_FARMER,
} from "@/server/shipments/packaging";
import { revalidateStockDashboards } from "@/server/inventory/revalidate";

// D2-ops-1: ручные операции тары (DOMAIN §3). Tare-only.
// - scrap:    loc/good  → loc/scrap (порча; меняется только состояние, объём в системе тот же).
// - disposal: loc/scrap → null      (вывод из системы; «Итого в системе» уменьшается).
// Баланс не хранится (Σ движений), может уходить в минус — сверху НЕ ограничиваем.
// Причина живёт только в ChangeLog (у StockMovement поля reason нет).

function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

// Локация операции: завод (0) или существующий фермер (active ИЛИ архивный — лом мог
// застрять у деактивированного, отличие от opening). Транзит/null — запрещены.
async function isOperableLocation(locationId: number): Promise<boolean> {
  if (locationId === TRANSIT_TO_FACTORY || locationId === TRANSIT_TO_FARMER) {
    return false;
  }
  if (locationId === FACTORY_LOCATION_ID) return true;
  const farmer = await prisma.farmer.findUnique({
    where: { id: locationId },
    select: { id: true },
  });
  return farmer != null;
}

type OpInput = {
  locationId: number;
  packagingTypeId: number;
  quantity: number;
  reason?: string | null;
};

// Общая валидация (кол-во целое > 0, тип тары существует, локация допустима).
async function validateOp(input: OpInput): Promise<string | null> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return "Количество — целое число > 0";
  }
  const type = await prisma.packagingType.findUnique({
    where: { id: input.packagingTypeId },
    select: { id: true },
  });
  if (!type) return "Тип тары не найден";
  if (!(await isOperableLocation(input.locationId))) {
    return "Недопустимая локация";
  }
  return null;
}

// Списание целой тары в лом: loc/good → loc/scrap (та же локация).
export async function scrapTare(input: OpInput): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const err = await validateOp(input);
    if (err) return { ok: false, error: err };

    const { locationId, packagingTypeId, quantity, reason } = input;

    await prisma.$transaction(async (tx) => {
      const created = await tx.stockMovement.create({
        data: {
          kind: "packaging",
          packaging_type_id: packagingTypeId,
          ingredient_id: null,
          quantity,
          from_location_id: locationId,
          from_state: "good",
          to_location_id: locationId,
          to_state: "scrap",
          movement_type: "scrap",
          source_doc_type: "manual",
          source_doc_id: null,
        },
        select: { id: true },
      });

      await logChange(
        {
          entity: "StockMovement",
          entityId: created.id,
          field: "scrap",
          oldValue: null,
          newValue: JSON.stringify({
            op: "scrap",
            locationId,
            packagingTypeId,
            quantity,
            reason: reason ?? null,
          }),
        },
        Number(user.id),
        tx,
      );
    });

    revalidateStockDashboards();
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось списать в лом" };
  }
}

// Утилизация лома: loc/scrap → null (выводит из системы).
export async function disposeTare(input: OpInput): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const err = await validateOp(input);
    if (err) return { ok: false, error: err };

    const { locationId, packagingTypeId, quantity, reason } = input;

    await prisma.$transaction(async (tx) => {
      const created = await tx.stockMovement.create({
        data: {
          kind: "packaging",
          packaging_type_id: packagingTypeId,
          ingredient_id: null,
          quantity,
          from_location_id: locationId,
          from_state: "scrap",
          to_location_id: null,
          to_state: null,
          movement_type: "disposal",
          source_doc_type: "manual",
          source_doc_id: null,
        },
        select: { id: true },
      });

      await logChange(
        {
          entity: "StockMovement",
          entityId: created.id,
          field: "disposal",
          oldValue: null,
          newValue: JSON.stringify({
            op: "disposal",
            locationId,
            packagingTypeId,
            quantity,
            reason: reason ?? null,
          }),
        },
        Number(user.id),
        tx,
      );
    });

    revalidateStockDashboards();
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось утилизировать" };
  }
}
