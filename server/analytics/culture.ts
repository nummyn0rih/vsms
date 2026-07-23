import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth/session";
import { getContractExecution } from "@/server/contracts/execution";
import {
  calibreRangeLabel,
  computeAcceptedKg,
  computeWeightedBrak,
} from "@/server/acceptance/accepted";
import { buildWeekAxis, weekLabel } from "@/server/analytics/dashboard";
import { isoWeek, seasonYearOf, currentSeasonWeek } from "@/server/shipments/workdays";
import { listSeasons } from "@/server/seasons/actions";

// Профиль одной культуры за сезон (/analytics/culture/[id]). Read-only агрегатор:
// считает на лету, ничего не пишет. Формулы принятого/брака/выполнения НЕ дублируются —
// reuse computeAcceptedKg / computeWeightedBrak / getContractExecution.
//
// «Принято» здесь = скан позиций с актом (включая позиции без contract_line_id), поэтому
// может быть больше, чем бар «Выполнение по культурам» на дашборде (там accepted берётся
// из execution, т.е. только привязанное к строкам). Так KPI сходится с таблицей
// поставщиков и долей в сезоне.

const KG_PER_TON = 1000;
const BRAK_LABEL = "Брак"; // синтетическая reject-категория стека калибра (brak_percent акта)

export type CultureAnalytics = {
  season: number;
  culture: {
    id: number;
    name: string;
    color: string;
    acceptanceType: "simple" | "calibre";
  };
  kpi: {
    acceptedTons: number;
    targetTons: number;
    completionPct: number | null; // null = нет плана по культуре (Σ target = 0)
    avgBrakPct: number | null; // null = нет актов с фактическим весом
    positionsCount: number;
    tripsCount: number;
    farmersCount: number;
    seasonSharePct: number | null; // null = в сезоне ничего не принято
  };
  acceptanceByWeek: {
    isoYear: number;
    isoWeek: number;
    label: string;
    tons: number;
    planTons: number | null;
  }[];
  hasPlanLine: boolean;
  brakByWeek: { label: string; pct: number }[];
  bySupplier: {
    farmerId: number;
    farmerName: string;
    acceptedTons: number;
    execPct: number | null; // null = нет строки контракта по этой культуре
    brakPct: number | null; // null = нет фактического веса
    sharePct: number;
  }[];
  calibre: { label: string; isAccepted: boolean; pct: number; tons: number }[] | null;
  cultures: {
    id: number;
    name: string;
    color: string;
    acceptanceType: "simple" | "calibre";
  }[];
  seasons: { seasonYear: number; isCurrent: boolean }[];
};

type BrakRow = { actualKg: number; brakPercent: number };

// computeWeightedBrak возвращает 0 при пустом наборе — для UI нужен «—», поэтому null.
function weightedBrakOrNull(rows: BrakRow[]): number | null {
  const den = rows.reduce((s, r) => s + r.actualKg, 0);
  return den > 0 ? computeWeightedBrak(rows) : null;
}

// Принятая позиция культуры (загрузчик маппит из Prisma-результата). Чистое DTO —
// агрегатор ниже тестируется без сессии/БД.
export type CultureItem = {
  shipmentId: number;
  farmerId: number;
  farmerName: string;
  arrival: Date | null; // дата прибытия (недели строятся по ней)
  actualKg: number | null;
  brakPercent: number | null;
  calibres: { label: string; isAccepted: boolean; percent: number }[];
};

export type CultureItemsAggregate = {
  acceptedKgTotal: number;
  avgBrakPct: number | null;
  positionsCount: number;
  tripsCount: number;
  farmersCount: number;
  weekTons: Map<string, { isoYear: number; isoWeek: number; tons: number }>;
  weekBrakPct: Map<string, { isoYear: number; isoWeek: number; pct: number }>;
  bySupplier: {
    farmerId: number;
    farmerName: string;
    acceptedKg: number;
    brakPct: number | null;
    sharePct: number;
  }[];
  calibre: { label: string; isAccepted: boolean; pct: number; tons: number }[];
};

// Всё, что считается из позиций культуры: объём/брак/недели/поставщики/калибр.
// Формулы — только computeAcceptedKg + computeWeightedBrak, ничего своего.
export function aggregateCultureItems(items: CultureItem[]): CultureItemsAggregate {
  const weekTons = new Map<string, { isoYear: number; isoWeek: number; tons: number }>();
  const weekBrakRows = new Map<
    string,
    { isoYear: number; isoWeek: number; rows: BrakRow[] }
  >();
  const supplierAgg = new Map<
    number,
    { farmerName: string; acceptedKg: number; brakRows: BrakRow[] }
  >();
  const catKg = new Map<string, { isAccepted: boolean; kg: number }>();

  let acceptedKgTotal = 0;
  let actualKgTotal = 0;
  let brakKgTotal = 0; // вес брака (actual×brak%) — ломоть «Брак» в стеке калибра
  const brakRowsAll: BrakRow[] = [];

  for (const i of items) {
    const acceptedKg = computeAcceptedKg(i.actualKg, i.brakPercent, i.calibres) ?? 0;
    acceptedKgTotal += acceptedKg;
    const brakRow: BrakRow | null =
      i.actualKg != null
        ? { actualKg: i.actualKg, brakPercent: i.brakPercent ?? 0 }
        : null;
    if (brakRow) brakRowsAll.push(brakRow);

    // недели — по дате прибытия (позиции без неё в динамику не идут)
    if (i.arrival) {
      const w = isoWeek(i.arrival);
      const key = `${w.isoYear}-${w.isoWeek}`;
      const cur = weekTons.get(key) ?? { isoYear: w.isoYear, isoWeek: w.isoWeek, tons: 0 };
      cur.tons += acceptedKg / KG_PER_TON;
      weekTons.set(key, cur);
      if (brakRow) {
        const b = weekBrakRows.get(key) ?? {
          isoYear: w.isoYear,
          isoWeek: w.isoWeek,
          rows: [],
        };
        b.rows.push(brakRow);
        weekBrakRows.set(key, b);
      }
    }

    const agg = supplierAgg.get(i.farmerId) ?? {
      farmerName: i.farmerName,
      acceptedKg: 0,
      brakRows: [],
    };
    agg.acceptedKg += acceptedKg;
    if (brakRow) agg.brakRows.push(brakRow);
    supplierAgg.set(i.farmerId, agg);

    // калибр: вес категории = actual × percent/100, доля — от Σ факт. веса
    if (i.actualKg != null) {
      actualKgTotal += i.actualKg;
      brakKgTotal += (i.actualKg * (i.brakPercent ?? 0)) / 100;
      for (const c of i.calibres) {
        const cur = catKg.get(c.label) ?? { isAccepted: c.isAccepted, kg: 0 };
        cur.kg += (i.actualKg * c.percent) / 100;
        catKg.set(c.label, cur);
      }
    }
  }

  // Брак — отдельная доля акта (categories + brak = 100), в calibreResults её нет.
  // Добавляем ломтём «не в зачёт», только если он ненулевой (иначе пустая категория).
  if (brakKgTotal > 0) {
    const cur = catKg.get(BRAK_LABEL) ?? { isAccepted: false, kg: 0 };
    cur.kg += brakKgTotal;
    catKg.set(BRAK_LABEL, cur);
  }

  return {
    acceptedKgTotal,
    avgBrakPct: weightedBrakOrNull(brakRowsAll),
    positionsCount: items.length,
    tripsCount: new Set(items.map((i) => i.shipmentId)).size,
    farmersCount: supplierAgg.size,
    weekTons,
    weekBrakPct: new Map(
      [...weekBrakRows].map(([key, b]) => [
        key,
        { isoYear: b.isoYear, isoWeek: b.isoWeek, pct: computeWeightedBrak(b.rows) },
      ]),
    ),
    bySupplier: [...supplierAgg.entries()]
      .map(([farmerId, a]) => ({
        farmerId,
        farmerName: a.farmerName,
        acceptedKg: a.acceptedKg,
        brakPct: weightedBrakOrNull(a.brakRows),
        sharePct: acceptedKgTotal > 0 ? (a.acceptedKg / acceptedKgTotal) * 100 : 0,
      }))
      .sort(
        (a, b) => b.acceptedKg - a.acceptedKg || a.farmerName.localeCompare(b.farmerName),
      ),
    calibre: [...catKg.entries()]
      .map(([label, c]) => ({
        label,
        isAccepted: c.isAccepted,
        pct: actualKgTotal > 0 ? (c.kg / actualKgTotal) * 100 : 0,
        tons: c.kg / KG_PER_TON,
      }))
      // принятые категории первыми (по убыванию доли), «не в зачёт» — в конец
      .sort((a, b) => Number(b.isAccepted) - Number(a.isAccepted) || b.pct - a.pct),
  };
}

export async function getCultureAnalytics({
  season,
  cultureId,
}: {
  season: number;
  cultureId: number;
}): Promise<CultureAnalytics | null> {
  await requireRole("admin", "operator", "user");

  const culture = await prisma.culture.findUnique({
    where: { id: cultureId },
    select: { id: true, name: true, color: true, acceptance_type: true },
  });
  if (!culture) return null;

  // === 1) Принятые позиции культуры — ОДНА выборка для KPI/недель/брака/поставщиков ===
  const rawItems = await prisma.shipmentItem.findMany({
    where: { culture_id: cultureId, acceptanceAct: { isNot: null } },
    select: {
      id: true,
      shipment_id: true,
      actual_weight_kg: true,
      farmer: { select: { id: true, name: true } },
      shipment: { select: { arrival_date: true, departure_date: true } },
      acceptanceAct: {
        select: {
          brak_percent: true,
          calibreResults: {
            select: {
              percent: true,
              calibreRange: {
                select: { label: true, min_cm: true, max_cm: true, is_accepted: true },
              },
            },
          },
        },
      },
    },
  });

  const items: CultureItem[] = [];
  for (const it of rawItems) {
    const seasonDate = it.shipment.arrival_date ?? it.shipment.departure_date;
    if (!seasonDate || seasonYearOf(seasonDate) !== season) continue;
    const actualKg = it.actual_weight_kg ? it.actual_weight_kg.toNumber() : null;
    const brakPercent = it.acceptanceAct!.brak_percent
      ? it.acceptanceAct!.brak_percent.toNumber()
      : null;
    const calibres = it.acceptanceAct!.calibreResults.map((cr) => ({
      label: calibreRangeLabel(
        cr.calibreRange.min_cm ? cr.calibreRange.min_cm.toNumber() : null,
        cr.calibreRange.max_cm ? cr.calibreRange.max_cm.toNumber() : null,
        cr.calibreRange.label,
      ),
      isAccepted: cr.calibreRange.is_accepted,
      percent: cr.percent.toNumber(),
    }));
    items.push({
      shipmentId: it.shipment_id,
      farmerId: it.farmer.id,
      farmerName: it.farmer.name,
      arrival: it.shipment.arrival_date,
      actualKg,
      brakPercent,
      calibres,
    });
  }

  // === 2) Всё, что считается из позиций (объём/брак/недели/поставщики/калибр) ===
  const agg = aggregateCultureItems(items);
  const { acceptedKgTotal, weekTons } = agg;

  // === 3) Плановый темп по неделям (WeeklyPlan культуры в сезоне) ===
  // Дневные строки (date != null) сворачиваем в свою ISO-неделю, недельные берём как есть.
  const planRows = await prisma.weeklyPlan.findMany({
    where: { season_year: season, culture_id: cultureId },
    select: { iso_year: true, iso_week: true, date: true, target_tons: true },
  });
  const planTons = new Map<string, { isoYear: number; isoWeek: number; tons: number }>();
  for (const p of planRows) {
    const w = p.date ? isoWeek(p.date) : { isoYear: p.iso_year, isoWeek: p.iso_week };
    const key = `${w.isoYear}-${w.isoWeek}`;
    const cur = planTons.get(key) ?? { isoYear: w.isoYear, isoWeek: w.isoWeek, tons: 0 };
    cur.tons += p.target_tons.toNumber();
    planTons.set(key, cur);
  }

  // Ось — объединение недель приёмки и недель плана, дырки нулями.
  const axis = buildWeekAxis([...weekTons.values(), ...planTons.values()]);
  const acceptanceByWeek = axis.map((w) => {
    const key = `${w.isoYear}-${w.isoWeek}`;
    return {
      ...w,
      tons: weekTons.get(key)?.tons ?? 0,
      planTons: planTons.get(key)?.tons ?? null,
    };
  });

  const brakByWeek = axis
    .filter((w) => agg.weekBrakPct.has(`${w.isoYear}-${w.isoWeek}`))
    .map((w) => ({
      label: weekLabel(w.isoWeek),
      pct: agg.weekBrakPct.get(`${w.isoYear}-${w.isoWeek}`)!.pct,
    }));

  // === 4) План/выполнение по контрактам (строки ЭТОЙ культуры) ===
  // getContractExecution скоупит accepted на фермера, поэтому идём по фермерам и мержим
  // строки культуры. Сужаем список ДО фермеров, у которых есть строка контракта именно
  // по этой культуре (иначе — десятки лишних тяжёлых вызовов на культуру, где контракт
  // всего у пары фермеров).
  const farmersWithLine = await prisma.contract.findMany({
    where: { season_year: season, lines: { some: { culture_id: cultureId } } },
    select: { farmer_id: true },
    distinct: ["farmer_id"],
  });

  let targetKgTotal = 0;
  let execAcceptedKgTotal = 0; // принято по строкам контракта (scoped) — база «Выполнения»
  const execByFarmer = new Map<number, { acceptedKg: number; targetKg: number }>();
  for (const { farmer_id } of farmersWithLine) {
    const exec = await getContractExecution({ farmerId: farmer_id, season });
    const lines = exec.lines.filter((l) => l.cultureId === cultureId);
    if (lines.length === 0) continue;
    const acc = lines.reduce((s, l) => s + l.acceptedKg, 0);
    const tgt = lines.reduce((s, l) => s + l.targetKg, 0);
    targetKgTotal += tgt;
    execAcceptedKgTotal += acc;
    execByFarmer.set(farmer_id, { acceptedKg: acc, targetKg: tgt });
  }

  // === 5) По поставщикам (объём/брак — из скана позиций, выполнение — из execution) ===
  const bySupplier = agg.bySupplier.map((s) => {
    const exec = execByFarmer.get(s.farmerId);
    return {
      farmerId: s.farmerId,
      farmerName: s.farmerName,
      acceptedTons: s.acceptedKg / KG_PER_TON,
      execPct: exec && exec.targetKg > 0 ? (exec.acceptedKg / exec.targetKg) * 100 : null,
      brakPct: s.brakPct,
      sharePct: s.sharePct,
    };
  });

  // === 6) Доля в сезоне — Σ принятого всех культур (та же формула) ===
  const allItems = await prisma.shipmentItem.findMany({
    where: { acceptanceAct: { isNot: null } },
    select: {
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
    },
  });
  let seasonAcceptedKg = 0;
  for (const it of allItems) {
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

  // === 7) Калибр — доли категорий; null = simple-культура (блок не рендерится) ===
  const calibre = culture.acceptance_type === "calibre" ? agg.calibre : null;

  // === 8) Списки для селекторов ===
  const cultureRows = await prisma.culture.findMany({
    where: { OR: [{ active: true }, { id: cultureId }] },
    select: { id: true, name: true, color: true, acceptance_type: true },
    orderBy: { name: "asc" },
  });
  const configured = await listSeasons();
  const curSeason = currentSeasonWeek().seasonYear;

  return {
    season,
    culture: {
      id: culture.id,
      name: culture.name,
      color: culture.color,
      acceptanceType: culture.acceptance_type,
    },
    kpi: {
      acceptedTons: acceptedKgTotal / KG_PER_TON,
      targetTons: targetKgTotal / KG_PER_TON,
      // Выполнение — contract-scoped база (accepted по строкам / план), чтобы сходилось
      // с execPct поставщиков и дашбордом. acceptedKgTotal (broad) — только для «Принято».
      completionPct: targetKgTotal > 0 ? (execAcceptedKgTotal / targetKgTotal) * 100 : null,
      avgBrakPct: agg.avgBrakPct,
      positionsCount: agg.positionsCount,
      tripsCount: agg.tripsCount,
      farmersCount: agg.farmersCount,
      seasonSharePct:
        seasonAcceptedKg > 0 ? (acceptedKgTotal / seasonAcceptedKg) * 100 : null,
    },
    acceptanceByWeek,
    hasPlanLine: planTons.size > 0,
    brakByWeek,
    bySupplier,
    calibre,
    cultures: cultureRows.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      acceptanceType: c.acceptance_type,
    })),
    seasons: configured.map((s) => ({
      seasonYear: s.season_year,
      isCurrent: s.season_year === curSeason,
    })),
  };
}
