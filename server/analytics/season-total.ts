import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { computeAcceptedKg } from "@/server/acceptance/accepted";
import { seasonYearOf } from "@/server/shipments/workdays";

// Σ ПРИНЯТОГО ЗА ВЕСЬ СЕЗОН (все культуры, все фермеры) — знаменатель «доли в сезоне».
// Вынесен из getCultureAnalytics (тело перенесено вербатим), потому что тот же знаменатель
// нужен вкладке «Аналитика» карточки поставщика. Второй реализации быть не должно: доля
// фермера в сезоне и доля культуры в сезоне обязаны считаться от ОДНОГО числа, иначе два
// экрана молча разойдутся.
//
// ⚠ Знаменатель НЕ сужается никакими фильтрами экрана (поставщик, культура, период): это
// всегда весь сезон завода. Числитель — забота вызывающего.

export const seasonAcceptedSelect = {
  actual_weight_kg: true,
  shipment: { select: { arrival_date: true, departure_date: true } },
  acceptanceAct: {
    select: {
      brak_percent: true,
      calibreResults: {
        select: { percent: true, calibreRange: { select: { is_accepted: true } } },
      },
    },
  },
} satisfies Prisma.ShipmentItemSelect;

export type SeasonAcceptedRow = Prisma.ShipmentItemGetPayload<{
  select: typeof seasonAcceptedSelect;
}>;

// Чистая часть: фильтр сезона по фактической дате (BR-17 — прибытие, при его отсутствии
// отправление) + computeAcceptedKg. Позиция без перевески даёт 0, а не выпадает.
export function sumSeasonAcceptedKg(rows: SeasonAcceptedRow[], season: number): number {
  let seasonAcceptedKg = 0;
  for (const it of rows) {
    const d = it.shipment.arrival_date ?? it.shipment.departure_date;
    if (!d || seasonYearOf(d) !== season) continue;
    const acc = computeAcceptedKg(
      it.actual_weight_kg ? it.actual_weight_kg.toNumber() : null,
      it.acceptanceAct!.brak_percent ? it.acceptanceAct!.brak_percent.toNumber() : null,
      it.acceptanceAct!.calibreResults.map((cr) => ({
        percent: cr.percent.toNumber(),
        isAccepted: cr.calibreRange.is_accepted,
      })),
    );
    seasonAcceptedKg += acc ?? 0;
  }
  return seasonAcceptedKg;
}

// Выборка + сумма. Фильтр сезона делается в памяти, а не в WHERE: правило сезона месячное
// (BR-17), и второй его реализации в SQL заводить нельзя.
export async function getSeasonAcceptedKg(season: number): Promise<number> {
  const rows = await prisma.shipmentItem.findMany({
    where: { acceptanceAct: { isNot: null } },
    select: seasonAcceptedSelect,
  });
  return sumSeasonAcceptedKg(rows, season);
}
