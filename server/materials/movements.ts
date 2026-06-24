import { Prisma } from "@/lib/generated/prisma/client";
import type { PrismaClient, ItemKind } from "@/lib/generated/prisma/client";

import {
  FACTORY_LOCATION_ID,
  TRANSIT_TO_FARMER,
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

// Плечо ОТПРАВКИ (planned → sent): материал уходит с завода (0) в транзит «в пути
// к фермеру» (-2). Движение на каждую позицию (тара/ингредиент). Идемпотентно:
// guard по существующему плечу 0 → -2 этого рейса БЕЗ привязки к kind (иначе при
// смешанном грузе второй тип заблокируется). Возвращает число движений.
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
      from_location_id: FACTORY_LOCATION_ID,
      to_location_id: TRANSIT_TO_FARMER,
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
      from_location_id: FACTORY_LOCATION_ID,
      to_location_id: TRANSIT_TO_FARMER,
    }));
  if (data.length === 0) return 0;

  await tx.stockMovement.createMany({ data });
  return data.length;
}

// Плечо ПРИБЫТИЯ (sent → arrived): материал переходит из транзита (-2) к фермеру.
// Движение ПО ПОЗИЦИЯМ. Идемпотентно: guard по существующему плечу -2 → farmer
// этого рейса БЕЗ kind. Возвращает число созданных движений.
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
      from_location_id: TRANSIT_TO_FARMER,
      to_location_id: { gt: 0 }, // любой фермер (locations: 0=завод, <0=транзит)
    },
    select: { id: true },
  });
  if (existing) return 0;

  const data = items
    .filter((i) => itemId(i) != null && i.farmer_id != null)
    .map((i) => ({
      ...baseMovement(tripId, date),
      ...itemRef(i),
      quantity: i.quantity,
      from_location_id: TRANSIT_TO_FARMER,
      to_location_id: i.farmer_id,
    }));
  if (data.length === 0) return 0;

  await tx.stockMovement.createMany({ data });
  return data.length;
}

// Сторно плеча ПРИБЫТИЯ (arrived → sent): материал возвращается от фермера в
// транзит (-2). Нетто по (kind × тип × фермер): оригинал прибытия (to=farmer) плюс,
// уже созданные сторно (to=-2) минус; для нетто>0 — обратное {from:farmer, to:-2}.
// Читаем ОБА kind. Идемпотентно (повторный откат сторнирует только остаток).
export async function revertArrivedLeg(
  tx: Tx,
  tripId: number,
  date: Date,
): Promise<number> {
  const movements = await tx.stockMovement.findMany({
    where: {
      source_doc_type: "material_shipment",
      source_doc_id: tripId,
      movement_type: "delivery",
    },
  });

  // Ключ группы — `${kind}:${itemId}:${farmerId}`. Берём только плечо прибытия
  // (между -2 и фермером); плечо отправки (0 ↔ -2) пропускаем.
  const net = new Map<
    string,
    { kind: ItemKind; itemId: number; farmerId: number; qty: Prisma.Decimal }
  >();
  for (const m of movements) {
    const isOriginal =
      m.from_location_id === TRANSIT_TO_FARMER && (m.to_location_id ?? 0) > 0;
    const isStorno =
      (m.from_location_id ?? 0) > 0 && m.to_location_id === TRANSIT_TO_FARMER;
    if (!isOriginal && !isStorno) continue;

    const { kind, itemId } = movementRef(m);
    const farmerId = isOriginal ? m.to_location_id : m.from_location_id;
    if (itemId == null || farmerId == null) continue;
    const key = `${kind}:${itemId}:${farmerId}`;
    const cur = net.get(key) ?? {
      kind,
      itemId,
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
      ...refByKind(g.kind, g.itemId),
      quantity: g.qty,
      from_location_id: g.farmerId,
      to_location_id: TRANSIT_TO_FARMER,
    })),
  });
  return storno.length;
}

// Сторно плеча ОТПРАВКИ (sent → planned): материал возвращается из транзита (-2) на
// завод (0). Нетто по (kind × тип): оригинал отправки (to=-2) плюс, уже созданные
// сторно (to=0) минус; для нетто>0 — обратное {from:-2, to:0}. Читаем ОБА kind.
// Идемпотентно.
export async function revertDeliveryLeg(
  tx: Tx,
  tripId: number,
  date: Date,
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
      m.from_location_id === FACTORY_LOCATION_ID &&
      m.to_location_id === TRANSIT_TO_FARMER;
    const isStorno =
      m.from_location_id === TRANSIT_TO_FARMER &&
      m.to_location_id === FACTORY_LOCATION_ID;
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
      from_location_id: TRANSIT_TO_FARMER,
      to_location_id: FACTORY_LOCATION_ID,
    })),
  });
  return toCreate.length;
}
