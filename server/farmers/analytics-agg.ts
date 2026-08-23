import { computeAcceptedKg } from "@/server/acceptance/accepted";
import {
  aggregateCultureItems,
  filterItemsBySuppliers,
  KG_PER_TON,
} from "@/server/analytics/culture-agg";
import type { CultureItemFull } from "@/server/analytics/culture-items";
import {
  aggregateActualTripWeight,
  remainingTripsOf,
} from "@/server/analytics/trip-weight";
// buildWeekAxis сам проставляет подпись недели (weekLabel) — второй раз её не зовём.
import { MIN_WEEKS_FOR_CHART, buildWeekAxis } from "@/server/analytics/week-axis";
import { isoWeek, isoWeekRange, parseDateUTC } from "@/server/shipments/workdays";
import {
  isInPeriod,
  resolveSettlementPeriod,
  type SettlementPeriod,
} from "./settlement-period";

// Чистое ядро вкладки «Аналитика» карточки поставщика — БЕЗ prisma, чтобы считаться
// юнит-тестами без БД и сессии. Загрузчик — рядом, в ./analytics.
//
// Граница со вкладкой «Качество»: та отвечает «какой он поставщик» (сезон целиком),
// эта — «что с ним происходит сейчас и чего ждать» (с периодом).
//
// Формулы НЕ дублируются: принятый вес — computeAcceptedKg, доли — aggregateCultureItems,
// выполнение — уже посчитанные строки getContractExecution, средний вес рейса —
// aggregateActualTripWeight, прогноз машин — remainingTripsOf, порог графика —
// MIN_WEEKS_FOR_CHART. Своей арифметики весов здесь нет.

const DAY_MS = 86_400_000;
/** Сколько последних недель с поставками усредняет вторичный («недавний») темп. */
const RECENT_WEEKS = 4;

// ===== Результат =====

export type AnalyticsRemainingRow = {
  cultureId: number;
  name: string;
  color: string;
  /** Σ volume_tons строк контракта этой культуры; null = строк нет. */
  lineTons: number | null;
  // ⚠ БАЗА ЗАВИСИТ ОТ НАЛИЧИЯ СТРОКИ, и это осознанно:
  //   есть строка  → контрактное принятое (Σ line.acceptedKg) — тогда «Строка − Принято =
  //                  Осталось» сходится глазами, а Σ колонки совпадает с числителем executionPct;
  //   строки нет   → всё принятое по культуре (сравнивать не с чем).
  // Из-за этого колонку НЕЛЬЗЯ суммировать в итог — она не однородна.
  acceptedKg: number;
  /** null без строки контракта; клампится в 0 при перевыполнении. */
  remainingKg: number | null;
  avgTripKg: number | null;
  /** Откуда база прогноза: перевешенные рейсы или TripWeightNorm (DOMAIN §5). */
  avgTripSource: "actual" | "norm" | null;
  trips: number | null;
};

export type AnalyticsWeek = {
  isoYear: number;
  isoWeek: number;
  label: string;
  /** ПРИНЯТЫЙ вес недели (не фактический: фактический — база брака, он на «Качестве»). */
  tons: number;
  /** Принятых рейсов недели; 0 = дырка сплошной оси. */
  trips: number;
  byCulture: { cultureId: number; tons: number }[];
};

export type FarmerAnalytics = {
  farmer: { id: number; name: string };
  season: number;
  generatedAt: string; // todayLocalISO() — НЕ new Date().toISOString()
  period: SettlementPeriod;

  kpi: {
    periodAcceptedKg: number;
    tempTonsPerWeek: number | null;
    executionPct: number | null;
    remainingTrips: number | null;
    avgTripPlanKg: number | null;
    avgTripActualKg: number | null;
  };

  periodMeta: {
    positions: number;
    trips: number;
    tempRecentTonsPerWeek: number | null;
  };

  remaining: AnalyticsRemainingRow[];
  weeks: AnalyticsWeek[];

  rhythm: {
    // Сезонные: вопрос «пропал или нет» не привязан к выбранному окну.
    lastDeliveryDate: string | null;
    lastActNumber: string | null;
    daysSinceLast: number | null;
    medianIntervalDays: number | null;
    intervalsDays: number[];
    // Периодные:
    tripsInPeriod: number;
    tripsPerWeek: number | null;
  };

  share: {
    byCulture: {
      cultureId: number;
      name: string;
      color: string;
      pctOfCulture: number;
      suppliersCount: number;
    }[];
    ownSeasonKg: number;
    seasonPct: number | null;
    seasonTotalKg: number;
  };

  notes: {
    hasContracts: boolean;
    chartReady: boolean;
    periodEmpty: boolean;
    positionsTotal: number;
    nearestWeekWithData?: { label: string; anchor: string; trips: number; tons: number };
  };
};

// ===== Скоуп KPI — В ДАННЫХ, не в вёрстке =====
// «Выполнение 71%» рядом с выбранной неделей читается как результат недели, поэтому
// сезонные плитки обязаны быть подписаны. Карта исчерпывающая: satisfies Record<KpiKey,…>
// не даст добавить KPI и забыть объявить его скоуп — tsc упадёт.

export type KpiKey = keyof FarmerAnalytics["kpi"];
export type KpiScope = "period" | "season";

export const KPI_SCOPE = {
  periodAcceptedKg: "period",
  tempTonsPerWeek: "period",
  executionPct: "season",
  remainingTrips: "season",
  avgTripPlanKg: "season",
  avgTripActualKg: "season",
} as const satisfies Record<KpiKey, KpiScope>;

export const SEASON_SCOPE_HINT = "сезон целиком · не зависит от периода";

// ===== Вход =====

export type AnalyticsCultureInput = {
  culture: { id: number; name: string; color: string };
  /** ВСЕ позиции культуры за сезон — и его, и остальных поставщиков (база доли в культуре). */
  items: CultureItemFull[];
  /** Строки контракта ЭТОЙ культуры из getContractExecution — уже сезонные, уже посчитанные. */
  lines: { lineId: number; volumeTons: number; acceptedKg: number; targetKg: number }[];
  /** TripWeightNorm пары фермер×культура, кг; null = нормы нет. */
  planTripKg: number | null;
};

// ===== Хелперы =====

const weekKeyOf = (w: { isoYear: number; isoWeek: number }) => `${w.isoYear}-${w.isoWeek}`;
const toISO = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (fromISO: string, toISOStr: string) =>
  Math.round((parseDateUTC(toISOStr).getTime() - parseDateUTC(fromISO).getTime()) / DAY_MS);

// Средний ФАКТИЧЕСКИЙ вес рейса набора позиций, кг. Группировка по рейсу обязательна:
// знаменатель — машины, а не позиции (рейс с двумя позициями — одна машина).
function avgActualTripKgOf(items: CultureItemFull[]): number | null {
  const byTrip = new Map<number, (number | null)[]>();
  for (const i of items) {
    const cur = byTrip.get(i.shipmentId);
    if (cur) cur.push(i.actualKg);
    else byTrip.set(i.shipmentId, [i.actualKg]);
  }
  const { avgActualTripWeightT } = aggregateActualTripWeight(
    [...byTrip.values()].map((itemActualsKg) => ({ itemActualsKg })),
  );
  return avgActualTripWeightT != null ? avgActualTripWeightT * KG_PER_TON : null;
}

// Медиана: чётное число элементов → среднее двух средних. Пусто → null («—», не 0).
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ⚠ РЕЙС, А НЕ ПОЗИЦИЯ, И ДЕНЬ, А НЕ РЕЙС. Три машины в один понедельник дают интервалы
// 0, 0, 7 и медиану 0 — число стало бы ложью. Событие ритма = день с приёмкой.
function deliveryDaysOf(items: CultureItemFull[]): string[] {
  const days = new Set<string>();
  for (const i of items) if (i.arrival) days.add(toISO(i.arrival));
  return [...days].sort();
}

export function buildFarmerAnalytics(input: {
  farmer: { id: number; name: string };
  season: number;
  generatedAt: string;
  period: SettlementPeriod;
  positionsTotal: number;
  cultures: AnalyticsCultureInput[];
  seasonTotalKg: number;
}): FarmerAnalytics {
  const { farmer, season, generatedAt, period, seasonTotalKg } = input;

  const allMine: CultureItemFull[] = [];
  const remaining: AnalyticsRemainingRow[] = [];
  const share: FarmerAnalytics["share"]["byCulture"] = [];
  const minePerCulture = new Map<number, CultureItemFull[]>();

  let execAcceptedKg = 0;
  let execTargetKg = 0;
  let planNum = 0;
  let planDen = 0;
  let planIncomplete = false;
  let ownSeasonKg = 0;

  for (const c of input.cultures) {
    // ⚠ ЕДИНСТВЕННОЕ место, где набор режется. Именованная функция ядра, не filter по месту.
    const mine = filterItemsBySuppliers(c.items, [farmer.id]);
    minePerCulture.set(c.culture.id, mine);
    allMine.push(...mine);

    // Агрегат по ВСЕЙ культуре — тот же, что рисует таблицу «По поставщикам» на профиле
    // культуры и строку «Качества». Долю и принятое фермера берём из него, а не считаем заново.
    const agg = aggregateCultureItems(c.items);
    const row = agg.bySupplier.find((s) => s.farmerId === farmer.id);
    const broadAcceptedKg = row?.acceptedKg ?? 0;
    ownSeasonKg += broadAcceptedKg;

    share.push({
      cultureId: c.culture.id,
      name: c.culture.name,
      color: c.culture.color,
      pctOfCulture: row?.sharePct ?? 0,
      suppliersCount: agg.bySupplier.length,
    });

    for (const l of c.lines) {
      execAcceptedKg += l.acceptedKg;
      execTargetKg += l.targetKg;
    }

    // База прогноза: факт, при его отсутствии — норма рейса (DOMAIN §5, fallback).
    const actualTripKg = avgActualTripKgOf(mine);
    const avgTripKg = actualTripKg ?? c.planTripKg;
    const avgTripSource: AnalyticsRemainingRow["avgTripSource"] =
      actualTripKg != null ? "actual" : c.planTripKg != null ? "norm" : null;

    // Плановый вес рейса взвешивается ПРИНЯТЫМ объёмом культуры. Культура с объёмом, но
    // без нормы, обнуляет плитку целиком: усреднять «по тем, у кого норма есть» нельзя —
    // получится вес несуществующего рейса.
    if (broadAcceptedKg > 0) {
      if (c.planTripKg == null) planIncomplete = true;
      else {
        planNum += c.planTripKg * broadAcceptedKg;
        planDen += broadAcceptedKg;
      }
    }

    const lineTons = c.lines.length
      ? c.lines.reduce((s, l) => s + l.volumeTons, 0)
      : null;
    const contractAcceptedKg = c.lines.reduce((s, l) => s + l.acceptedKg, 0);
    const acceptedKg = c.lines.length ? contractAcceptedKg : broadAcceptedKg;
    // execution.remainingKg НЕ клампится (бывает отрицательным при перевыполнении) —
    // клампим здесь, иначе прогноз ушёл бы в минус машин.
    const remainingKg =
      lineTons == null ? null : Math.max(0, lineTons * KG_PER_TON - acceptedKg);

    remaining.push({
      cultureId: c.culture.id,
      name: c.culture.name,
      color: c.culture.color,
      lineTons,
      acceptedKg,
      remainingKg,
      avgTripKg,
      avgTripSource,
      // Без строки контракта — null во ВСЕХ прогнозных полях, не 0: «нет плана» ≠ «мало принял».
      trips: remainingKg == null ? null : remainingTripsOf(remainingKg, avgTripKg),
    });
  }

  remaining.sort((a, b) => b.acceptedKg - a.acceptedKg || a.name.localeCompare(b.name));
  share.sort((a, b) => b.pctOfCulture - a.pctOfCulture || a.name.localeCompare(b.name));

  // ===== Периодная часть =====
  const minePeriod = allMine.filter((i) => isInPeriod(i.date, period));
  const periodAcceptedKg = minePeriod.reduce(
    (s, i) => s + (computeAcceptedKg(i.actualKg, i.brakPercent, i.calibres) ?? 0),
    0,
  );
  const tripsInPeriod = new Set(minePeriod.map((i) => i.shipmentId)).size;

  const weeks = buildWeeks(minePeriod, input.cultures);
  // Недели С ПОСТАВКАМИ, а не длина оси: дырки — честный ноль тонн, но делить на них темп
  // нельзя (он бы падал вдвое от одной пропущенной недели).
  const weeksWithDeliveries = weeks.filter((w) => w.trips > 0).length;

  const tempTonsPerWeek =
    weeksWithDeliveries > 0
      ? periodAcceptedKg / KG_PER_TON / weeksWithDeliveries
      : null;

  const recent = weeks.filter((w) => w.trips > 0).slice(-RECENT_WEEKS);
  const tempRecentTonsPerWeek =
    recent.length >= 2 ? recent.reduce((s, w) => s + w.tons, 0) / recent.length : null;

  // ===== Ритм (сезонный, кроме двух периодных полей) =====
  const days = deliveryDaysOf(allMine);
  const lastDeliveryDate = days.length > 0 ? days[days.length - 1] : null;
  const intervalsDays = days.slice(1).map((d, k) => daysBetween(days[k], d));

  let lastActNumber: string | null = null;
  if (lastDeliveryDate) {
    const onLastDay = allMine.filter(
      (i) => i.arrival != null && toISO(i.arrival) === lastDeliveryDate,
    );
    const latest = onLastDay.sort((a, b) => b.itemId - a.itemId)[0];
    lastActNumber = latest?.actNumber ?? null;
  }

  // ⚠ Знаменатель ритма — ВСЯ ось периода, с паузами, в отличие от темпа. Темп отвечает
  // «сколько везёт, когда возит», ритм — «как часто появляется». Слить их нельзя: четыре
  // рейса за десять недель дали бы «1,0 рейса в неделю», то есть «возит еженедельно».
  const tripsPerWeek = weeks.length > 0 ? tripsInPeriod / weeks.length : null;

  const hasContracts = input.cultures.some((c) => c.lines.length > 0);
  const tripsNumbers = remaining
    .map((r) => r.trips)
    .filter((t): t is number => t != null);

  const periodEmpty = tripsInPeriod === 0 && periodAcceptedKg === 0;

  return {
    farmer,
    season,
    generatedAt,
    period,
    kpi: {
      periodAcceptedKg,
      tempTonsPerWeek,
      executionPct: execTargetKg > 0 ? (execAcceptedKg / execTargetKg) * 100 : null,
      // Строк нет — прогнозировать нечего; базы нет ни у одной строки — тоже «—», а не 0.
      remainingTrips:
        hasContracts && tripsNumbers.length > 0
          ? tripsNumbers.reduce((s, t) => s + t, 0)
          : null,
      avgTripPlanKg: planIncomplete || planDen === 0 ? null : planNum / planDen,
      avgTripActualKg: avgActualTripKgOf(allMine),
    },
    periodMeta: {
      positions: minePeriod.length,
      trips: tripsInPeriod,
      tempRecentTonsPerWeek,
    },
    remaining,
    weeks,
    rhythm: {
      lastDeliveryDate,
      lastActNumber,
      daysSinceLast:
        lastDeliveryDate != null ? daysBetween(lastDeliveryDate, generatedAt) : null,
      medianIntervalDays: median(intervalsDays),
      intervalsDays,
      tripsInPeriod,
      tripsPerWeek,
    },
    share: {
      byCulture: share,
      ownSeasonKg,
      seasonPct: seasonTotalKg > 0 ? (ownSeasonKg / seasonTotalKg) * 100 : null,
      seasonTotalKg,
    },
    notes: {
      hasContracts,
      chartReady: weeksWithDeliveries >= MIN_WEEKS_FOR_CHART,
      periodEmpty,
      positionsTotal: input.positionsTotal,
      nearestWeekWithData: periodEmpty
        ? findNearestWeek(allMine, period, season)
        : undefined,
    },
  };
}

// Недели периода в разрезе культур. Ось СПЛОШНАЯ (в отличие от «Качества», где метрика —
// процент и нулевая точка читалась бы как «неделя идеального качества»): здесь метрика —
// тонны, ноль честен, а пропуск дырок врёт по длительности пауз.
// Недели строятся по ДАТЕ ПРИБЫТИЯ (i.arrival, без fallback на отправление): позиция,
// попавшая в период по departure_date, входит в «Принято», но ни в одну неделю не идёт.
function buildWeeks(
  minePeriod: CultureItemFull[],
  cultures: AnalyticsCultureInput[],
): AnalyticsWeek[] {
  // Тонны недели по культуре — через общий агрегатор, а не своим суммированием:
  // weekTons.tons уже посчитан computeAcceptedKg.
  const tonsByCulture = new Map<number, Map<string, number>>();
  const present: { isoYear: number; isoWeek: number }[] = [];
  for (const c of cultures) {
    const items = minePeriod.filter((i) => i.cultureId === c.culture.id);
    const map = new Map<string, number>();
    for (const [key, w] of aggregateCultureItems(items).weekTons) {
      map.set(key, w.tons);
      present.push({ isoYear: w.isoYear, isoWeek: w.isoWeek });
    }
    tonsByCulture.set(c.culture.id, map);
  }

  const tripsByWeek = new Map<string, Set<number>>();
  for (const i of minePeriod) {
    if (!i.arrival) continue;
    const key = weekKeyOf(isoWeek(i.arrival));
    const cur = tripsByWeek.get(key);
    if (cur) cur.add(i.shipmentId);
    else tripsByWeek.set(key, new Set([i.shipmentId]));
  }

  return buildWeekAxis(present).map((w) => {
    const key = weekKeyOf(w);
    const byCulture = cultures.map((c) => ({
      cultureId: c.culture.id,
      tons: tonsByCulture.get(c.culture.id)?.get(key) ?? 0,
    }));
    return {
      isoYear: w.isoYear,
      isoWeek: w.isoWeek,
      label: w.label,
      tons: byCulture.reduce((s, b) => s + b.tons, 0),
      trips: tripsByWeek.get(key)?.size ?? 0,
      byCulture,
    };
  });
}

// Ближайшая к периоду неделя С ПРИЁМКОЙ — подсказка вместо пяти нулей. Ищется среди
// СЕЗОННЫХ недель фермера, пересекающиеся с периодом пропускаются. При равном удалении
// выигрывает прошлая: уже случившееся полезнее, чем то, что ещё не приехало.
// Подпись строит существующий лейблер периода — второго формата дат не заводим.
function findNearestWeek(
  allMine: CultureItemFull[],
  period: SettlementPeriod,
  season: number,
): FarmerAnalytics["notes"]["nearestWeekWithData"] {
  if (period.from == null && period.to == null) return undefined;

  const byWeek = new Map<
    string,
    { isoYear: number; isoWeek: number; tons: number; trips: Set<number> }
  >();
  for (const i of allMine) {
    if (!i.arrival) continue;
    const w = isoWeek(i.arrival);
    const key = weekKeyOf(w);
    const cur =
      byWeek.get(key) ?? { isoYear: w.isoYear, isoWeek: w.isoWeek, tons: 0, trips: new Set() };
    cur.tons += (computeAcceptedKg(i.actualKg, i.brakPercent, i.calibres) ?? 0) / KG_PER_TON;
    cur.trips.add(i.shipmentId);
    byWeek.set(key, cur);
  }

  let best: { dist: number; past: boolean; anchor: string; tons: number; trips: number } | null =
    null;
  for (const w of byWeek.values()) {
    const { start, end } = isoWeekRange(w.isoYear, w.isoWeek);
    const startISO = toISO(start);
    const endISO = toISO(end);
    let dist: number;
    let past: boolean;
    if (period.from != null && endISO < period.from) {
      dist = daysBetween(endISO, period.from);
      past = true;
    } else if (period.to != null && startISO > period.to) {
      dist = daysBetween(period.to, startISO);
      past = false;
    } else {
      continue; // неделя пересекается с периодом — подсказкой быть не может
    }
    const better =
      best == null ||
      dist < best.dist ||
      (dist === best.dist && past && !best.past);
    if (better) {
      best = { dist, past, anchor: startISO, tons: w.tons, trips: w.trips.size };
    }
  }
  if (!best) return undefined;

  return {
    label: resolveSettlementPeriod({
      period: "week",
      from: best.anchor,
      season,
      today: best.anchor,
    }).label,
    anchor: best.anchor,
    tons: best.tons,
    trips: best.trips,
  };
}
