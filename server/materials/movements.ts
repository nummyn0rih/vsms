import { Prisma } from "@/lib/generated/prisma/client";
import type { PrismaClient, ItemKind } from "@/lib/generated/prisma/client";

import {
  FACTORY_LOCATION_ID,
  TRANSIT_TO_FARMER,
  TRANSFER_TRANSIT,
} from "@/server/shipments/packaging";

// Движения рейса доставки завод→фермер (D3b/E1). Поток СИММЕТРИЧЕН входящему, но
// наоборот: завод(0) → транзит(-2) → фермер. movement_type=delivery,
// source_doc_type=material_shipment. Кол-во берётся из позиции напрямую (quantity)
// — расчёта из нормы тут НЕТ.
//
// E1, ВАРИАНТ A: один и тот же код возит тару И ингредиент (в т.ч. СМЕШАННЫЙ груз
// в одном рейсе). Разница только в дискриминаторе kind + соответствующем FK
// (packaging_type_id ИЛИ ingredient_id) + состоянии (тара good/good, ингредиент
// null/null — у ингредиентов состояния нет, см. C2 acceptance). Ингредиент едет
// тем же транзитом -2 (НЕ путать с consumption фермер→null и с source=shipment -1).
// Чистый модуль без "use server" — зовётся из actions внутри одной транзакции.

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// Позиция в объёме, нужном движениям. Полиморфна: item_kind задаёт, какой FK живой.
type ItemLite = {
  farmer_id: number;
  item_kind: ItemKind;
  packaging_type_id: number | null;
  ingredient_id: number | null;
  quantity: Prisma.Decimal;
};

// Плечи рейса (transfer-1): origin = откуда уезжает груз, transit = «в пути» сентинел.
// Доставка завод→фермер: { origin: 0, transit: -2 } (поведение БЕЗ ИЗМЕНЕНИЙ).
// Перенос фермер A→фермер B: { origin: A, transit: -3 }. Получатель плеча прибытия —
// всегда item.farmer_id (>0). Источник плеч читается из рейса, не хардкодится.
export type LegContext = { origin: number; transit: number };

export function legContext(trip: { source_farmer_id: number | null }): LegContext {
  const isTransfer = trip.source_farmer_id != null;
  return {
    origin: isTransfer ? trip.source_farmer_id! : FACTORY_LOCATION_ID,
    transit: isTransfer ? TRANSFER_TRANSIT : TRANSIT_TO_FARMER,
  };
}

// Дискриминатор + правильный FK + состояния по item_kind позиции. Тара — good/good,
// ингредиент — null/null (у ингредиентов состояния нет).
function itemRef(i: { item_kind: ItemKind; packaging_type_id: number | null; ingredient_id: number | null }) {
  if (i.item_kind === "ingredient") {
    return {
      kind: "ingredient" as const,
      packaging_type_id: null,
      ingredient_id: i.ingredient_id,
      from_state: null,
      to_state: null,
    };
  }
  return {
    kind: "packaging" as const,
    packaging_type_id: i.packaging_type_id,
    ingredient_id: null,
    from_state: "good" as const,
    to_state: "good" as const,
  };
}

// Живой FK позиции (для группировки сторно по типу).
function itemId(i: ItemLite): number | null {
  return i.item_kind === "ingredient" ? i.ingredient_id : i.packaging_type_id;
}

// kind + itemId уже созданного движения — определяем по факту заполненного FK.
function movementRef(m: {
  kind: ItemKind;
  packaging_type_id: number | null;
  ingredient_id: number | null;
}): { kind: ItemKind; itemId: number | null } {
  return m.kind === "ingredient"
    ? { kind: "ingredient", itemId: m.ingredient_id }
    : { kind: "packaging", itemId: m.packaging_type_id };
}

// FK + состояния для сторно-строки по kind группы.
function refByKind(kind: ItemKind, itemId: number) {
  return kind === "ingredient"
    ? {
        kind: "ingredient" as const,
        packaging_type_id: null,
        ingredient_id: itemId,
        from_state: null,
        to_state: null,
      }
    : {
        kind: "packaging" as const,
        packaging_type_id: itemId,
        ingredient_id: null,
        from_state: "good" as const,
        to_state: "good" as const,
      };
}

const baseMovement = (tripId: number, date: Date) =>
  ({
    date,
    movement_type: "delivery" as const,
    source_doc_type: "material_shipment" as const,
    source_doc_id: tripId,
  }) as const;

// Плечо ОТПРАВКИ (planned → sent): материал уходит из origin рейса в транзит «в
// пути» (ctx.transit). Доставка: 0 → -2; перенос: фермер A → -3. Движение на каждую
// позицию (тара/ингредиент). Идемпотентно: guard по существующему плечу
// origin → transit этого рейса БЕЗ привязки к kind (иначе при смешанном грузе второй
// тип заблокируется). Возвращает число движений.
export async function applyOutboundDeliveryLeg(
  tx: Tx,
  items: ItemLite[],
  tripId: number,
  date: Date,
  ctx: LegContext,
): Promise<number> {
  const existing = await tx.stockMovement.findFirst({
    where: {
      source_doc_type: "material_shipment",
      source_doc_id: tripId,
      from_location_id: ctx.origin,
      to_location_id: ctx.transit,
    },
    select: { id: true },
  });
  if (existing) return 0;

  const data = items
    .filter((i) => itemId(i) != null)
    .map((i) => ({
      ...baseMovement(tripId, date),
      ...itemRef(i),
      quantity: i.quantity,
      from_location_id: ctx.origin,
      to_location_id: ctx.transit,
    }));
  if (data.length === 0) return 0;

  await tx.stockMovement.createMany({ data });
  return data.length;
}

// Нетто плеча прибытия позиции = Σ(transit→фермер) − Σ(фермер→transit) по kind+FK этой
// позиции. transit берётся из рейса (-2 доставка / -3 перенос). >0 — позиция прибыла
// (плечо открыто); 0 — в пути/откатано. На этом нетто строятся идемпотентность apply
// (skip при >0) и сторно revert (skip при ≤0), поэтому пара mark/unmark полностью
// обратима (повторный mark после unmark снова открывает плечо).
async function arrivedNetForItem(
  tx: Tx,
  item: ItemLite,
  tripId: number,
  ctx: LegContext,
): Promise<Prisma.Decimal> {
  const ref = itemRef(item);
  const movements = await tx.stockMovement.findMany({
    where: {
      source_doc_type: "material_shipment",
      source_doc_id: tripId,
      movement_type: "delivery",
      kind: ref.kind,
      packaging_type_id: ref.packaging_type_id,
      ingredient_id: ref.ingredient_id,
    },
  });
  let net = new Prisma.Decimal(0);
  for (const m of movements) {
    if (m.from_location_id === ctx.transit && m.to_location_id === item.farmer_id)
      net = net.plus(m.quantity);
    else if (m.from_location_id === item.farmer_id && m.to_location_id === ctx.transit)
      net = net.minus(m.quantity);
  }
  return net;
}

// Плечо ПРИБЫТИЯ ОДНОЙ позиции (D3-2a): материал переходит из транзита (ctx.transit)
// к фермеру этой позиции. kind+FK берутся из item_kind. Идемпотентно по НЕТТО: если
// плечо уже открыто (net>0) — не дублируем. Возвращает 0 (уже прибыла/нет FK) или 1.
export async function applyArrivedLegForItem(
  tx: Tx,
  item: ItemLite,
  tripId: number,
  date: Date,
  ctx: LegContext,
): Promise<number> {
  const id = itemId(item);
  if (id == null || item.farmer_id == null) return 0;
  if ((await arrivedNetForItem(tx, item, tripId, ctx)).gt(0)) return 0;

  await tx.stockMovement.create({
    data: {
      ...baseMovement(tripId, date),
      ...itemRef(item),
      quantity: item.quantity,
      from_location_id: ctx.transit,
      to_location_id: item.farmer_id,
    },
  });
  return 1;
}

// Плечо ПРИБЫТИЯ (sent → arrived): пакетный вызов поверх per-item примитива —
// проходит по позициям, не прибывшим ранее (per-item idempotency делает свою
// работу). Возвращает число созданных движений.
export async function applyOutboundArrivedLeg(
  tx: Tx,
  items: ItemLite[],
  tripId: number,
  date: Date,
  ctx: LegContext,
): Promise<number> {
  let count = 0;
  for (const item of items) {
    count += await applyArrivedLegForItem(tx, item, tripId, date, ctx);
  }
  return count;
}

// Сторно плеча ПРИБЫТИЯ ОДНОЙ позиции (arrived → sent для позиции): материал
// возвращается от фермера в транзит (-2). Нетто по группе `${kind}:${itemId}:${farmerId}`
// этой позиции: оригинал прибытия (to=farmer) плюс, уже созданные сторно (to=-2)
// минус; для нетто>0 — обратное {from:farmer, to:-2}. Идемпотентно (повторный откат
// сторнирует только остаток). Возвращает 0/1.
export async function revertArrivedLegForItem(
  tx: Tx,
  item: ItemLite,
  tripId: number,
  date: Date,
  ctx: LegContext,
): Promise<number> {
  const id = itemId(item);
  if (id == null || item.farmer_id == null) return 0;

  const net = await arrivedNetForItem(tx, item, tripId, ctx);
  if (net.lte(0)) return 0; // плечо закрыто/не открывалось — сторнировать нечего

  await tx.stockMovement.create({
    data: {
      ...baseMovement(tripId, date),
      ...itemRef(item),
      quantity: net,
      from_location_id: item.farmer_id,
      to_location_id: ctx.transit,
    },
  });
  return 1;
}

// Сторно плеча ПРИБЫТИЯ (arrived → sent): пакетный вызов поверх per-item примитива —
// тянет позиции рейса и сторнирует прибытие каждой прибывшей. Возвращает число сторно.
export async function revertArrivedLeg(
  tx: Tx,
  tripId: number,
  date: Date,
  ctx: LegContext,
): Promise<number> {
  const items = await tx.materialShipmentItem.findMany({
    where: { material_shipment_id: tripId },
  });
  let count = 0;
  for (const item of items) {
    count += await revertArrivedLegForItem(tx, item, tripId, date, ctx);
  }
  return count;
}

// Сторно плеча ОТПРАВКИ (sent → planned): материал возвращается из транзита
// (ctx.transit) в origin рейса (завод 0 / фермер-источник A). Нетто по (kind × тип):
// оригинал отправки (to=transit) плюс, уже созданные сторно (to=origin) минус; для
// нетто>0 — обратное {from:transit, to:origin}. Читаем ОБА kind. Идемпотентно.
export async function revertDeliveryLeg(
  tx: Tx,
  tripId: number,
  date: Date,
  ctx: LegContext,
): Promise<number> {
  const movements = await tx.stockMovement.findMany({
    where: {
      source_doc_type: "material_shipment",
      source_doc_id: tripId,
      movement_type: "delivery",
    },
  });

  // Только плечо отправки (между заводом 0 и транзитом -2). Плечо прибытия
  // (между -2 и фермером) пропускаем — на planned откатывают только из sent.
  // Ключ — `${kind}:${itemId}`.
  const net = new Map<
    string,
    { kind: ItemKind; itemId: number; qty: Prisma.Decimal }
  >();
  for (const m of movements) {
    const isOriginal =
      m.from_location_id === ctx.origin &&
      m.to_location_id === ctx.transit;
    const isStorno =
      m.from_location_id === ctx.transit &&
      m.to_location_id === ctx.origin;
    if (!isOriginal && !isStorno) continue;

    const { kind, itemId } = movementRef(m);
    if (itemId == null) continue;
    const key = `${kind}:${itemId}`;
    const delta = isOriginal ? m.quantity : m.quantity.neg();
    const cur = net.get(key) ?? { kind, itemId, qty: new Prisma.Decimal(0) };
    cur.qty = cur.qty.plus(delta);
    net.set(key, cur);
  }

  const toCreate = [...net.values()].filter((g) => g.qty.gt(0));
  if (toCreate.length === 0) return 0;

  await tx.stockMovement.createMany({
    data: toCreate.map((g) => ({
      ...baseMovement(tripId, date),
      ...refByKind(g.kind, g.itemId),
      quantity: g.qty,
      from_location_id: ctx.transit,
      to_location_id: ctx.origin,
    })),
  });
  return toCreate.length;
}
