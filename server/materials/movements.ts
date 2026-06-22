import { Prisma } from "@/lib/generated/prisma/client";
import type { PrismaClient } from "@/lib/generated/prisma/client";

import {
  FACTORY_LOCATION_ID,
  TRANSIT_TO_FARMER,
} from "@/server/shipments/packaging";

// Движения тары рейса доставки завод→фермер (D3b). Зеркало server/shipments/
// packaging.ts, но поток СИММЕТРИЧЕН наоборот: завод(0) → транзит(-2) → фермер.
// movement_type=delivery, source_doc_type=material_shipment. Кол-во берётся из
// позиции напрямую (quantity, целое шт) — расчёта из нормы тут НЕТ. Чистый модуль
// без "use server" — зовётся из actions внутри одной транзакции.

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// Позиция в объёме, нужном движениям.
type ItemLite = {
  farmer_id: number;
  packaging_type_id: number | null;
  quantity: Prisma.Decimal;
};

const baseMovement = (tripId: number, date: Date) =>
  ({
    date,
    kind: "packaging" as const,
    from_state: "good" as const,
    to_state: "good" as const,
    movement_type: "delivery" as const,
    source_doc_type: "material_shipment" as const,
    source_doc_id: tripId,
  }) as const;

// Плечо ОТПРАВКИ (planned → sent): тара уходит с завода (0) в транзит «в пути к
// фермеру» (-2). Движение на каждую позицию. Идемпотентно: повторный вызов не
// дублирует (guard по существующему 0 → -2 этого рейса). Возвращает число движений.
export async function applyOutboundDeliveryLeg(
  tx: Tx,
  items: ItemLite[],
  tripId: number,
  date: Date,
): Promise<number> {
  const existing = await tx.stockMovement.findFirst({
    where: {
      source_doc_type: "material_shipment",
      source_doc_id: tripId,
      kind: "packaging",
      from_location_id: FACTORY_LOCATION_ID,
      to_location_id: TRANSIT_TO_FARMER,
    },
    select: { id: true },
  });
  if (existing) return 0;

  const data = items
    .filter((i) => i.packaging_type_id != null)
    .map((i) => ({
      ...baseMovement(tripId, date),
      packaging_type_id: i.packaging_type_id,
      quantity: i.quantity,
      from_location_id: FACTORY_LOCATION_ID,
      to_location_id: TRANSIT_TO_FARMER,
    }));
  if (data.length === 0) return 0;

  await tx.stockMovement.createMany({ data });
  return data.length;
}

// Плечо ПРИБЫТИЯ (sent → arrived): тара переходит из транзита (-2) к фермеру.
// Движение ПО ПОЗИЦИЯМ (итерируем items) — чтобы D3-2 (поза-позиционная отметка)
// добавлялась без переписывания. Идемпотентно: guard по существующему -2 → farmer
// этого рейса. Возвращает число созданных движений.
export async function applyOutboundArrivedLeg(
  tx: Tx,
  items: ItemLite[],
  tripId: number,
  date: Date,
): Promise<number> {
  const existing = await tx.stockMovement.findFirst({
    where: {
      source_doc_type: "material_shipment",
      source_doc_id: tripId,
      kind: "packaging",
      from_location_id: TRANSIT_TO_FARMER,
      to_location_id: { gt: 0 }, // любой фермер (locations: 0=завод, <0=транзит)
    },
    select: { id: true },
  });
  if (existing) return 0;

  const data = items
    .filter((i) => i.packaging_type_id != null && i.farmer_id != null)
    .map((i) => ({
      ...baseMovement(tripId, date),
      packaging_type_id: i.packaging_type_id,
      quantity: i.quantity,
      from_location_id: TRANSIT_TO_FARMER,
      to_location_id: i.farmer_id,
    }));
  if (data.length === 0) return 0;

  await tx.stockMovement.createMany({ data });
  return data.length;
}

// Сторно плеча ПРИБЫТИЯ (arrived → sent): тара возвращается от фермера в транзит
// (-2). Нетто по (тип тары × фермер): оригинал прибытия (to=farmer) плюс, уже
// созданные сторно (to=-2) минус; для нетто>0 — обратное {from:farmer, to:-2}.
// Идемпотентно (повторный откат сторнирует только несторнированный остаток).
export async function revertArrivedLeg(
  tx: Tx,
  tripId: number,
  date: Date,
): Promise<number> {
  const movements = await tx.stockMovement.findMany({
    where: {
      source_doc_type: "material_shipment",
      source_doc_id: tripId,
      kind: "packaging",
      movement_type: "delivery",
    },
  });

  // Ключ группы — `${packagingTypeId}:${farmerId}`. Берём только плечо прибытия
  // (между -2 и фермером); плечо отправки (0 ↔ -2) пропускаем.
  const net = new Map<
    string,
    { packagingTypeId: number; farmerId: number; qty: Prisma.Decimal }
  >();
  for (const m of movements) {
    const isOriginal =
      m.from_location_id === TRANSIT_TO_FARMER && (m.to_location_id ?? 0) > 0;
    const isStorno =
      (m.from_location_id ?? 0) > 0 && m.to_location_id === TRANSIT_TO_FARMER;
    if (!isOriginal && !isStorno) continue;

    const farmerId = isOriginal ? m.to_location_id : m.from_location_id;
    if (m.packaging_type_id == null || farmerId == null) continue;
    const key = `${m.packaging_type_id}:${farmerId}`;
    const cur = net.get(key) ?? {
      packagingTypeId: m.packaging_type_id,
      farmerId,
      qty: new Prisma.Decimal(0),
    };
    cur.qty = isOriginal ? cur.qty.plus(m.quantity) : cur.qty.minus(m.quantity);
    net.set(key, cur);
  }

  const storno = [...net.values()].filter((g) => g.qty.gt(0));
  if (storno.length === 0) return 0;

  await tx.stockMovement.createMany({
    data: storno.map((g) => ({
      ...baseMovement(tripId, date),
      packaging_type_id: g.packagingTypeId,
      quantity: g.qty,
      from_location_id: g.farmerId,
      to_location_id: TRANSIT_TO_FARMER,
    })),
  });
  return storno.length;
}

// Сторно плеча ОТПРАВКИ (sent → planned): тара возвращается из транзита (-2) на
// завод (0). Нетто по типу тары: оригинал отправки (to=-2) плюс, уже созданные
// сторно (to=0) минус; для нетто>0 — обратное {from:-2, to:0}. Идемпотентно.
export async function revertDeliveryLeg(
  tx: Tx,
  tripId: number,
  date: Date,
): Promise<number> {
  const movements = await tx.stockMovement.findMany({
    where: {
      source_doc_type: "material_shipment",
      source_doc_id: tripId,
      kind: "packaging",
      movement_type: "delivery",
    },
  });

  // Только плечо отправки (между заводом 0 и транзитом -2). Плечо прибытия
  // (между -2 и фермером) пропускаем — на planned откатывают только из sent,
  // прибытия ещё не было, но на всякий случай фильтруем явно.
  const net = new Map<number, Prisma.Decimal>();
  for (const m of movements) {
    const isOriginal =
      m.from_location_id === FACTORY_LOCATION_ID &&
      m.to_location_id === TRANSIT_TO_FARMER;
    const isStorno =
      m.from_location_id === TRANSIT_TO_FARMER &&
      m.to_location_id === FACTORY_LOCATION_ID;
    if (!isOriginal && !isStorno) continue;
    if (m.packaging_type_id == null) continue;

    const delta = isOriginal ? m.quantity : m.quantity.neg();
    net.set(
      m.packaging_type_id,
      (net.get(m.packaging_type_id) ?? new Prisma.Decimal(0)).plus(delta),
    );
  }

  const toCreate = [...net.entries()].filter(([, qty]) => qty.gt(0));
  if (toCreate.length === 0) return 0;

  await tx.stockMovement.createMany({
    data: toCreate.map(([packagingTypeId, qty]) => ({
      ...baseMovement(tripId, date),
      packaging_type_id: packagingTypeId,
      quantity: qty,
      from_location_id: TRANSIT_TO_FARMER,
      to_location_id: FACTORY_LOCATION_ID,
    })),
  });
  return toCreate.length;
}
