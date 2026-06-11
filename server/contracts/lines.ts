import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

import type { ContractLineInput } from "./schema";

// Helper персиста строк контракта. Чистый (без "use server") — вызывается из
// create/updateContract внутри одной транзакции, чтобы контракт и его строки
// сохранялись атомарно (либо всё, либо ничего). Образец — cultures/calibre.ts.

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// Decimal-поля держим строкой: нормализуем разделитель (запятая → точка), Prisma
// принимает строку и сохраняет точность. label: "" → null.
function normalizeLine(line: ContractLineInput) {
  const label = line.label?.trim();
  return {
    culture_id: Number(line.culture_id),
    label: label ? label : null,
    volume_tons: line.volume_tons.trim().replace(",", "."),
    price_per_kg: line.price_per_kg.trim().replace(",", "."),
  };
}

// Полная замена набора строк контракта: deleteMany + createMany.
// Если на удаляемую строку есть ShipmentItem/CalibreResult (onDelete: Restrict),
// deleteMany бросит ошибку — ловим в action (понятное сообщение). Сейчас ссылок нет.
// Возвращает summary для ChangeLog (BR-16).
export async function persistContractLines(
  tx: Tx,
  contractId: number,
  lines: ContractLineInput[],
): Promise<string> {
  await tx.contractLine.deleteMany({ where: { contract_id: contractId } });

  const data: Prisma.ContractLineCreateManyInput[] = lines.map((l) => {
    const n = normalizeLine(l);
    return {
      contract_id: contractId,
      culture_id: n.culture_id,
      label: n.label,
      volume_tons: n.volume_tons,
      price_per_kg: n.price_per_kg,
    };
  });
  await tx.contractLine.createMany({ data });

  return `${data.length} строк(а)`;
}
