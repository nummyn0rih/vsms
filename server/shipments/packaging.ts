import { Prisma } from "@/lib/generated/prisma/client";
import type { PrismaClient } from "@/lib/generated/prisma/client";

// Расчёт плановой потребности тары по позиции отгрузки (BR-3). Чистый модуль БЕЗ
// "use server" — переиспользуется в sendShipment (запись движений), previewShipmentTare
// (предпросмотр в UI) и далее в B3 (инфо-показ в ленте). Decimal-математика Prisma.

// Завод — фиксированная локация id=0 (DOMAIN §3, правило 1). Не FK, литерал.
export const FACTORY_LOCATION_ID = 0;

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
// Используют sendShipment и previewShipmentTare.
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
