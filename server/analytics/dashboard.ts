import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth/session";
import { getContractExecution } from "@/server/contracts/execution";
import { computeAcceptedKg, computeWeightedBrak } from "@/server/acceptance/accepted";
import {
  seasonYearOf,
  isoWeek,
  isoWeekRange,
  currentSeasonWeek,
} from "@/server/shipments/workdays";
import { listSeasons } from "@/server/seasons/actions";

// Дашборд сезона (/analytics). Read-only агрегатор: считает на лету, ничего не пишет.
// Формулы принятого/выполнения/брака НЕ дублируются — reuse getContractExecution +
// computeAcceptedKg. Один вызов getSeasonAnalytics({season}) наполняет весь экран.

const KG_PER_TON = 1000;

export type SeasonAnalytics = {
  season: number;
  kpi: {
    acceptedTons: number;
    targetTons: number;
    completionPct: number | null; // null = нет плана (Σ target = 0)
    avgBrakPct: number | null; // null = нет завершённых актов
    tripsTotal: number;
    tripsVeg: number;
    tripsMaterial: number;
    remainingMachines: number | null; // null = недобора нет / нет базы рейса
    remainingTons: number | null;
    avgActualTripWeightT: number | null; // факт средний вес рейса (null = нет взвешенных)
    plannedTripWeightT: number | null; // план из норм (fallback базы оценки)
  };
  completionByCulture: {
    cultureId: number;
    cultureName: string;
    color: string;
    acceptedTons: number;
    targetTons: number;
    pct: number;
  }[];
  acceptanceByWeek: { isoYear: number; isoWeek: number; label: string; tons: number }[];
  brakByCulture: {
    cultureId: number;
    cultureName: string;
    color: string;
    pct: number;
  }[];
  tripsByTc: { tcName: string; veg: number; material: number }[];
  seasons: { seasonYear: number; isCurrent: boolean }[];
};

function weekLabel(week: number): string {
  return `W${String(week).padStart(2, "0")}`;
}

// Средний фактический вес овощного рейса за сезон (BR-14, §5). Вход — по одной записи
// на овощную машину (arrived/accepted, уже отфильтрованную по сезону): список
// actual_weight_kg её позиций (null = не взвешена). Позиции без факта не считаются нулём;
// машина исключается целиком, только если факта нет ни у одной позиции. Чистая — тестируема.
export function aggregateActualTripWeight(
  trips: { itemActualsKg: (number | null)[] }[],
): { avgActualTripWeightT: number | null; weighedTripsCount: number } {
  let sumKg = 0;
  let count = 0;
  for (const t of trips) {
    const weighed = t.itemActualsKg.filter((w): w is number => w != null);
    if (weighed.length === 0) continue; // машина без перевески — исключаем
    sumKg += weighed.reduce((s, w) => s + w, 0); // tripWeight = Σ факт позиций
    count += 1;
  }
  return {
    avgActualTripWeightT: count > 0 ? sumKg / count / KG_PER_TON : null,
    weighedTripsCount: count,
  };
}

// Следующая ISO-неделя (через дату — корректно на границе года).
function nextIsoWeek(isoYear: number, week: number): { isoYear: number; isoWeek: number } {
  const { start } = isoWeekRange(isoYear, week);
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + 7);
  return isoWeek(d);
}

export async function getSeasonAnalytics({
  season,
}: {
  season: number;
}): Promise<SeasonAnalytics> {
  // Чтение — как остальные загрузчики (любая аутентифицированная роль).
  await requireRole("admin", "operator", "user");

  // === 1) Выполнение по контрактам (единый источник для KPI + графика) ===
  // getContractExecution({season}) БЕЗ farmerId работает неверно (accepted скоупится
  // на contracts[0].farmer_id). Поэтому: список фермеров с контрактом в сезоне →
  // вызов по каждому → мерж строк. Формулы reuse 100%.
  const farmersWithContract = await prisma.contract.findMany({
    where: { season_year: season },
    select: { farmer_id: true },
    distinct: ["farmer_id"],
  });

  type CultureAgg = {
    cultureId: number;
    cultureName: string;
    color: string;
    acceptedKg: number;
    targetKg: number;
  };
  const byCulture = new Map<number, CultureAgg>();

  for (const { farmer_id } of farmersWithContract) {
    const exec = await getContractExecution({ farmerId: farmer_id, season });
    for (const line of exec.lines) {
      const agg = byCulture.get(line.cultureId) ?? {
        cultureId: line.cultureId,
        cultureName: line.cultureName,
        color: line.color,
        acceptedKg: 0,
        targetKg: 0,
      };
      agg.acceptedKg += line.acceptedKg;
      agg.targetKg += line.targetKg;
      byCulture.set(line.cultureId, agg);
    }
  }

  const totalAcceptedKg = [...byCulture.values()].reduce((s, c) => s + c.acceptedKg, 0);
  const totalTargetKg = [...byCulture.values()].reduce((s, c) => s + c.targetKg, 0);

  const completionByCulture = [...byCulture.values()]
    .map((c) => ({
      cultureId: c.cultureId,
      cultureName: c.cultureName,
      color: c.color,
      acceptedTons: c.acceptedKg / KG_PER_TON,
      targetTons: c.targetKg / KG_PER_TON,
      pct: c.targetKg > 0 ? (c.acceptedKg / c.targetKg) * 100 : 0,
    }))
    .sort((a, b) => b.targetTons - a.targetTons || a.cultureName.localeCompare(b.cultureName));

  // === 2) Принятые позиции сезона — ОДНА выборка для динамики + брака ===
  const acceptedItems = await prisma.shipmentItem.findMany({
    where: { acceptanceAct: { isNot: null } },
    select: {
      actual_weight_kg: true,
      culture: { select: { id: true, name: true, color: true } },
      shipment: { select: { arrival_date: true, departure_date: true } },
      acceptanceAct: {
        select: {
          brak_percent: true,
          calibreResults: {
            select: {
              percent: true,
              calibreRange: { select: { is_accepted: true } },
            },
          },
        },
      },
    },
  });

  // acceptanceByWeek: Σ принятого (эффективного) веса по ISO-неделе прибытия.
  const weekTons = new Map<string, { isoYear: number; isoWeek: number; tons: number }>();
  // brakByCulture: Σ(actual×brak%) / Σ actual по культуре (база — факт, BR-10/§5).
  // Копим строки {actualKg, brakPercent}; % считает общая computeWeightedBrak.
  const brakAgg = new Map<
    number,
    { cultureName: string; color: string; rows: { actualKg: number; brakPercent: number }[] }
  >();

  for (const it of acceptedItems) {
    const arrival = it.shipment.arrival_date ?? it.shipment.departure_date;
    if (!arrival) continue;
    if (seasonYearOf(arrival) !== season) continue;

    const actual = it.actual_weight_kg ? it.actual_weight_kg.toNumber() : null;
    const brakPct = it.acceptanceAct!.brak_percent
      ? it.acceptanceAct!.brak_percent.toNumber()
      : null;
    const calibres = it.acceptanceAct!.calibreResults.map((cr) => ({
      percent: cr.percent.toNumber(),
      isAccepted: cr.calibreRange.is_accepted,
    }));

    // Динамика — по принятому (эффективному) весу (та же формула, что выполнение).
    const acceptedKg = computeAcceptedKg(actual, brakPct, calibres);
    if (acceptedKg != null && it.shipment.arrival_date) {
      const w = isoWeek(it.shipment.arrival_date);
      const key = `${w.isoYear}-${w.isoWeek}`;
      const cur = weekTons.get(key) ?? { isoYear: w.isoYear, isoWeek: w.isoWeek, tons: 0 };
      cur.tons += acceptedKg / KG_PER_TON;
      weekTons.set(key, cur);
    }

    // Брак — взвешенный по фактическому весу (brak_percent из акта, §5).
    if (actual != null) {
      const bp = brakPct ?? 0;
      const agg = brakAgg.get(it.culture.id) ?? {
        cultureName: it.culture.name,
        color: it.culture.color,
        rows: [],
      };
      agg.rows.push({ actualKg: actual, brakPercent: bp });
      brakAgg.set(it.culture.id, agg);
    }
  }

  // Заполнить дырки недель нулём (сплошная ось между min..max).
  const acceptanceByWeek: SeasonAnalytics["acceptanceByWeek"] = [];
  if (weekTons.size > 0) {
    const present = [...weekTons.values()].sort(
      (a, b) => a.isoYear - b.isoYear || a.isoWeek - b.isoWeek,
    );
    let cur = { isoYear: present[0].isoYear, isoWeek: present[0].isoWeek };
    const last = present[present.length - 1];
    // защитный предел итераций (сезон ≤ ~60 недель)
    for (let guard = 0; guard < 70; guard++) {
      const key = `${cur.isoYear}-${cur.isoWeek}`;
      const hit = weekTons.get(key);
      acceptanceByWeek.push({
        isoYear: cur.isoYear,
        isoWeek: cur.isoWeek,
        label: weekLabel(cur.isoWeek),
        tons: hit ? hit.tons : 0,
      });
      if (cur.isoYear === last.isoYear && cur.isoWeek === last.isoWeek) break;
      cur = nextIsoWeek(cur.isoYear, cur.isoWeek);
    }
  }

  const brakByCulture = [...brakAgg.entries()]
    .map(([cultureId, a]) => ({
      cultureId,
      cultureName: a.cultureName,
      color: a.color,
      pct: computeWeightedBrak(a.rows),
    }))
    .sort((a, b) => b.pct - a.pct);

  // Total — та же формула; null при пустом наборе (Σ факт = 0) сохраняем для показа.
  const allBrakRows = [...brakAgg.values()].flatMap((a) => a.rows);
  const totalBrakActual = allBrakRows.reduce((s, r) => s + r.actualKg, 0);
  const avgBrakPct = totalBrakActual > 0 ? computeWeightedBrak(allBrakRows) : null;

  // === 3) Рейсы ТК (BR-14): овощные и материальные РАЗДЕЛЬНО ===
  // Овощные: Shipment в arrived/accepted, сезон по прибытию, ТК через driver.
  const vegShipments = await prisma.shipment.findMany({
    where: { status: { in: ["arrived", "accepted"] } },
    select: {
      arrival_date: true,
      departure_date: true,
      driver: { select: { transportCompany: { select: { name: true } } } },
      items: { select: { actual_weight_kg: true } }, // + для факт. веса рейса
    },
  });
  // Материальные: MaterialShipment с завода (source_farmer_id=null, исключаем
  // фермер→фермер, BR-14) и хотя бы одной прибывшей позицией (доставлен).
  const matShipments = await prisma.materialShipment.findMany({
    where: {
      source_farmer_id: null,
      items: { some: { arrived_at: { not: null } } },
    },
    select: {
      arrival_date: true,
      departure_date: true,
      driver: { select: { transportCompany: { select: { name: true } } } },
    },
  });

  const tcMap = new Map<string, { veg: number; material: number }>();
  let tripsVeg = 0;
  let tripsMaterial = 0;
  // Вход для факт. среднего веса рейса — только овощные, прошедшие фильтр сезона (BR-14).
  const vegTripsForWeight: { itemActualsKg: (number | null)[] }[] = [];

  for (const s of vegShipments) {
    const arrival = s.arrival_date ?? s.departure_date;
    if (!arrival || seasonYearOf(arrival) !== season) continue;
    vegTripsForWeight.push({
      itemActualsKg: s.items.map((it) =>
        it.actual_weight_kg ? it.actual_weight_kg.toNumber() : null,
      ),
    });
    const name = s.driver?.transportCompany.name;
    if (!name) continue;
    const e = tcMap.get(name) ?? { veg: 0, material: 0 };
    e.veg += 1;
    tcMap.set(name, e);
    tripsVeg += 1;
  }
  for (const s of matShipments) {
    const arrival = s.arrival_date ?? s.departure_date;
    if (!arrival || seasonYearOf(arrival) !== season) continue;
    const name = s.driver.transportCompany.name;
    if (!name) continue;
    const e = tcMap.get(name) ?? { veg: 0, material: 0 };
    e.material += 1;
    tcMap.set(name, e);
    tripsMaterial += 1;
  }

  const tripsByTc = [...tcMap.entries()]
    .map(([tcName, v]) => ({ tcName, veg: v.veg, material: v.material }))
    .sort((a, b) => b.veg + b.material - (a.veg + a.material));

  // === 4) Осталось ~N машин (§5): (target − accepted) / вес рейса ===
  // База оценки — факт средний вес рейса, если есть взвешенные рейсы; иначе плановая
  // норма (fallback). Материальные рейсы в среднее НЕ входят (BR-14).
  const { avgActualTripWeightT, weighedTripsCount } =
    aggregateActualTripWeight(vegTripsForWeight);

  const norms = await prisma.tripWeightNorm.findMany({
    select: { planned_trip_weight_kg: true },
  });
  const plannedTripWeightKg =
    norms.length > 0
      ? norms.reduce((s, n) => s + n.planned_trip_weight_kg.toNumber(), 0) / norms.length
      : null;

  const baseTripWeightKg =
    weighedTripsCount > 0 && avgActualTripWeightT != null
      ? avgActualTripWeightT * KG_PER_TON
      : plannedTripWeightKg;

  const remainingKg = totalTargetKg - totalAcceptedKg;
  const hasRemaining = remainingKg > 0 && baseTripWeightKg != null && baseTripWeightKg > 0;
  const remainingMachines = hasRemaining
    ? Math.ceil(remainingKg / baseTripWeightKg!)
    : null;

  // === 5) Список сезонов для селектора ===
  const configured = await listSeasons();
  const curSeason = currentSeasonWeek().seasonYear;
  const seasons = configured.map((s) => ({
    seasonYear: s.season_year,
    isCurrent: s.season_year === curSeason,
  }));

  return {
    season,
    kpi: {
      acceptedTons: totalAcceptedKg / KG_PER_TON,
      targetTons: totalTargetKg / KG_PER_TON,
      completionPct: totalTargetKg > 0 ? (totalAcceptedKg / totalTargetKg) * 100 : null,
      avgBrakPct,
      tripsTotal: tripsVeg + tripsMaterial,
      tripsVeg,
      tripsMaterial,
      remainingMachines,
      remainingTons: hasRemaining ? remainingKg / KG_PER_TON : null,
      avgActualTripWeightT,
      plannedTripWeightT: plannedTripWeightKg != null ? plannedTripWeightKg / KG_PER_TON : null,
    },
    completionByCulture,
    acceptanceByWeek,
    brakByCulture,
    tripsByTc,
    seasons,
  };
}
