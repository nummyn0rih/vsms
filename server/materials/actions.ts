"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { parseDateUTC } from "@/server/shipments/workdays";
import {
  materialShipmentSchema,
  type MaterialShipmentInput,
  type MaterialItemInput,
  type MaterialDetail,
  type MaterialItemRow,
  type MaterialOptions,
} from "./schema";
import {
  applyOutboundDeliveryLeg,
  applyOutboundArrivedLeg,
  revertArrivedLeg,
  revertDeliveryLeg,
} from "./movements";

const ENTITY = "MaterialShipment";
const PATH = "/materials";

type Tx = Prisma.TransactionClient;

// Перехват ошибок RBAC → ActionResult (страницу не валим). Образец shipments.
function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

function toDateString(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// Сквозной счётчик по рейсам тары. ОТДЕЛЬНАЯ нумерация — не пересекается с
// отгрузками (своя таблица). code хранится String, значения целые → MAX(code::int)+1.
async function getNextMaterialCode(tx: Tx): Promise<string> {
  const rows = await tx.$queryRaw<{ max: number }[]>`
    SELECT COALESCE(MAX(code::int), 0) AS max FROM "MaterialShipment"
  `;
  return String(Number(rows[0]?.max ?? 0) + 1);
}

// Полная замена позиций рейса: deleteMany + createMany. D3 — всегда packaging
// (item_kind=packaging, ingredient_id=null). Возвращает summary для ChangeLog.
async function persistMaterialItems(
  tx: Tx,
  tripId: number,
  items: MaterialItemInput[],
): Promise<string> {
  await tx.materialShipmentItem.deleteMany({
    where: { material_shipment_id: tripId },
  });

  const data: Prisma.MaterialShipmentItemCreateManyInput[] = items.map((i) => ({
    material_shipment_id: tripId,
    farmer_id: Number(i.farmer_id),
    item_kind: "packaging",
    packaging_type_id: Number(i.packaging_type_id),
    ingredient_id: null,
    quantity: i.quantity.trim().replace(",", "."),
  }));
  await tx.materialShipmentItem.createMany({ data });

  return `${data.length} позиц.`;
}

// --- CRUD (только planned) ---

export async function createMaterialShipment(
  input: MaterialShipmentInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = materialShipmentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    await prisma.$transaction(async (tx) => {
      const code = await getNextMaterialCode(tx);
      const created = await tx.materialShipment.create({
        data: {
          code,
          departure_date: parseDateUTC(parsed.data.departure_date),
          arrival_date: parseDateUTC(parsed.data.arrival_date),
          status: "planned",
          driver_id: Number(parsed.data.driver_id),
        },
      });

      const itemsSummary = await persistMaterialItems(
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
    return authFail(e) ?? { ok: false, error: "Не удалось создать рейс" };
  }
}

export async function updateMaterialShipment(
  id: number,
  input: MaterialShipmentInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.materialShipment.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Рейс не найден" };
    if (existing.status !== "planned") {
      return {
        ok: false,
        error: "Рейс отправлен — сначала откат статуса, потом правка",
      };
    }

    const parsed = materialShipmentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const nextDriverId = Number(parsed.data.driver_id);
    const nextDeparture = parseDateUTC(parsed.data.departure_date);
    const nextArrival = parseDateUTC(parsed.data.arrival_date);

    const changes = [
      {
        field: "driver_id",
        oldValue: String(existing.driver_id),
        newValue: String(nextDriverId),
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
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.$transaction(async (tx) => {
      await tx.materialShipment.update({
        where: { id },
        data: {
          driver_id: nextDriverId,
          departure_date: nextDeparture,
          arrival_date: nextArrival,
        },
      });

      const itemsSummary = await persistMaterialItems(tx, id, parsed.data.items);

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
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить" };
  }
}

export async function deleteMaterialShipment(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.materialShipment.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Рейс не найден" };
    if (existing.status !== "planned") {
      return {
        ok: false,
        error: "Удаление запрещено: сначала откат статуса до planned",
      };
    }

    await prisma.$transaction(async (tx) => {
      // Позиции уйдут каскадом (MaterialShipmentItem onDelete: Cascade).
      await tx.materialShipment.delete({ where: { id } });
      await logChange(
        { entity: ENTITY, entityId: id, field: "deleted", oldValue: existing.code },
        Number(user.id),
        tx,
      );
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось удалить рейс" };
  }
}

// --- Переходы статуса + движения тары (двухфазный транзит -2) ---

// planned → sent (Admin): плечо отправки тары (завод 0 → транзит -2).
export async function sendMaterialShipment(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.materialShipment.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!trip) return { ok: false as const, error: "Рейс не найден" };
      if (trip.status !== "planned") {
        return { ok: false as const, error: "Рейс уже отправлен" };
      }

      const count = await applyOutboundDeliveryLeg(
        tx,
        trip.items,
        id,
        trip.departure_date ?? new Date(),
      );

      await tx.materialShipment.update({ where: { id }, data: { status: "sent" } });

      await logChange(
        [
          { entity: ENTITY, entityId: id, field: "status", oldValue: "planned", newValue: "sent" },
          { entity: ENTITY, entityId: id, field: "movements", newValue: `отправка: ${count} движ.` },
        ],
        Number(user.id),
        tx,
      );

      return { ok: true as const };
    });

    if (result.ok) revalidatePath(PATH);
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось отправить рейс" };
  }
}

// sent → arrived (Admin|Operator): плечо прибытия тары (транзит -2 → фермер).
export async function arriveMaterialShipment(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin", "operator");

    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.materialShipment.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!trip) return { ok: false as const, error: "Рейс не найден" };
      if (trip.status !== "sent") {
        return { ok: false as const, error: "Прибытие возможно только из статуса «Отправлен»" };
      }

      const count = await applyOutboundArrivedLeg(
        tx,
        trip.items,
        id,
        trip.arrival_date ?? new Date(),
      );

      await tx.materialShipment.update({ where: { id }, data: { status: "arrived" } });

      await logChange(
        [
          { entity: ENTITY, entityId: id, field: "status", oldValue: "sent", newValue: "arrived" },
          { entity: ENTITY, entityId: id, field: "movements", newValue: `прибытие: ${count} движ.` },
        ],
        Number(user.id),
        tx,
      );

      return { ok: true as const };
    });

    if (result.ok) revalidatePath(PATH);
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось отметить прибытие" };
  }
}

// arrived → sent (Admin): сторно плеча прибытия (фермер → транзит -2).
export async function revertMaterialToSent(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.materialShipment.findUnique({ where: { id } });
      if (!trip) return { ok: false as const, error: "Рейс не найден" };
      if (trip.status !== "arrived") {
        return { ok: false as const, error: "Откат возможен только из статуса «Прибыл»" };
      }

      const count = await revertArrivedLeg(tx, id, new Date());

      await tx.materialShipment.update({ where: { id }, data: { status: "sent" } });

      await logChange(
        [
          { entity: ENTITY, entityId: id, field: "status", oldValue: "arrived", newValue: "sent" },
          { entity: ENTITY, entityId: id, field: "storno", newValue: `сторно прибытия: ${count} групп` },
        ],
        Number(user.id),
        tx,
      );

      return { ok: true as const };
    });

    if (result.ok) revalidatePath(PATH);
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось откатить рейс" };
  }
}

// sent → planned (Admin): сторно плеча отправки (транзит -2 → завод 0).
export async function revertMaterialToPlanned(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.materialShipment.findUnique({ where: { id } });
      if (!trip) return { ok: false as const, error: "Рейс не найден" };
      if (trip.status !== "sent") {
        return { ok: false as const, error: "Откат возможен только из статуса «Отправлен»" };
      }

      const count = await revertDeliveryLeg(tx, id, new Date());

      await tx.materialShipment.update({ where: { id }, data: { status: "planned" } });

      await logChange(
        [
          { entity: ENTITY, entityId: id, field: "status", oldValue: "sent", newValue: "planned" },
          { entity: ENTITY, entityId: id, field: "storno", newValue: `сторно отправки: ${count} групп` },
        ],
        Number(user.id),
        tx,
      );

      return { ok: true as const };
    });

    if (result.ok) revalidatePath(PATH);
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось откатить рейс" };
  }
}

// --- Чтение (доступно всем ролям) ---

const itemInclude = {
  farmer: { select: { name: true } },
  packagingType: { select: { name: true, kind: true, capacity_kg: true } },
} as const;

function mapItem(item: {
  id: number;
  farmer_id: number;
  packaging_type_id: number | null;
  quantity: Prisma.Decimal;
  farmer: { name: string };
  packagingType: { name: string; kind: "box" | "barrel"; capacity_kg: Prisma.Decimal | null } | null;
}): MaterialItemRow {
  return {
    id: item.id,
    farmer_id: item.farmer_id,
    farmer_name: item.farmer.name,
    packaging_type_id: item.packaging_type_id ?? 0,
    packaging_type_name: item.packagingType?.name ?? "тара",
    packaging_kind: item.packagingType?.kind ?? "box",
    capacity_kg: item.packagingType?.capacity_kg?.toString() ?? null,
    quantity: item.quantity.toString(),
  };
}

export async function getMaterialShipment(
  id: number,
): Promise<MaterialDetail | null> {
  const t = await prisma.materialShipment.findUnique({
    where: { id },
    include: { items: { include: itemInclude, orderBy: { id: "asc" } } },
  });
  if (!t) return null;

  return {
    id: t.id,
    status: t.status as MaterialDetail["status"],
    driver_id: t.driver_id,
    departure_date: toDateString(t.departure_date),
    arrival_date: toDateString(t.arrival_date),
    items: t.items.map(mapItem),
  };
}

// Опции формы: активные водители (+ТК), активные фермеры, активные типы тары.
export async function listMaterialOptions(): Promise<MaterialOptions> {
  const [drivers, farmers, packagingTypes] = await Promise.all([
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
    prisma.packagingType.findMany({
      where: { active: true },
      select: { id: true, name: true, kind: true, capacity_kg: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    drivers: drivers.map((d) => ({
      id: d.id,
      full_name: d.full_name,
      transport_company_name: d.transportCompany.name,
    })),
    farmers,
    packagingTypes: packagingTypes.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      capacity_kg: p.capacity_kg?.toString() ?? null,
    })),
  };
}
