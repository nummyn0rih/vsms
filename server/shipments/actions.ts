"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import {
  shipmentSchema,
  type ShipmentInput,
  type ShipmentListRow,
  type ShipmentDetail,
  type ShipmentItemRow,
  type ShipmentOptions,
} from "./schema";
import { persistShipmentItems, ShipmentValidationError } from "./items";
import {
  isFactoryWorkday,
  parseDateUTC,
  seasonYearOf,
  weekdayName,
} from "./workdays";

const ENTITY = "Shipment";
const PATH = "/shipments";

// Единый перехват ошибок RBAC → ActionResult (страницу не валим). Образец contracts.
function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

// Date → YYYY-MM-DD (даты храним UTC-полночью, см. parseDateUTC).
function toDateString(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// DD.MM.YYYY для текста ошибки BR-11.
function formatRu(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}

// Валидация дат: BR-12 (departure<=arrival, дубль zod) + BR-11 (прибытие в рабочий
// день завода). Возвращает текст ошибки или null. Используют create и update.
async function validateDates(
  departure: string,
  arrival: string,
): Promise<string | null> {
  if (departure > arrival) {
    return "Отправление не может быть позже прибытия";
  }

  const arrivalDate = parseDateUTC(arrival);
  const seasonYear = seasonYearOf(arrivalDate);
  // null → fallback на дефолты BR-18 внутри isFactoryWorkday.
  const cfg = await prisma.seasonConfig.findUnique({
    where: { season_year: seasonYear },
  });

  if (!isFactoryWorkday(arrivalDate, cfg)) {
    return `${formatRu(arrival)} — ${weekdayName(arrivalDate)}, нерабочий день завода`;
  }
  return null;
}

type Tx = Prisma.TransactionClient;

// Сквозной счётчик по ВСЕМ отгрузкам, не переиспользуется (удаление не сдвигает
// последующие). code хранится String, значения целые → MAX(code::int)+1.
async function getNextCode(tx: Tx): Promise<string> {
  const rows = await tx.$queryRaw<{ max: number }[]>`
    SELECT COALESCE(MAX(code::int), 0) AS max FROM "Shipment"
  `;
  return String(Number(rows[0]?.max ?? 0) + 1);
}

function toValidationFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof ShipmentValidationError) {
    return { ok: false, error: e.message };
  }
  return null;
}

export async function createShipment(
  input: ShipmentInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = shipmentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const dateError = await validateDates(
      parsed.data.departure_date,
      parsed.data.arrival_date,
    );
    if (dateError) return { ok: false, error: dateError };

    const driverId = parsed.data.driver_id?.trim();
    const comment = parsed.data.comment?.trim();

    await prisma.$transaction(async (tx) => {
      const code = await getNextCode(tx);
      const created = await tx.shipment.create({
        data: {
          code,
          departure_date: parseDateUTC(parsed.data.departure_date),
          arrival_date: parseDateUTC(parsed.data.arrival_date),
          status: "planned",
          driver_id: driverId ? Number(driverId) : null,
          comment: comment || null,
          created_by: Number(user.id),
        },
      });

      const itemsSummary = await persistShipmentItems(
        tx,
        created.id,
        parsed.data.items,
      );

      await logChange(
        [
          { entity: ENTITY, entityId: created.id, field: "created", newValue: code },
          { entity: ENTITY, entityId: created.id, field: "items", newValue: itemsSummary },
        ],
        Number(user.id),
        tx,
      );
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return (
      toValidationFail(e) ??
      authFail(e) ?? { ok: false, error: "Не удалось создать отгрузку" }
    );
  }
}

export async function updateShipment(
  id: number,
  input: ShipmentInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.shipment.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Отгрузка не найдена" };

    // BR-19: правка только в planned. Со статуса sent — сначала откат (B2).
    if (existing.status !== "planned") {
      return {
        ok: false,
        error: "Отгрузка отправлена — сначала откат статуса, потом правка (BR-19)",
      };
    }

    const parsed = shipmentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const dateError = await validateDates(
      parsed.data.departure_date,
      parsed.data.arrival_date,
    );
    if (dateError) return { ok: false, error: dateError };

    const driverId = parsed.data.driver_id?.trim();
    const nextDriverId = driverId ? Number(driverId) : null;
    const nextComment = parsed.data.comment?.trim() || null;
    const nextDeparture = parseDateUTC(parsed.data.departure_date);
    const nextArrival = parseDateUTC(parsed.data.arrival_date);

    // Диф полей шапки → отдельная запись в ChangeLog на каждое (BR-16).
    const changes = [
      {
        field: "driver_id",
        oldValue: existing.driver_id != null ? String(existing.driver_id) : null,
        newValue: nextDriverId != null ? String(nextDriverId) : null,
      },
      {
        field: "departure_date",
        oldValue: toDateString(existing.departure_date),
        newValue: parsed.data.departure_date,
      },
      {
        field: "arrival_date",
        oldValue: toDateString(existing.arrival_date),
        newValue: parsed.data.arrival_date,
      },
      { field: "comment", oldValue: existing.comment ?? null, newValue: nextComment },
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id },
        data: {
          driver_id: nextDriverId,
          departure_date: nextDeparture,
          arrival_date: nextArrival,
          comment: nextComment,
        },
      });

      const itemsSummary = await persistShipmentItems(tx, id, parsed.data.items);

      const entries = changes.map((c) => ({ entity: ENTITY, entityId: id, ...c }));
      entries.push({
        entity: ENTITY,
        entityId: id,
        field: "items",
        oldValue: null,
        newValue: itemsSummary,
      });
      await logChange(entries, Number(user.id), tx);
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return (
      toValidationFail(e) ??
      authFail(e) ?? { ok: false, error: "Не удалось сохранить" }
    );
  }
}

export async function deleteShipment(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.shipment.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Отгрузка не найдена" };

    // BR-19: физическое удаление разрешено ТОЛЬКО для planned.
    if (existing.status !== "planned") {
      return {
        ok: false,
        error: "Удаление запрещено: сначала откат статуса до planned (BR-19)",
      };
    }

    await prisma.$transaction(async (tx) => {
      // Позиции уйдут каскадом (ShipmentItem.shipment onDelete: Cascade).
      await tx.shipment.delete({ where: { id } });
      await logChange(
        { entity: ENTITY, entityId: id, field: "deleted", oldValue: existing.code },
        Number(user.id),
        tx,
      );
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось удалить отгрузку" };
  }
}

// --- Чтение (доступно всем ролям) ---

function mapItem(item: {
  id: number;
  farmer_id: number;
  culture_id: number;
  planned_weight_kg: Prisma.Decimal;
  contract_line_id: number | null;
  farmer: { name: string };
  culture: { name: string; color: string };
  contractLine: { label: string | null } | null;
}): ShipmentItemRow {
  return {
    id: item.id,
    farmer_id: item.farmer_id,
    farmer_name: item.farmer.name,
    culture_id: item.culture_id,
    culture_name: item.culture.name,
    color: item.culture.color,
    planned_weight_kg: item.planned_weight_kg.toString(),
    contract_line_id: item.contract_line_id,
    contract_line_label: item.contractLine?.label ?? null,
  };
}

const itemInclude = {
  farmer: { select: { name: true } },
  culture: { select: { name: true, color: true } },
  contractLine: { select: { label: true } },
} as const;

export async function getShipments(): Promise<ShipmentListRow[]> {
  const shipments = await prisma.shipment.findMany({
    include: {
      items: { include: itemInclude, orderBy: { id: "asc" } },
      driver: { include: { transportCompany: { select: { name: true } } } },
    },
    orderBy: { arrival_date: "desc" },
  });

  return shipments.map((s) => ({
    id: s.id,
    code: s.code,
    status: s.status,
    departure_date: toDateString(s.departure_date),
    arrival_date: toDateString(s.arrival_date),
    driver_name: s.driver?.full_name ?? null,
    transport_company_name: s.driver?.transportCompany.name ?? null,
    comment: s.comment,
    items: s.items.map(mapItem),
  }));
}

export async function getShipment(id: number): Promise<ShipmentDetail | null> {
  const s = await prisma.shipment.findUnique({
    where: { id },
    include: { items: { include: itemInclude, orderBy: { id: "asc" } } },
  });
  if (!s) return null;

  return {
    id: s.id,
    status: s.status,
    driver_id: s.driver_id,
    departure_date: toDateString(s.departure_date),
    arrival_date: toDateString(s.arrival_date),
    comment: s.comment ?? "",
    items: s.items.map(mapItem),
  };
}

// Опции Select'ов формы: активные водители (+ТК), активные фермеры/культуры,
// строки контрактов ТЕКУЩЕГО сезона (клиент фильтрует по фермеру+культуре).
export async function listShipmentOptions(): Promise<ShipmentOptions> {
  const currentSeason = seasonYearOf(new Date());

  const [drivers, farmers, cultures, lines] = await Promise.all([
    prisma.driver.findMany({
      where: { active: true },
      include: { transportCompany: { select: { name: true } } },
      orderBy: { full_name: "asc" },
    }),
    prisma.farmer.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.culture.findMany({
      where: { active: true },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
    prisma.contractLine.findMany({
      where: { contract: { season_year: currentSeason } },
      select: {
        id: true,
        culture_id: true,
        label: true,
        price_per_kg: true,
        contract: { select: { farmer_id: true } },
      },
      orderBy: { id: "asc" },
    }),
  ]);

  return {
    drivers: drivers.map((d) => ({
      id: d.id,
      full_name: d.full_name,
      transport_company_name: d.transportCompany.name,
    })),
    farmers,
    cultures,
    contractLines: lines.map((l) => ({
      id: l.id,
      farmer_id: l.contract.farmer_id,
      culture_id: l.culture_id,
      label: l.label,
      price_per_kg: l.price_per_kg.toString(),
    })),
  };
}
