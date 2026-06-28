"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange, type ChangeEntry } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import {
  setActualWeightSchema,
  markArrivedSchema,
  type SetActualWeightInput,
} from "./schema";
import { applyInboundArrivedTareLeg } from "@/server/shipments/packaging";
import { parseDateUTC } from "@/server/shipments/workdays";
import { revalidateStockDashboards } from "@/server/inventory/revalidate";

const SHIPMENT = "Shipment";
const ITEM = "ShipmentItem";
const PATH = "/acceptance";
const FEED_PATH = "/shipments"; // лента и вид «План» читают факт

// Дата-only YYYY-MM-DD для ChangeLog old-значений (как в server/shipments/actions).
function toDateString(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

function revalidate() {
  revalidatePath(PATH);
  revalidatePath(FEED_PATH);
  revalidateStockDashboards();
}

// Перевеска позиции (BR-24а). Сохранение/очистка фактического веса. Первый вес у
// машины в пути (sent) → авто-перевод в arrived в ТОЙ ЖЕ транзакции. Очистка в
// null статус НЕ откатывает (односторонний переход).
export async function setActualWeight(
  input: SetActualWeightInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("operator", "admin");

    const parsed = setActualWeightSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте введённый вес",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }
    const { shipmentItemId, actualWeightKg } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.shipmentItem.findUnique({
        where: { id: shipmentItemId },
        select: {
          actual_weight_kg: true,
          shipment: {
            select: { id: true, status: true, arrival_date: true },
          },
        },
      });
      if (!item) return { ok: false as const, error: "Позиция не найдена" };

      const oldValue =
        item.actual_weight_kg != null ? item.actual_weight_kg.toString() : null;
      const newDecimal =
        actualWeightKg != null ? new Prisma.Decimal(actualWeightKg) : null;

      await tx.shipmentItem.update({
        where: { id: shipmentItemId },
        data: { actual_weight_kg: newDecimal },
      });

      const entries = [
        {
          entity: ITEM,
          entityId: shipmentItemId,
          field: "actual_weight_kg",
          oldValue,
          newValue: newDecimal != null ? newDecimal.toString() : null,
        },
      ];

      // Авто-arrived: первый сохранённый вес (был null, стал не-null) у машины sent.
      const isFirstWeight = oldValue == null && newDecimal != null;
      if (isFirstWeight && item.shipment.status === "sent") {
        // Фактическая дата прибытия = сегодня (BR-24а): первая перевеска и есть факт
        // прибытия. Молча, в том же переходе. Второй вес сюда не входит (status уже
        // arrived) → дата не перезаписывается.
        const today = new Date().toISOString().slice(0, 10);
        await tx.shipment.update({
          where: { id: item.shipment.id },
          data: { status: "arrived", arrival_date: parseDateUTC(today) },
        });
        // BR-3: плечо прибытия тары (в пути -1 → завод 0). Идемпотентно.
        const created = await applyInboundArrivedTareLeg(tx, item.shipment.id);
        entries.push({
          entity: SHIPMENT,
          entityId: item.shipment.id,
          field: "status",
          oldValue: "sent",
          newValue: "arrived",
        });
        entries.push({
          entity: SHIPMENT,
          entityId: item.shipment.id,
          field: "arrival_date",
          oldValue: toDateString(item.shipment.arrival_date),
          newValue: today,
        });
        entries.push({
          entity: SHIPMENT,
          entityId: item.shipment.id,
          field: "movements",
          oldValue: null,
          newValue: `плечо прибытия: ${created} движ.`,
        });
      }

      await logChange(entries, Number(user.id), tx);
      return { ok: true as const };
    });

    if (result.ok) revalidate();
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить вес" };
  }
}

// Отметить прибытие (BR-24б): sent → arrived без веса. Идемпотентно (повтор на
// arrived не падает и не дублирует лог). На иных статусах — отказ.
export async function markArrived(input: {
  shipmentId: number;
  arrivalDate?: string;
}): Promise<ActionResult> {
  try {
    const user = await requireRole("operator", "admin");

    const parsed = markArrivedSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Некорректная машина" };
    }
    const { shipmentId, arrivalDate } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { status: true, arrival_date: true },
      });
      if (!shipment) return { ok: false as const, error: "Отгрузка не найдена" };
      if (shipment.status === "arrived") return { ok: true as const }; // идемпотентно, дату не трогаем
      if (shipment.status !== "sent") {
        return { ok: false as const, error: "Машина не в пути" };
      }

      // Фактическая дата прибытия (BR-24б): если оператор выбрал — пишем, иначе
      // arrival_date не меняем (старое поведение). Факт допустим в любой день —
      // без проверки рабочего дня / departure ≤ arrival.
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          status: "arrived",
          ...(arrivalDate ? { arrival_date: parseDateUTC(arrivalDate) } : {}),
        },
      });
      // BR-3: плечо прибытия тары (в пути -1 → завод 0). Идемпотентно.
      const created = await applyInboundArrivedTareLeg(tx, shipmentId);
      const entries: ChangeEntry[] = [
        {
          entity: SHIPMENT,
          entityId: shipmentId,
          field: "status",
          oldValue: "sent",
          newValue: "arrived",
        },
        {
          entity: SHIPMENT,
          entityId: shipmentId,
          field: "movements",
          newValue: `плечо прибытия: ${created} движ.`,
        },
      ];
      if (arrivalDate) {
        entries.push({
          entity: SHIPMENT,
          entityId: shipmentId,
          field: "arrival_date",
          oldValue: toDateString(shipment.arrival_date),
          newValue: arrivalDate,
        });
      }
      await logChange(entries, Number(user.id), tx);
      return { ok: true as const };
    });

    if (result.ok) revalidate();
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось отметить прибытие" };
  }
}
