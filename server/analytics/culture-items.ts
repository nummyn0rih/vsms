import type { Prisma } from "@/lib/generated/prisma/client";
import { calibreRangeLabel, stripSeasonPrefix } from "@/server/acceptance/accepted";
import { seasonYearOf } from "@/server/shipments/workdays";
import type { CultureItem } from "@/server/analytics/culture-agg";

// Маппинг Prisma-строки позиции-с-актом в DTO ядра аналитики (CultureItem). Вынесен из
// getCultureAnalytics, чтобы ОБА разреза считались из одной выборки и одного маппера:
//   «фермеры внутри культуры» — server/analytics/culture.ts
//   «культуры внутри фермера» — server/farmers/quality.ts
// Второй маппинг тех же полей = гарантированное расхождение чисел между вкладками.

// ЕДИНСТВЕННЫЙ select позиций-с-актом. Оба загрузчика обязаны выбирать одинаковые поля:
// иначе «Принято» и «Брак» на карточке фермера и на профиле культуры разъедутся молча.
// culture_id и act_number нужны только разрезу «Качество» (несколько культур в одной
// выборке + № партии переговорного листа) — скалярные, профилю культуры безразличны.
export const cultureItemSelect = {
  id: true,
  shipment_id: true,
  culture_id: true,
  actual_weight_kg: true,
  farmer: { select: { id: true, name: true } },
  shipment: { select: { arrival_date: true, departure_date: true } },
  acceptanceAct: {
    select: {
      act_number: true,
      brak_percent: true,
      settlement_percent: true, // BR-33: нужен для оплачиваемого веса («К оплате»)
      calibreResults: {
        select: {
          percent: true,
          calibreRange: {
            // id и границы нужны показу: размерный порядок категорий (compareCalibreRanges).
            select: {
              id: true,
              label: true,
              min_cm: true,
              max_cm: true,
              is_accepted: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ShipmentItemSelect;

export type CultureItemRow = Prisma.ShipmentItemGetPayload<{
  select: typeof cultureItemSelect;
}>;

// НАДТИП CultureItem, а не расширение самого CultureItem: фикстуры culture.test.ts и
// scripts/culture-analytics-verify.ts строят CultureItem литералом целиком, и новое
// обязательное поле сломало бы их типизацию. Всё, что нужно переговорному листу партий,
// живёт здесь; ядро профиля культуры этих полей просто не замечает.
export type CultureItemFull = CultureItem & {
  itemId: number;
  cultureId: number;
  actNumber: string | null; // BR-9, уже без префикса сезона (stripSeasonPrefix)
  date: string | null; // фактическая: arrival_date ?? departure_date, ISO YYYY-MM-DD
};

// ⚠ ДВЕ ДАТЫ, НЕ СЛИВАТЬ (поведение перенесено вербатим из getCultureAnalytics):
//   фильтр СЕЗОНА идёт по arrival_date ?? departure_date (BR-17, как в getContractExecution);
//   item.arrival (база НЕДЕЛЬ) — только arrival_date, БЕЗ fallback. Позиция, попавшая в
//   сезон по дате отправления, входит в KPI и доли, но ни в одну неделю графика не идёт.
// ⚠ Decimal конвертируется по truthy-проверке: Decimal(0) даёт null, а не 0. Менять нельзя —
//   разойдётся с профилем культуры.
export function toCultureItems(
  rows: CultureItemRow[],
  season: number,
): CultureItemFull[] {
  const out: CultureItemFull[] = [];
  for (const it of rows) {
    const seasonDate = it.shipment.arrival_date ?? it.shipment.departure_date;
    if (!seasonDate || seasonYearOf(seasonDate) !== season) continue;
    const actualKg = it.actual_weight_kg ? it.actual_weight_kg.toNumber() : null;
    const brakPercent = it.acceptanceAct!.brak_percent
      ? it.acceptanceAct!.brak_percent.toNumber()
      : null;
    const calibres = it.acceptanceAct!.calibreResults.map((cr) => {
      const minCm = cr.calibreRange.min_cm ? cr.calibreRange.min_cm.toNumber() : null;
      const maxCm = cr.calibreRange.max_cm ? cr.calibreRange.max_cm.toNumber() : null;
      return {
        label: calibreRangeLabel(minCm, maxCm, cr.calibreRange.label),
        isAccepted: cr.calibreRange.is_accepted,
        percent: cr.percent.toNumber(),
        minCm,
        maxCm,
        rangeId: cr.calibreRange.id,
      };
    });
    out.push({
      shipmentId: it.shipment_id,
      farmerId: it.farmer.id,
      farmerName: it.farmer.name,
      arrival: it.shipment.arrival_date,
      actualKg,
      brakPercent,
      settlementPercent: it.acceptanceAct!.settlement_percent
        ? it.acceptanceAct!.settlement_percent.toNumber()
        : null,
      calibres,
      itemId: it.id,
      cultureId: it.culture_id,
      actNumber: stripSeasonPrefix(it.acceptanceAct!.act_number, season),
      date: seasonDate.toISOString().slice(0, 10),
    });
  }
  return out;
}
