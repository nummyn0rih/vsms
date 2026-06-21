"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { seasonYearOf } from "@/server/shipments/workdays";
import {
  saveActSchema,
  revertActSchema,
  type SaveActInput,
  type ActContext,
} from "./schema";

const SHIPMENT = "Shipment";
const ITEM = "ShipmentItem";
const ACT = "AcceptanceAct";
const PATH = "/acceptance";
const FEED_PATH = "/shipments";

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
}

function toDateStr(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// Данные формы акта для одной позиции. Чистая выборка (read-only). null = позиция
// не найдена. Строки контракта — фермер+культура+сезон позиции (BR-8).
export async function getActContext({
  shipmentItemId,
}: {
  shipmentItemId: number;
}): Promise<ActContext | null> {
  const item = await prisma.shipmentItem.findUnique({
    where: { id: shipmentItemId },
    select: {
      id: true,
      farmer_id: true,
      culture_id: true,
      actual_weight_kg: true,
      contract_line_id: true,
      culture: { select: { name: true, color: true, acceptance_type: true } },
      farmer: { select: { name: true } },
      shipment: {
        select: {
          id: true,
          code: true,
          status: true,
          arrival_date: true,
          departure_date: true,
          driver: {
            select: {
              full_name: true,
              transportCompany: { select: { name: true } },
            },
          },
        },
      },
      acceptanceAct: {
        select: { act_number: true, brak_percent: true },
      },
    },
  });
  if (!item) return null;

  // Сезон по дате прибытия (или отправления) машины — как в отгрузках.
  const refDate = item.shipment.arrival_date ?? item.shipment.departure_date ?? new Date();
  const season = seasonYearOf(refDate);

  const lines = await prisma.contractLine.findMany({
    where: {
      culture_id: item.culture_id,
      contract: { farmer_id: item.farmer_id, season_year: season },
    },
    select: { id: true, label: true, price_per_kg: true },
    orderBy: { id: "asc" },
  });

  // «Последняя непринятая» — у машины ровно одна позиция без акта (эта).
  const unaccepted = await prisma.shipmentItem.count({
    where: { shipment_id: item.shipment.id, acceptanceAct: null },
  });

  return {
    shipmentItemId: item.id,
    acceptanceType: item.culture.acceptance_type as "simple" | "calibre",
    cultureName: item.culture.name,
    cultureColor: item.culture.color,
    farmerName: item.farmer.name,
    machineCode: item.shipment.code,
    departureDate: toDateStr(item.shipment.departure_date),
    driverName: item.shipment.driver?.full_name ?? null,
    transportCompanyName: item.shipment.driver?.transportCompany.name ?? null,
    machineStatus: item.shipment.status as "sent" | "arrived" | "accepted",
    actualKg:
      item.actual_weight_kg != null ? item.actual_weight_kg.toNumber() : null,
    contractLines: lines.map((l) => ({
      id: l.id,
      label: l.label,
      pricePerKg: l.price_per_kg.toString(),
    })),
    autoLineId: lines.length === 1 ? lines[0].id : null,
    isLastUnaccepted: item.acceptanceAct == null && unaccepted === 1,
    existing: item.acceptanceAct
      ? {
          actNumber: item.acceptanceAct.act_number,
          brakPercent:
            item.acceptanceAct.brak_percent != null
              ? item.acceptanceAct.brak_percent.toNumber()
              : 0,
          contractLineId: item.contract_line_id,
        }
      : null,
  };
}

// Приёмка позиции актом (C1a, simple). operator/admin. Принятый вес — производное,
// не пишем (BR-10). При приёмке ПОСЛЕДНЕЙ позиции машина авто-→accepted (BR-13).
export async function saveAct(input: SaveActInput): Promise<ActionResult> {
  try {
    const user = await requireRole("operator", "admin");

    const parsed = saveActSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля акта",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }
    const { shipmentItemId, actNumber, brakPercent, contractLineId } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.shipmentItem.findUnique({
        where: { id: shipmentItemId },
        select: {
          farmer_id: true,
          culture_id: true,
          actual_weight_kg: true,
          contract_line_id: true,
          shipment: { select: { id: true, status: true } },
          acceptanceAct: { select: { id: true } },
        },
      });
      if (!item) return { ok: false as const, error: "Позиция не найдена" };

      // BR-25: без фактического веса приёмка невозможна.
      if (item.actual_weight_kg == null) {
        return { ok: false as const, error: "Сначала внесите фактический вес" };
      }

      // BR-8: строка должна быть того же фермера и культуры (как BR-7 в отгрузках).
      const line = await tx.contractLine.findUnique({
        where: { id: contractLineId },
        select: { culture_id: true, contract: { select: { farmer_id: true } } },
      });
      if (!line) return { ok: false as const, error: "Строка контракта не найдена" };
      if (
        line.culture_id !== item.culture_id ||
        line.contract.farmer_id !== item.farmer_id
      ) {
        return {
          ok: false as const,
          error: "Строка контракта должна быть того же фермера и культуры (BR-8)",
        };
      }

      const isNew = item.acceptanceAct == null;
      await tx.acceptanceAct.upsert({
        where: { shipment_item_id: shipmentItemId },
        create: {
          shipment_item_id: shipmentItemId,
          act_number: actNumber,
          brak_percent: new Prisma.Decimal(brakPercent),
        },
        update: {
          act_number: actNumber,
          brak_percent: new Prisma.Decimal(brakPercent),
        },
      });

      const entries = [
        {
          entity: ACT,
          entityId: shipmentItemId,
          field: isNew ? "created" : "updated",
          newValue: actNumber,
        },
      ];

      // BR-8: фиксируем привязку строки на позиции, если изменилась.
      if (item.contract_line_id !== contractLineId) {
        await tx.shipmentItem.update({
          where: { id: shipmentItemId },
          data: { contract_line_id: contractLineId },
        });
        entries.push({
          entity: ITEM,
          entityId: shipmentItemId,
          field: "contract_line_id",
          oldValue: item.contract_line_id != null ? String(item.contract_line_id) : null,
          newValue: String(contractLineId),
        } as (typeof entries)[number]);
      }

      // BR-13: все позиции машины приняты → авто-accepted.
      const stillUnaccepted = await tx.shipmentItem.count({
        where: { shipment_id: item.shipment.id, acceptanceAct: null },
      });
      if (stillUnaccepted === 0 && item.shipment.status === "arrived") {
        await tx.shipment.update({
          where: { id: item.shipment.id },
          data: { status: "accepted" },
        });
        entries.push({
          entity: SHIPMENT,
          entityId: item.shipment.id,
          field: "status",
          oldValue: "arrived",
          newValue: "accepted",
        } as (typeof entries)[number]);
      }

      await logChange(entries, Number(user.id), tx);
      return { ok: true as const };
    });

    if (result.ok) revalidate();
    return result;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "№ акта уже занят (BR-9)" };
    }
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить акт" };
  }
}

// Откат приёмки позиции (admin). Удаляет акт; если машина была accepted — возвращает
// arrived (BR-13). Идемпотентно. Сторно склада — C2 (движений ещё нет).
export async function revertAct(input: {
  shipmentItemId: number;
}): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = revertActSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Некорректная позиция" };
    const { shipmentItemId } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.shipmentItem.findUnique({
        where: { id: shipmentItemId },
        select: {
          shipment: { select: { id: true, status: true } },
          acceptanceAct: { select: { act_number: true } },
        },
      });
      if (!item) return { ok: false as const, error: "Позиция не найдена" };
      if (item.acceptanceAct == null) return { ok: true as const }; // идемпотентно

      await tx.acceptanceAct.delete({ where: { shipment_item_id: shipmentItemId } });

      const entries = [
        {
          entity: ACT,
          entityId: shipmentItemId,
          field: "deleted",
          oldValue: item.acceptanceAct.act_number,
        },
      ];

      if (item.shipment.status === "accepted") {
        await tx.shipment.update({
          where: { id: item.shipment.id },
          data: { status: "arrived" },
        });
        entries.push({
          entity: SHIPMENT,
          entityId: item.shipment.id,
          field: "status",
          oldValue: "accepted",
          newValue: "arrived",
        } as (typeof entries)[number]);
      }

      await logChange(entries, Number(user.id), tx);
      return { ok: true as const };
    });

    if (result.ok) revalidate();
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось откатить акт" };
  }
}
