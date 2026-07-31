import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth/session";
import { getContractExecution } from "@/server/contracts/execution";
import { calibreRangeLabel, computeAcceptedKg } from "@/server/acceptance/accepted";
import {
  aggregateCultureItems,
  KG_PER_TON,
  type CategoryShare,
  type CultureItem,
} from "@/server/analytics/culture-agg";
import { buildWeekAxis, weekLabel } from "@/server/analytics/dashboard";
import { isoWeek, seasonYearOf, currentSeasonWeek } from "@/server/shipments/workdays";
import { listSeasons } from "@/server/seasons/actions";

export type { CategoryShare, CultureItem };

// Загрузчик профиля одной культуры за сезон (/analytics/culture/[id]). Read-only:
// считает на лету, ничего не пишет. Вся арифметика — в ./culture-agg (prisma-free ядро,
// покрыто culture.test.ts); здесь только выборки, execution и справочники.
//
// «Принято» здесь = скан позиций с актом (включая позиции без contract_line_id), поэтому
// может быть больше, чем бар «Выполнение по культурам» на дашборде (там accepted берётся
// из execution, т.е. только привязанное к строкам). Так KPI сходится с таблицей
// поставщиков и долей в сезоне.

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
    paidTons: number; // оплачиваемый = принятый + доплата BR-33 (база ДЕНЕГ, не тонн)
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
  // ⚠ ТРИ РАЗНЫЕ БАЗЫ ВЕСА В ОДНОЙ СТРОКЕ — НЕ СЛИВАТЬ (DOMAIN §1, BR-33):
  //   acceptedTons — ПРИНЯТЫЙ вес (что завод забрал; база тонн);
  //   paidTons     — ОПЛАЧИВАЕМЫЙ вес = принятый + доплата по корректировке расчёта (база ДЕНЕГ);
  //   targetTons/execPct — ЗАЯВЛЕНО и ВЫПОЛНЕНИЕ по строкам контракта: выполнение считается от
  //                        ПРИНЯТОГО веса, доплата в него не идёт никогда.
  // Без корректировки расчёта paidTons == acceptedTons, и строка выглядит как до BR-33.
  bySupplier: {
    farmerId: number;
    farmerName: string;
    targetTons: number | null; // null = нет строки контракта по этой культуре
    acceptedTons: number;
    paidTons: number;
    execPct: number | null; // null = нет строки контракта по этой культуре
    categoryPct: CategoryShare[]; // все категории калибра + «Брак» (или «Принято» + «Брак»)
    sharePct: number;
  }[];
  categoryPctTotal: CategoryShare[]; // те же доли по культуре целиком — для строки «Итого»
  calibre: CategoryShare[] | null;
  cultures: {
    id: number;
    name: string;
    color: string;
    acceptanceType: "simple" | "calibre";
  }[];
  seasons: { seasonYear: number; isCurrent: boolean }[];
};

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
          settlement_percent: true, // BR-33: нужен для оплачиваемого веса («К оплате»)
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
      settlementPercent: it.acceptanceAct!.settlement_percent
        ? it.acceptanceAct!.settlement_percent.toNumber()
        : null,
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

  // === 5) По поставщикам ===
  // ⚠ ТРИ БАЗЫ ВЕСА В ОДНОЙ СТРОКЕ — источники РАЗНЫЕ, не сливать (DOMAIN §1, BR-33):
  //   «Принято»    — принятый вес из скана позиций культуры (broad, как KPI «Принято»);
  //   «К оплате»   — ОПЛАЧИВАЕМЫЙ вес (принятый + доплата BR-33) по ТЕМ ЖЕ позициям;
  //   «Заявлено»/«Выполнение» — из execution (contract-scoped): выполнение считается от
  //                  ПРИНЯТОГО веса по строкам контракта, доплата в тонны не идёт никогда.
  // Отсюда законное расхождение: «Принято» ≥ принятого в «Выполнении» (в broad попадают
  // позиции без строки контракта), а «К оплате» ≥ «Принято» ровно на доплату.
  const bySupplier = agg.bySupplier.map((s) => {
    const exec = execByFarmer.get(s.farmerId);
    return {
      farmerId: s.farmerId,
      farmerName: s.farmerName,
      targetTons: exec ? exec.targetKg / KG_PER_TON : null,
      acceptedTons: s.acceptedKg / KG_PER_TON,
      paidTons: s.paidKg / KG_PER_TON,
      execPct: exec && exec.targetKg > 0 ? (exec.acceptedKg / exec.targetKg) * 100 : null,
      categoryPct: s.categoryPct,
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
      paidTons: agg.paidKgTotal / KG_PER_TON,
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
    categoryPctTotal: agg.calibre, // тот же расчёт, но нужен и для simple-культур
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
