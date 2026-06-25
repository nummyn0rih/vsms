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
  applyArrivedLegForItem,
  revertArrivedLegForItem,
  revertDeliveryLeg,
  legContext,
} from "./movements";
import { revalidateStockDashboards } from "@/server/inventory/revalidate";

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

// Полная замена позиций рейса: deleteMany + createMany. E1 — полиморфно по
// item_kind: тара (packaging_type_id) ИЛИ ингредиент (ingredient_id), ровно один FK.
// Возвращает summary для ChangeLog (с разбивкой тара/ингредиент).
async function persistMaterialItems(
  tx: Tx,
  tripId: number,
  items: MaterialItemInput[],
): Promise<string> {
  await tx.materialShipmentItem.deleteMany({
    where: { material_shipment_id: tripId },
  });

  const data: Prisma.MaterialShipmentItemCreateManyInput[] = items.map((i) => {
    // undefined → packaging (текущая E1-форма item_kind не шлёт).
    const kind = i.item_kind ?? "packaging";
    const isIngredient = kind === "ingredient";
    return {
      material_shipment_id: tripId,
      farmer_id: Number(i.farmer_id),
      item_kind: kind,
      packaging_type_id: isIngredient ? null : Number(i.packaging_type_id),
      ingredient_id: isIngredient ? Number(i.ingredient_id) : null,
      quantity: i.quantity.trim().replace(",", "."),
    };
  });
  await tx.materialShipmentItem.createMany({ data });

  const tare = data.filter((d) => d.item_kind === "packaging").length;
  const ingr = data.length - tare;
  const parts: string[] = [];
  if (tare > 0) parts.push(`тара ${tare}`);
  if (ingr > 0) parts.push(`ингр. ${ingr}`);
  return `${data.length} позиц.${parts.length ? ` (${parts.join(" / ")})` : ""}`;
}

// transfer-1: разобрать source_farmer_id формы (строка-FK) → id | null. Если задан —
// проверить, что фермер-источник существует. Архивный (active=false) РАЗРЕШЁН: перенос
// остатков ОТ закрытого фермера — штатный кейс. Возвращает { ok, id } | { ok:false, error }.
async function resolveTransferSource(
  tx: Tx,
  raw: string | undefined,
): Promise<{ ok: true; id: number | null } | { ok: false; error: string }> {
  const src = raw?.trim();
  if (!src) return { ok: true, id: null };
  const id = Number(src);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "Некорректный источник переноса" };
  }
  const farmer = await tx.farmer.findUnique({ where: { id }, select: { id: true } });
  if (!farmer) return { ok: false, error: "Источник переноса не найден" };
  return { ok: true, id };
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

    const source = await resolveTransferSource(prisma, parsed.data.source_farmer_id);
    if (!source.ok) return { ok: false, error: source.error };

    await prisma.$transaction(async (tx) => {
      const code = await getNextMaterialCode(tx);
      const created = await tx.materialShipment.create({
        data: {
          code,
          departure_date: parseDateUTC(parsed.data.departure_date),
          arrival_date: parseDateUTC(parsed.data.arrival_date),
          status: "planned",
          driver_id: Number(parsed.data.driver_id),
          source_farmer_id: source.id,
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

    const source = await resolveTransferSource(prisma, parsed.data.source_farmer_id);
    if (!source.ok) return { ok: false, error: source.error };

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
        field: "source_farmer_id",
        oldValue: existing.source_farmer_id == null ? null : String(existing.source_farmer_id),
        newValue: source.id == null ? null : String(source.id),
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
          source_farmer_id: source.id,
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
        legContext(trip),
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

    if (result.ok) {
      revalidatePath(PATH);
      revalidateStockDashboards();
    }
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось отправить рейс" };
  }
}

// --- Прибытие ПО ПОЗИЦИЯМ (D3-2a) ---
//
// arrived_at живёт на позиции; статус рейса (planned/sent/arrived) — производное.
// "partial" в БД НЕ хранится (enum общий с отгрузками продукции) — это только UI
// (см. feed-loader). Здесь рейс остаётся sent, пока прибыли не все позиции.

type ItemArrival = { arrived_at: Date | null };

// Статус рейса по набору позиций: arrived если у ВСЕХ есть arrived_at, иначе sent
// (вызывается только для рейса, который уже прошёл planned). Пустой рейс → sent.
function statusFromItems(items: ItemArrival[]): "sent" | "arrived" {
  return items.length > 0 && items.every((i) => i.arrived_at != null)
    ? "arrived"
    : "sent";
}

// Отметить прибытие ОДНОЙ позиции (Admin|Operator): плечо -2 → фермер этой позиции,
// arrived_at=now(), статус рейса пересчитывается. Идемпотентно (повтор — no-op).
export async function markItemArrived(itemId: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin", "operator");

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.materialShipmentItem.findUnique({
        where: { id: itemId },
        include: { materialShipment: { include: { items: true } } },
      });
      if (!item) return { ok: false as const, error: "Позиция не найдена" };
      const trip = item.materialShipment;
      if (trip.status === "planned") {
        return { ok: false as const, error: "Сначала отправьте рейс" };
      }
      if (item.arrived_at != null) return { ok: true as const }; // no-op

      await applyArrivedLegForItem(tx, item, trip.id, new Date(), legContext(trip));
      await tx.materialShipmentItem.update({
        where: { id: itemId },
        data: { arrived_at: new Date() },
      });

      // Пересчёт статуса по актуальному набору (текущая позиция теперь прибыла).
      const nextItems = trip.items.map((i) =>
        i.id === itemId ? { arrived_at: new Date() } : { arrived_at: i.arrived_at },
      );
      const nextStatus = statusFromItems(nextItems);
      if (nextStatus !== trip.status) {
        await tx.materialShipment.update({
          where: { id: trip.id },
          data: { status: nextStatus },
        });
      }

      await logChange(
        [
          { entity: ENTITY, entityId: trip.id, field: "item_arrived", newValue: `поз. ${itemId}` },
          ...(nextStatus !== trip.status
            ? [{ entity: ENTITY, entityId: trip.id, field: "status", oldValue: trip.status, newValue: nextStatus }]
            : []),
        ],
        Number(user.id),
        tx,
      );

      return { ok: true as const };
    });

    if (result.ok) {
      revalidatePath(PATH);
      revalidateStockDashboards();
    }
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось отметить прибытие позиции" };
  }
}

// Снять прибытие ОДНОЙ позиции (Admin): сторно плеча прибытия позиции,
// arrived_at=null, статус рейса → sent (раз хотя бы одна позиция не прибыла).
export async function unmarkItemArrived(itemId: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.materialShipmentItem.findUnique({
        where: { id: itemId },
        include: { materialShipment: { include: { items: true } } },
      });
      if (!item) return { ok: false as const, error: "Позиция не найдена" };
      const trip = item.materialShipment;
      if (item.arrived_at == null) return { ok: true as const }; // no-op

      await revertArrivedLegForItem(tx, item, trip.id, new Date(), legContext(trip));
      await tx.materialShipmentItem.update({
        where: { id: itemId },
        data: { arrived_at: null },
      });

      const nextItems = trip.items.map((i) =>
        i.id === itemId ? { arrived_at: null } : { arrived_at: i.arrived_at },
      );
      const nextStatus = statusFromItems(nextItems);
      if (nextStatus !== trip.status) {
        await tx.materialShipment.update({
          where: { id: trip.id },
          data: { status: nextStatus },
        });
      }

      await logChange(
        [
          { entity: ENTITY, entityId: trip.id, field: "item_unarrived", newValue: `поз. ${itemId}` },
          ...(nextStatus !== trip.status
            ? [{ entity: ENTITY, entityId: trip.id, field: "status", oldValue: trip.status, newValue: nextStatus }]
            : []),
        ],
        Number(user.id),
        tx,
      );

      return { ok: true as const };
    });

    if (result.ok) {
      revalidatePath(PATH);
      revalidateStockDashboards();
    }
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось снять прибытие позиции" };
  }
}

// Принять ВЕСЬ рейс (Admin|Operator): отметить прибытие всех ещё не прибывших
// позиций. Заменяет старый arriveMaterialShipment. Идемпотентно по позициям.
export async function markAllArrived(tripId: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin", "operator");

    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.materialShipment.findUnique({
        where: { id: tripId },
        include: { items: true },
      });
      if (!trip) return { ok: false as const, error: "Рейс не найден" };
      if (trip.status === "planned") {
        return { ok: false as const, error: "Сначала отправьте рейс" };
      }

      const now = new Date();
      const ctx = legContext(trip);
      let marked = 0;
      for (const item of trip.items) {
        if (item.arrived_at != null) continue;
        await applyArrivedLegForItem(tx, item, tripId, now, ctx);
        marked++;
      }
      await tx.materialShipmentItem.updateMany({
        where: { material_shipment_id: tripId, arrived_at: null },
        data: { arrived_at: now },
      });
      await tx.materialShipment.update({ where: { id: tripId }, data: { status: "arrived" } });

      await logChange(
        [
          { entity: ENTITY, entityId: tripId, field: "status", oldValue: trip.status, newValue: "arrived" },
          { entity: ENTITY, entityId: tripId, field: "movements", newValue: `прибытие: ${marked} позиц.` },
        ],
        Number(user.id),
        tx,
      );

      return { ok: true as const };
    });

    if (result.ok) {
      revalidatePath(PATH);
      revalidateStockDashboards();
    }
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось отметить прибытие" };
  }
}

// Снять прибытие со ВСЕХ позиций рейса (Admin): сторно плеч прибытия, статус → sent.
// Заменяет старый revertMaterialToSent.
export async function unmarkAllArrived(tripId: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.materialShipment.findUnique({
        where: { id: tripId },
        include: { items: true },
      });
      if (!trip) return { ok: false as const, error: "Рейс не найден" };
      // Гард: на planned снимать нечего; не уводить planned→sent без плеча отправки.
      if (trip.status === "planned") return { ok: true as const };

      const now = new Date();
      const ctx = legContext(trip);
      let reverted = 0;
      for (const item of trip.items) {
        if (item.arrived_at == null) continue;
        reverted += await revertArrivedLegForItem(tx, item, tripId, now, ctx);
      }
      await tx.materialShipmentItem.updateMany({
        where: { material_shipment_id: tripId },
        data: { arrived_at: null },
      });
      await tx.materialShipment.update({ where: { id: tripId }, data: { status: "sent" } });

      await logChange(
        [
          { entity: ENTITY, entityId: tripId, field: "status", oldValue: trip.status, newValue: "sent" },
          { entity: ENTITY, entityId: tripId, field: "storno", newValue: `сторно прибытия: ${reverted} позиц.` },
        ],
        Number(user.id),
        tx,
      );

      return { ok: true as const };
    });

    if (result.ok) {
      revalidatePath(PATH);
      revalidateStockDashboards();
    }
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось снять прибытие" };
  }
}

// sent → planned (Admin): сторно плеча отправки (транзит -2 → завод 0).
export async function revertMaterialToPlanned(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.materialShipment.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!trip) return { ok: false as const, error: "Рейс не найден" };
      if (trip.status !== "sent") {
        return { ok: false as const, error: "Откат возможен только из статуса «Отправлен»" };
      }
      // Гард: на planned откатываем только полностью «в пути» рейс. Если хоть одна
      // позиция уже прибыла — сначала снять прибытие (плечо -2→фермер не сторнировано).
      if (trip.items.some((i) => i.arrived_at != null)) {
        return { ok: false as const, error: "Сначала снимите прибытие позиций" };
      }

      const count = await revertDeliveryLeg(tx, id, new Date(), legContext(trip));

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

    if (result.ok) {
      revalidatePath(PATH);
      revalidateStockDashboards();
    }
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось откатить рейс" };
  }
}

// --- Чтение (доступно всем ролям) ---

const itemInclude = {
  farmer: { select: { name: true } },
  packagingType: { select: { name: true, kind: true, capacity_kg: true } },
  ingredient: { select: { name: true, unit: true } },
} as const;

function mapItem(item: {
  id: number;
  farmer_id: number;
  item_kind: "packaging" | "ingredient";
  packaging_type_id: number | null;
  ingredient_id: number | null;
  quantity: Prisma.Decimal;
  arrived_at: Date | null;
  farmer: { name: string };
  packagingType: { name: string; kind: "box" | "barrel"; capacity_kg: Prisma.Decimal | null } | null;
  ingredient: { name: string; unit: "kg" | "l" } | null;
}): MaterialItemRow {
  return {
    id: item.id,
    farmer_id: item.farmer_id,
    farmer_name: item.farmer.name,
    item_kind: item.item_kind,
    packaging_type_id: item.packaging_type_id,
    packaging_type_name: item.packagingType?.name ?? null,
    packaging_kind: item.packagingType?.kind ?? null,
    capacity_kg: item.packagingType?.capacity_kg?.toString() ?? null,
    ingredient_id: item.ingredient_id,
    ingredient_name: item.ingredient?.name ?? null,
    ingredient_unit: item.ingredient?.unit ?? null,
    quantity: item.quantity.toString(),
    arrived_at: toDateString(item.arrived_at),
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
    source_farmer_id: t.source_farmer_id,
    departure_date: toDateString(t.departure_date),
    arrival_date: toDateString(t.arrival_date),
    items: t.items.map(mapItem),
  };
}

// Опции формы: активные водители (+ТК), активные фермеры, активные типы тары.
export async function listMaterialOptions(): Promise<MaterialOptions> {
  const [drivers, farmers, packagingTypes, ingredients] = await Promise.all([
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
    prisma.ingredient.findMany({
      where: { active: true },
      select: { id: true, name: true, unit: true },
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
    ingredients,
  };
}
