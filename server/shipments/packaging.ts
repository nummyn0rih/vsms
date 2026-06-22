import { Prisma } from "@/lib/generated/prisma/client";
import type { PrismaClient } from "@/lib/generated/prisma/client";

// Расчёт плановой потребности тары по позиции отгрузки (BR-3). Чистый модуль БЕЗ
// "use server" — переиспользуется в sendShipment (запись движений) и в B3
// (инфо-показ в ленте). Decimal-математика Prisma.

// Завод — фиксированная локация id=0 (DOMAIN §3, правило 1). Не FK, литерал.
export const FACTORY_LOCATION_ID = 0;

// Транзит-сентинелы (DOMAIN §3, правило 1): двухфазное движение тары идёт через
// «в пути». Не FK, литералы. Как локации для opening/ручного ввода — запрещены.
export const TRANSIT_TO_FACTORY = -1; // в пути НА завод (продукция фермер→завод)
export const TRANSIT_TO_FARMER = -2; // в пути С завода (тара завод→фермер)

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// Три исхода расчёта (дискриминированный возврат вместо throw — чтобы sendShipment
// мог собрать ВСЕ позиции без нормы за один проход):
// - none         — у позиции нет типа тары (навал), движение не создаётся (легально);
// - ok           — посчитано, units целое (ceil);
// - missing_norm — нет PackagingNorm по тройке, расчёт невозможен → ошибка.
export type PackagingCalc =
  | { status: "none" }
  | { status: "ok"; packagingTypeId: number; units: number }
  | { status: "missing_norm" };

// Единая формула (B2.5): развилки box/barrel БОЛЬШЕ НЕТ. units всегда считаются от
// нетто-нормы тройки (фермер×культура×тип). capacity_kg НЕ участвует.
export function calcPackagingUnits(
  plannedWeightKg: Prisma.Decimal,
  packagingTypeId: number | null,
  norm?: { avg_unit_weight_kg: Prisma.Decimal } | null,
): PackagingCalc {
  // Навал: у позиции не выбран тип тары — тары нет, это легально.
  if (packagingTypeId == null) return { status: "none" };
  // Нет нормы по тройке — считать нечем (блокирует переход planned→sent).
  if (!norm) return { status: "missing_norm" };
  return {
    status: "ok",
    packagingTypeId,
    units: plannedWeightKg.div(norm.avg_unit_weight_kg).ceil().toNumber(),
  };
}

// Позиция в минимальном объёме, нужном расчёту тары.
type ItemLite = {
  farmer_id: number;
  culture_id: number;
  packaging_type_id: number | null;
};

export type PackagingContext = {
  // Нетто-норма по тройке. Ключ — `${farmer_id}:${culture_id}:${packaging_type_id}`.
  normByTriple: Map<string, { avg_unit_weight_kg: Prisma.Decimal }>;
  // Имена типов тары (для текста ошибки/ChangeLog). Ключ — packaging_type_id.
  nameByType: Map<number, string>;
};

export function tripleKey(
  farmerId: number,
  cultureId: number,
  packagingTypeId: number,
): string {
  return `${farmerId}:${cultureId}:${packagingTypeId}`;
}

// Пачкой подтягивает нормы по тройкам позиций и имена их типов тары (без N+1).
// Используют sendShipment и buildTarePlan.
export async function loadPackagingContext(
  tx: Tx,
  items: ItemLite[],
): Promise<PackagingContext> {
  const typed = items.filter(
    (i): i is ItemLite & { packaging_type_id: number } =>
      i.packaging_type_id != null,
  );

  const typeIds = [...new Set(typed.map((i) => i.packaging_type_id))];

  const [norms, types] = await Promise.all([
    typed.length > 0
      ? tx.packagingNorm.findMany({
          where: {
            OR: typed.map((i) => ({
              farmer_id: i.farmer_id,
              culture_id: i.culture_id,
              packaging_type_id: i.packaging_type_id,
            })),
          },
          select: {
            farmer_id: true,
            culture_id: true,
            packaging_type_id: true,
            avg_unit_weight_kg: true,
          },
        })
      : Promise.resolve([]),
    typeIds.length > 0
      ? tx.packagingType.findMany({
          where: { id: { in: typeIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const normByTriple = new Map(
    norms.map((n) => [
      tripleKey(n.farmer_id, n.culture_id, n.packaging_type_id),
      { avg_unit_weight_kg: n.avg_unit_weight_kg },
    ]),
  );
  const nameByType = new Map(types.map((t) => [t.id, t.name]));

  return { normByTriple, nameByType };
}

// Плечо ПРИБЫТИЯ (sent → arrived, BR-3): тара переходит из транзита «в пути на
// завод» (-1) на завод (0). Чистый помощник, зовётся из acceptance при переходе.
// Идемпотентен: повторный вызов (повтор markArrived) НЕ дублирует движения.
// Возвращает число созданных движений (для ChangeLog).
export async function applyInboundArrivedTareLeg(
  tx: Tx,
  shipmentId: number,
): Promise<number> {
  // Уже есть хоть одно движение плеча прибытия (-1 → 0) по этой отгрузке → выходим.
  const existing = await tx.stockMovement.findFirst({
    where: {
      source_doc_type: "shipment",
      source_doc_id: shipmentId,
      kind: "packaging",
      from_location_id: TRANSIT_TO_FACTORY,
      to_location_id: FACTORY_LOCATION_ID,
    },
    select: { id: true },
  });
  if (existing) return 0;

  // Движения плеча ОТПРАВКИ (фермер → -1) и его сторно (-1 → фермер при откате).
  const movements = await tx.stockMovement.findMany({
    where: {
      source_doc_type: "shipment",
      source_doc_id: shipmentId,
      kind: "packaging",
      movement_type: "return",
    },
  });

  // Нетто в транзите -1 по типу тары: оригиналы (to=-1) плюс, сторно (from=-1) минус.
  // Фермер на заводской стороне не важен — на завод приходит тара по типам.
  const net = new Map<number, Prisma.Decimal>();
  for (const m of movements) {
    if (m.packaging_type_id == null) continue;
    let delta: Prisma.Decimal | null = null;
    if (m.to_location_id === TRANSIT_TO_FACTORY) delta = m.quantity; // оригинал отправки
    else if (m.from_location_id === TRANSIT_TO_FACTORY) delta = m.quantity.neg(); // сторно
    if (delta == null) continue;
    net.set(
      m.packaging_type_id,
      (net.get(m.packaging_type_id) ?? new Prisma.Decimal(0)).plus(delta),
    );
  }

  const toCreate = [...net.entries()].filter(([, qty]) => qty.gt(0));
  if (toCreate.length === 0) return 0;

  await tx.stockMovement.createMany({
    data: toCreate.map(([packagingTypeId, qty]) => ({
      date: new Date(),
      kind: "packaging" as const,
      packaging_type_id: packagingTypeId,
      quantity: qty,
      from_location_id: TRANSIT_TO_FACTORY,
      to_location_id: FACTORY_LOCATION_ID,
      from_state: "good" as const,
      to_state: "good" as const,
      movement_type: "return" as const,
      source_doc_type: "shipment" as const,
      source_doc_id: shipmentId,
    })),
  });

  return toCreate.length;
}
