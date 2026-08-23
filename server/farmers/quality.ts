import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth/session";
import {
  cultureItemSelect,
  toCultureItems,
  type CultureItemFull,
} from "@/server/analytics/culture-items";
import { seasonYearOf, todayLocalISO } from "@/server/shipments/workdays";
import {
  buildFarmerQuality,
  type FarmerQuality,
  type QualityCultureInput,
} from "./quality-agg";

// Загрузчик вкладки «Качество» карточки поставщика (разрез «культуры внутри фермера»).
// НЕ "use server": это read-загрузчик для серверного компонента, не Server Action.
//
// В этом файле НЕТ арифметики — только выборки, фильтр сезона, маппинг и вызов ядра
// (./quality-agg). Величины считает ядро теми же функциями, что профиль культуры,
// поэтому строка культуры сходится с таблицей «По поставщикам» число в число.
//
// ⚠ ПОЧЕМУ НЕ getCultureAnalytics В ЦИКЛЕ ПО КУЛЬТУРАМ: он рассчитан на ОДНУ культуру и
// делает 5+ выборок, включая скан ВСЕХ позиций сезона с актами (culture.ts, «доля в
// сезоне»). У фермера с четырьмя культурами это ~20 запросов и четырёхкратная загрузка
// сезона. Здесь — пять запросов в двух round-trip'ах, из них выборок позиций две:
// лёгкая по фермеру (какие у него культуры) и ОДНА общая по этим культурам, которая даёт
// сразу и его позиции, и позиции остальных поставщиков (базу бенчмарка).

export type { FarmerQuality } from "./quality-agg";

export async function getFarmerQuality(params: {
  farmerId: number;
  season: number;
}): Promise<FarmerQuality | null> {
  // Гард чтения — как в getFarmerCard/getFarmerSettlement: достаточно факта
  // аутентификации. Расходиться в RBAC внутри одной карточки нельзя.
  await requireRole();

  const [farmer, ownItems, contracts] = await Promise.all([
    prisma.farmer.findUnique({
      where: { id: params.farmerId },
      select: { id: true, name: true },
    }),
    // Лёгкая выборка ТОЛЬКО его позиций: даёт список культур с актами и «из N поставок»
    // для KPI. Без неё пришлось бы искать культуры фермера в общей выборке, а её состав
    // как раз от этого списка и зависит.
    prisma.shipmentItem.findMany({
      where: { farmer_id: params.farmerId },
      select: {
        culture_id: true,
        acceptanceAct: { select: { id: true } },
        shipment: { select: { arrival_date: true, departure_date: true } },
      },
    }),
    prisma.contract.findMany({
      where: { farmer_id: params.farmerId, season_year: params.season },
      select: { lines: { select: { culture_id: true, volume_tons: true } } },
    }),
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
  // Культура со строкой контракта, но без актов, обязана попасть в таблицу — иначе
  // «начало сезона» выглядит как отсутствие поставщика, а не как отсутствие приёмок.
  const contractTonsByCulture = new Map<number, number>();
  for (const c of contracts) {
    for (const l of c.lines) {
      contractTonsByCulture.set(
        l.culture_id,
        (contractTonsByCulture.get(l.culture_id) ?? 0) + l.volume_tons.toNumber(),
      );
    }
  }

  const cultureIds = [...new Set([...withActs, ...contractTonsByCulture.keys()])];
  const today = todayLocalISO();

  if (cultureIds.length === 0) {
    return buildFarmerQuality({
      farmer,
      season: params.season,
      generatedAt: today,
      positionsTotal,
      cultures: [],
    });
  }

  const [rawItems, cultureRows] = await Promise.all([
    // ОДНА выборка позиций по всем культурам фермера — и его, и остальных поставщиков.
    // Фильтр сезона делает маппер в памяти (как в getCultureAnalytics), а не SQL: правило
    // сезона — месячное (BR-17), и второй его реализации в WHERE заводить нельзя.
    prisma.shipmentItem.findMany({
      where: { culture_id: { in: cultureIds }, acceptanceAct: { isNot: null } },
      select: cultureItemSelect,
    }),
    // Отдельной выборкой: у культуры со строкой контракта и нулём актов строк в rawItems нет.
    prisma.culture.findMany({
      where: { id: { in: cultureIds } },
      select: { id: true, name: true, color: true, acceptance_type: true },
    }),
  ]);

  const itemsByCulture = new Map<number, CultureItemFull[]>();
  for (const i of toCultureItems(rawItems, params.season)) {
    const cur = itemsByCulture.get(i.cultureId);
    if (cur) cur.push(i);
    else itemsByCulture.set(i.cultureId, [i]);
  }

  const cultures: QualityCultureInput[] = cultureRows.map((c) => ({
    culture: {
      id: c.id,
      name: c.name,
      color: c.color,
      acceptanceType: c.acceptance_type,
    },
    contractTons: contractTonsByCulture.get(c.id) ?? null,
    items: itemsByCulture.get(c.id) ?? [],
  }));

  return buildFarmerQuality({
    farmer,
    season: params.season,
    generatedAt: today,
    positionsTotal,
    cultures,
  });
}
