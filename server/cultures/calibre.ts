import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

import type { CalibreRangeInput } from "./schema";

// Helper персиста схемы калибров. Чистый (без "use server") — вызывается из
// create/updateCulture внутри одной транзакции, чтобы культура и её схема
// сохранялись атомарно (либо обе, либо никак).

// Клиент транзакции Prisma (то, что приходит в $transaction(async (tx) => …)).
type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// Числа диапазона из формы (строки) → строки для Prisma Decimal; "" → null.
// min_cm обязателен после zod-валидации, поэтому тут уже валиден; max_cm пуст =
// открытый верхний диапазон.
export function normalizeRanges(rows: CalibreRangeInput[]) {
  return rows.map((r) => ({
    label: r.label.trim(),
    min_cm: r.min_cm.trim(),
    max_cm: r.max_cm?.trim() ? r.max_cm.trim() : null,
    is_accepted: r.is_accepted,
  }));
}

// Атомарно приводит схему калибров культуры к нужному состоянию.
// Возвращает summary для ChangeLog (BR-16).
export async function persistCalibreScheme(
  tx: Tx,
  cultureId: number,
  acceptanceType: "simple" | "calibre",
  rows: CalibreRangeInput[],
): Promise<string> {
  const existing = await tx.calibreScheme.findUnique({
    where: { culture_id: cultureId },
    select: { id: true },
  });

  // simple → схема не нужна: удаляем (Cascade убирает ranges).
  if (acceptanceType !== "calibre") {
    if (existing) {
      await tx.calibreScheme.delete({ where: { id: existing.id } });
      return "удалена";
    }
    return "нет";
  }

  // calibre → upsert схемы и полная замена набора диапазонов.
  const schemeId =
    existing?.id ??
    (await tx.calibreScheme.create({ data: { culture_id: cultureId } })).id;

  await tx.calibreRange.deleteMany({ where: { scheme_id: schemeId } });

  const data: Prisma.CalibreRangeCreateManyInput[] = normalizeRanges(rows).map(
    (r) => ({
      scheme_id: schemeId,
      label: r.label,
      min_cm: r.min_cm,
      max_cm: r.max_cm,
      is_accepted: r.is_accepted,
    }),
  );
  await tx.calibreRange.createMany({ data });

  return `${data.length} диапазон(ов)`;
}
