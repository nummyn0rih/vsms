import { prisma } from "@/lib/prisma";
import { stripSeasonPrefix } from "@/server/acceptance/accepted";
import { requireRole } from "@/server/auth/session";
import { seasonYearOf, todayLocalISO } from "@/server/shipments/workdays";
import {
  buildSettlementSheet,
  resolveSettlementPeriod,
  type FarmerSettlement,
  type SheetItem,
  type SheetLine,
} from "./settlement-agg";

// Загрузчик расчётного листа по фермеру (вкладка «Расчёты» карточки поставщика).
// НЕ "use server": это read-загрузчик для серверного компонента, не Server Action.
//
// В этом файле НЕТ арифметики — только выборка, фильтр сезона и маппинг в DTO ядра
// (./settlement-agg). Все величины считает ядро теми же функциями, что и карточка
// контракта, поэтому за сезон лист сходится с ней в ноль.
//
// Почему отдельный загрузчик, а не расширение getFarmerCard: лист считается ЛЕНИВО,
// только когда открыта вкладка ?tab=settlement (карточка грузится и без неё), и
// зависит от периода из URL, которого у card.ts нет.

export type { FarmerSettlement } from "./settlement-agg";

export async function getFarmerSettlement(params: {
  farmerId: number;
  season: number;
  period?: string;
  from?: string;
  to?: string;
}): Promise<FarmerSettlement | null> {
  // Гард чтения — как в getFarmerCard: достаточно факта аутентификации. Деньги уже
  // видны всем ролям на вкладке «Контракты», расходиться в RBAC внутри одной карточки нельзя.
  await requireRole();

  const [farmer, contracts, rawItems] = await Promise.all([
    prisma.farmer.findUnique({ where: { id: params.farmerId }, select: { id: true, name: true } }),
    prisma.contract.findMany({
      where: { farmer_id: params.farmerId, season_year: params.season },
      include: {
        lines: {
          include: { culture: { select: { id: true, name: true, color: true } } },
          orderBy: { id: "asc" },
        },
      },
    }),
    // Фильтра acceptanceAct НЕТ намеренно: позиции без акта нужны листу как блок
    // «ожидают приёмки» (иначе машина, видимая на вкладке «Отгрузки», молча исчезает).
    // shipment.code не берём — № машины на листе не показывается.
    prisma.shipmentItem.findMany({
      where: { farmer_id: params.farmerId },
      select: {
        id: true,
        planned_weight_kg: true,
        actual_weight_kg: true,
        contract_line_id: true,
        culture: { select: { name: true, color: true } },
        shipment: {
          select: { status: true, arrival_date: true, departure_date: true },
        },
        acceptanceAct: {
          select: {
            act_number: true,
            brak_percent: true,
            settlement_percent: true, // BR-33: корректировка расчёта (только деньги)
            calibreResults: {
              select: {
                percent: true,
                contract_line_id: true,
                calibreRange: { select: { is_accepted: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  if (!farmer) return null;

  const lines: SheetLine[] = contracts.flatMap((c) =>
    c.lines.map((l) => ({
      lineId: l.id,
      contractId: c.id,
      cultureId: l.culture.id,
      cultureName: l.culture.name,
      color: l.culture.color,
      label: l.label ?? "",
      volumeTons: l.volume_tons,
      price: l.price_per_kg,
    })),
  );

  // Фильтр сезона — слово-в-слово как в getContractExecution (BR-17, по фактической
  // дате: прибытие, при его отсутствии — отправление). Отступать нельзя: разойдётся
  // с карточкой контракта.
  const items: SheetItem[] = [];
  for (const it of rawItems) {
    const refDate = it.shipment.arrival_date ?? it.shipment.departure_date;
    if (seasonYearOf(refDate ?? new Date()) !== params.season) continue;

    const act = it.acceptanceAct;
    items.push({
      itemId: it.id,
      // № акта хранится с префиксом сезона (BR-9) — показываем введённую часть.
      actNumber: act ? stripSeasonPrefix(act.act_number, params.season) : null,
      date: refDate ? refDate.toISOString().slice(0, 10) : null,
      cultureName: it.culture.name,
      color: it.culture.color,
      status: it.shipment.status,
      plannedKg: it.planned_weight_kg.toNumber(),
      exec: act
        ? {
            actualKg: it.actual_weight_kg,
            brakPercent: act.brak_percent?.toNumber() ?? null,
            contractLineId: it.contract_line_id,
            settlementPercent: act.settlement_percent?.toNumber() ?? null,
            calibres: act.calibreResults.map((cr) => ({
              percent: cr.percent.toNumber(),
              isAccepted: cr.calibreRange.is_accepted,
              contractLineId: cr.contract_line_id,
            })),
          }
        : null,
    });
  }

  const today = todayLocalISO();
  return buildSettlementSheet({
    farmer,
    season: params.season,
    period: resolveSettlementPeriod({
      period: params.period,
      from: params.from,
      to: params.to,
      season: params.season,
      today,
    }),
    lines,
    items,
    generatedAt: today,
  });
}
