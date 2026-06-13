import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

import type { ShipmentItemInput } from "./schema";

// Персист позиций отгрузки. Чистый helper (без "use server") — вызывается из
// create/updateShipment внутри одной транзакции (атомарно). Образец — contracts/lines.ts.

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// Доменная ошибка валидации (BR-7). Ловится в action → понятное сообщение.
export class ShipmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShipmentValidationError";
  }
}

function normalizeItem(item: ShipmentItemInput) {
  const lineId = item.contract_line_id?.trim();
  const typeId = item.packaging_type_id?.trim();
  return {
    farmer_id: Number(item.farmer_id),
    culture_id: Number(item.culture_id),
    planned_weight_kg: item.planned_weight_kg.trim().replace(",", "."),
    packaging_type_id: typeId ? Number(typeId) : null,
    contract_line_id: lineId ? Number(lineId) : null,
  };
}

// BR-7: ShipmentItem можно привязать только к строке ТОЙ ЖЕ культуры и ТОГО ЖЕ
// фермера. Блокирующая серверная валидация (не доверяем фильтрации в UI).
async function assertContractLines(
  tx: Tx,
  items: ReturnType<typeof normalizeItem>[],
): Promise<void> {
  const lineIds = [
    ...new Set(items.map((i) => i.contract_line_id).filter((v): v is number => v != null)),
  ];
  if (lineIds.length === 0) return;

  const lines = await tx.contractLine.findMany({
    where: { id: { in: lineIds } },
    include: { contract: { select: { farmer_id: true } } },
  });
  const byId = new Map(lines.map((l) => [l.id, l]));

  for (const item of items) {
    if (item.contract_line_id == null) continue;
    const line = byId.get(item.contract_line_id);
    if (!line) {
      throw new ShipmentValidationError("Строка контракта не найдена");
    }
    if (
      line.culture_id !== item.culture_id ||
      line.contract.farmer_id !== item.farmer_id
    ) {
      throw new ShipmentValidationError(
        "Строка контракта должна быть того же фермера и культуры (BR-7)",
      );
    }
  }
}

// B2.5: тип тары позиции должен соответствовать культуре. Если у культуры есть
// разрешённые типы — packaging_type_id обязателен и должен быть среди них; если
// типов нет (навал) — должен быть null. Блокирующая серверная валидация (как BR-7).
// Норма для тройки может отсутствовать — это НЕ блок на planned (блок только на отправке).
async function assertPackagingTypes(
  tx: Tx,
  items: ReturnType<typeof normalizeItem>[],
): Promise<void> {
  const cultureIds = [...new Set(items.map((i) => i.culture_id))];
  const allowed = await tx.culturePackagingType.findMany({
    where: { culture_id: { in: cultureIds } },
    select: { culture_id: true, packaging_type_id: true },
  });
  const byCulture = new Map<number, Set<number>>();
  for (const a of allowed) {
    const set = byCulture.get(a.culture_id) ?? new Set<number>();
    set.add(a.packaging_type_id);
    byCulture.set(a.culture_id, set);
  }

  for (const item of items) {
    const allowedTypes = byCulture.get(item.culture_id);
    const hasTypes = allowedTypes && allowedTypes.size > 0;

    if (!hasTypes) {
      if (item.packaging_type_id != null) {
        throw new ShipmentValidationError(
          "У культуры нет типов тары — позиция должна быть без тары (навал)",
        );
      }
      continue;
    }
    if (item.packaging_type_id == null) {
      throw new ShipmentValidationError("Выберите тип тары для позиции");
    }
    if (!allowedTypes!.has(item.packaging_type_id)) {
      throw new ShipmentValidationError(
        "Тип тары не разрешён для этой культуры",
      );
    }
  }
}

// Полная замена набора позиций: deleteMany + createMany. Возвращает summary для ChangeLog.
export async function persistShipmentItems(
  tx: Tx,
  shipmentId: number,
  items: ShipmentItemInput[],
): Promise<string> {
  const normalized = items.map(normalizeItem);
  await assertContractLines(tx, normalized);
  await assertPackagingTypes(tx, normalized);

  await tx.shipmentItem.deleteMany({ where: { shipment_id: shipmentId } });

  const data: Prisma.ShipmentItemCreateManyInput[] = normalized.map((n) => ({
    shipment_id: shipmentId,
    farmer_id: n.farmer_id,
    culture_id: n.culture_id,
    planned_weight_kg: n.planned_weight_kg,
    packaging_type_id: n.packaging_type_id,
    contract_line_id: n.contract_line_id,
  }));
  await tx.shipmentItem.createMany({ data });

  return `${data.length} позиц.`;
}
