import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth/session";
import { getContractExecution } from "@/server/contracts/execution";
import {
  cultureItemSelect,
  toCultureItems,
  type CultureItemFull,
} from "@/server/analytics/culture-items";
import { getSeasonAcceptedKg } from "@/server/analytics/season-total";
import { seasonYearOf, todayLocalISO } from "@/server/shipments/workdays";
import { resolveSettlementPeriod } from "./settlement-period";
import {
  buildFarmerAnalytics,
  type AnalyticsCultureInput,
  type FarmerAnalytics,
} from "./analytics-agg";

// Загрузчик вкладки «Аналитика» карточки поставщика (темп, прогноз машин, ритм, доля).
// НЕ "use server": это read-загрузчик для серверного компонента, не Server Action.
//
// В этом файле НЕТ арифметики — только выборки, фильтр сезона, маппинг и вызов ядра
// (./analytics-agg). Выполнение по контрактам НЕ пересчитывается: строки приходят готовыми
// из getContractExecution, поэтому плитка «Выполнение» сходится с вкладкой «Контракты»
// (обе смотрят на один и тот же exec.lines).
//
// ⚠ ПОЧЕМУ НЕ getCultureAnalytics В ЦИКЛЕ ПО КУЛЬТУРАМ — та же причина, что у «Качества»:
// он рассчитан на ОДНУ культуру и делает 5+ выборок, включая скан всех позиций сезона.
// Здесь — семь запросов в двух round-trip'ах, из них выборок позиций три: лёгкая по фермеру
// (какие у него культуры), ОДНА общая по этим культурам (его позиции + база долей) и общий
// знаменатель сезона, который тем же кодом считает профиль культуры.
//
// ⚠ Индексов на ShipmentItem.farmer_id / .culture_id в схеме нет, поэтому фермер- и
// культура-скоупные выборки идут seq scan'ом (так же живут card.ts, settlement.ts,
// execution.ts). Схему здесь не трогаем; если сезон вырастет — это первый кандидат на
// индекс отдельной задачей с миграцией.

export type { FarmerAnalytics } from "./analytics-agg";

export async function getFarmerAnalytics(params: {
  farmerId: number;
  season: number;
  period?: string;
  from?: string;
  to?: string;
}): Promise<FarmerAnalytics | null> {
  // Гард чтения — как в getFarmerCard/getFarmerSettlement/getFarmerQuality: достаточно факта
  // аутентификации. Расходиться в RBAC внутри одной карточки нельзя.
  await requireRole();

  const generatedAt = todayLocalISO();
  // Тот же разбор периода, что на «Расчётах»: битое значение молча падает в сезон.
  const period = resolveSettlementPeriod({
    period: params.period,
    from: params.from,
    to: params.to,
    season: params.season,
    today: generatedAt,
  });

  const [farmer, ownItems, exec, norms, seasonTotalKg] = await Promise.all([
    prisma.farmer.findUnique({
      where: { id: params.farmerId },
      select: { id: true, name: true },
    }),
    // Лёгкая выборка ТОЛЬКО его позиций: даёт список культур сезона и «из N поставок».
    prisma.shipmentItem.findMany({
      where: { farmer_id: params.farmerId },
      select: {
        culture_id: true,
        acceptanceAct: { select: { id: true } },
        shipment: { select: { arrival_date: true, departure_date: true } },
      },
    }),
    // ЕДИНСТВЕННЫЙ источник выполнения — второй реализации не заводим.
    getContractExecution({ farmerId: params.farmerId, season: params.season }),
    // Норма рейса — пара фермер×культура, сезона у неё нет.
    prisma.tripWeightNorm.findMany({
      where: { farmer_id: params.farmerId },
      select: { culture_id: true, planned_trip_weight_kg: true },
    }),
    // Знаменатель «доли в сезоне» — общий с профилем культуры (server/analytics/season-total).
    getSeasonAcceptedKg(params.season),
  ]);

  if (!farmer) return null;

  // Фильтр сезона — по фактической дате (BR-17: прибытие, при его отсутствии отправление),
  // как в getContractExecution и на расчётном листе.
  const inSeason = ownItems.filter((it) => {
    const d = it.shipment.arrival_date ?? it.shipment.departure_date;
    return d != null && seasonYearOf(d) === params.season;
  });
  const positionsTotal = inSeason.length;

  const withActs = new Set(
    inSeason.filter((it) => it.acceptanceAct != null).map((it) => it.culture_id),
  );
  // Культура со строкой контракта, но без актов, обязана попасть в таблицу прогноза —
  // иначе «начало сезона» выглядит как отсутствие плана, а не как отсутствие приёмок.
  const linesByCulture = new Map<number, AnalyticsCultureInput["lines"]>();
  for (const l of exec.lines) {
    const cur = linesByCulture.get(l.cultureId) ?? [];
    cur.push({
      lineId: l.lineId,
      volumeTons: l.volumeTons,
      acceptedKg: l.acceptedKg,
      targetKg: l.targetKg,
    });
    linesByCulture.set(l.cultureId, cur);
  }

  const normByCulture = new Map(
    norms.map((n) => [n.culture_id, n.planned_trip_weight_kg.toNumber()]),
  );

  const cultureIds = [...new Set([...withActs, ...linesByCulture.keys()])];

  const common = {
    farmer,
    season: params.season,
    generatedAt,
    period,
    positionsTotal,
    seasonTotalKg,
  };

  if (cultureIds.length === 0) {
    return buildFarmerAnalytics({ ...common, cultures: [] });
  }

  const [rawItems, cultureRows] = await Promise.all([
    // ОДНА выборка позиций по всем культурам фермера — и его, и остальных поставщиков.
    // Фильтр сезона делает маппер в памяти (правило сезона месячное, BR-17, и второй его
    // реализации в WHERE быть не должно).
    prisma.shipmentItem.findMany({
      where: { culture_id: { in: cultureIds }, acceptanceAct: { isNot: null } },
      select: cultureItemSelect,
    }),
    // Отдельной выборкой: у культуры со строкой контракта и нулём актов строк в rawItems нет.
    prisma.culture.findMany({
      where: { id: { in: cultureIds } },
      select: { id: true, name: true, color: true },
    }),
  ]);

  const itemsByCulture = new Map<number, CultureItemFull[]>();
  for (const i of toCultureItems(rawItems, params.season)) {
    const cur = itemsByCulture.get(i.cultureId);
    if (cur) cur.push(i);
    else itemsByCulture.set(i.cultureId, [i]);
  }

  const cultures: AnalyticsCultureInput[] = cultureRows.map((c) => ({
    culture: { id: c.id, name: c.name, color: c.color },
    items: itemsByCulture.get(c.id) ?? [],
    lines: linesByCulture.get(c.id) ?? [],
    planTripKg: normByCulture.get(c.id) ?? null,
  }));

  return buildFarmerAnalytics({ ...common, cultures });
}
