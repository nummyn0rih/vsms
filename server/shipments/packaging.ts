import { Prisma } from "@/lib/generated/prisma/client";
import type { PackagingKind, PrismaClient } from "@/lib/generated/prisma/client";

// Расчёт плановой потребности тары по позиции отгрузки (BR-3). Чистый модуль БЕЗ
// "use server" — переиспользуется в sendShipment (запись движений), previewShipmentTare
// (предпросмотр в UI) и далее в B3 (инфо-показ в ленте). Decimal-математика Prisma.

// Завод — фиксированная локация id=0 (DOMAIN §3, правило 1). Не FK, литерал.
export const FACTORY_LOCATION_ID = 0;

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

type PackagingTypeLite = {
  id: number;
  name: string;
  kind: PackagingKind;
  capacity_kg: Prisma.Decimal | null;
};

// Три исхода расчёта (см. план: дискриминированный возврат вместо throw, чтобы
// sendShipment мог собрать ВСЕ пары без нормы за один проход):
// - none         — у культуры нет тары (навал), движение не создаётся (легально);
// - ok           — посчитано, units целое (ceil);
// - missing_norm — box без записи PackagingNorm, расчёт невозможен → ошибка.
export type PackagingCalc =
  | { status: "none" }
  | { status: "ok"; packagingTypeId: number; units: number }
  | { status: "missing_norm" };

export function calcPackagingUnits(
  plannedWeightKg: Prisma.Decimal,
  packagingType: PackagingTypeLite | null,
  packagingNorm?: { avg_unit_weight_kg: Prisma.Decimal } | null,
): PackagingCalc {
  // Навал: у культуры не задан тип тары — тары нет, это легально.
  if (!packagingType) return { status: "none" };

  // Бочка: делим на ёмкость бочки, норма по фермеру не нужна.
  if (packagingType.kind === "barrel") {
    const capacity = packagingType.capacity_kg;
    // Бочка без ёмкости — данные битые, считать нечем (на практике не должно быть).
    if (!capacity || capacity.lte(0)) return { status: "missing_norm" };
    return {
      status: "ok",
      packagingTypeId: packagingType.id,
      units: plannedWeightKg.div(capacity).ceil().toNumber(),
    };
  }

  // Ящик: делим на средний вес единицы тары из нормы (фермер × культура).
  if (!packagingNorm) return { status: "missing_norm" };
  return {
    status: "ok",
    packagingTypeId: packagingType.id,
    units: plannedWeightKg.div(packagingNorm.avg_unit_weight_kg).ceil().toNumber(),
  };
}

// Позиция в минимальном объёме, нужном расчёту тары.
type ItemLite = { farmer_id: number; culture_id: number };

export type PackagingContext = {
  // Тип тары культуры (null = навал). Ключ — culture_id.
  packagingByCulture: Map<number, PackagingTypeLite | null>;
  // Норма ящика по паре. Ключ — `${farmer_id}:${culture_id}`.
  normByPair: Map<string, { avg_unit_weight_kg: Prisma.Decimal }>;
};

export function pairKey(farmerId: number, cultureId: number): string {
  return `${farmerId}:${cultureId}`;
}

// Пачкой подтягивает типы тары культур и нормы пар (без N+1). Используют
// sendShipment и previewShipmentTare.
export async function loadPackagingContext(
  tx: Tx,
  items: ItemLite[],
): Promise<PackagingContext> {
  const cultureIds = [...new Set(items.map((i) => i.culture_id))];

  const cultures = await tx.culture.findMany({
    where: { id: { in: cultureIds } },
    select: {
      id: true,
      packagingType: {
        select: { id: true, name: true, kind: true, capacity_kg: true },
      },
    },
  });
  const packagingByCulture = new Map<number, PackagingTypeLite | null>(
    cultures.map((c) => [c.id, c.packagingType ?? null]),
  );

  const norms = await tx.packagingNorm.findMany({
    where: {
      OR: items.map((i) => ({ farmer_id: i.farmer_id, culture_id: i.culture_id })),
    },
    select: { farmer_id: true, culture_id: true, avg_unit_weight_kg: true },
  });
  const normByPair = new Map(
    norms.map((n) => [
      pairKey(n.farmer_id, n.culture_id),
      { avg_unit_weight_kg: n.avg_unit_weight_kg },
    ]),
  );

  return { packagingByCulture, normByPair };
}
