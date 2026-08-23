import {
  computeAcceptedKg,
  computeAcceptedPercent,
} from "@/server/acceptance/accepted";
import {
  aggregateCultureItems,
  brakPctOfItems,
  categoryShares,
  excludeSupplier,
  filterItemsBySuppliers,
  nonStandardPctOfItems,
  type CategoryShare,
  type CultureItem,
} from "@/server/analytics/culture-agg";
import type { CultureItemFull } from "@/server/analytics/culture-items";
import { MIN_WEEKS_FOR_CHART, weekLabel } from "@/server/analytics/week-axis";
import { isoWeek } from "@/server/shipments/workdays";

// Чистое ядро вкладки «Качество» карточки поставщика — БЕЗ prisma, чтобы считаться
// юнит-тестами (quality-agg.test.ts) без БД и сессии. Загрузчик getFarmerQuality — рядом,
// в ./quality (он тянет БД и requireRole).
//
// Разрез — зеркало профиля культуры: там «фермеры внутри культуры», здесь «культуры внутри
// фермера». Обе стороны считаются ОДНИМ ядром (culture-agg), поэтому «Принято» и «Брак» по
// культуре сходятся со строкой этого фермера в таблице «По поставщикам» число в число.
//
// ⚠ ФОРМУЛ ЗДЕСЬ НЕТ. Все учётные величины — из существующего ядра:
//   принятый вес позиции   — computeAcceptedKg
//   % принятого            — computeAcceptedPercent
//   взвешенный брак набора — brakPctOfItems (внутри computeWeightedBrak)
//   доли категорий         — categoryShares
//   «не в зачёт»           — nonStandardPctOfItems
//
// ⚠ Вердикт, Δ и позиция — величины ПРЕДСТАВЛЕНИЯ, а не учёта: они не участвуют ни в одной
// из четырёх баз веса (DOMAIN §1), ни в деньгах, ни в выполнении контракта. Их нельзя
// переносить на «Расчёты» и «Контракты».
//
// ⚠ ДЕНЕГ НА ЭТОЙ ВКЛАДКЕ НЕТ СОЗНАТЕЛЬНО (BR-33): оплачиваемый вес намеренно НЕ искажает
// статистику качества, и колонка «к оплате» рядом с «% брака» стёрла бы эту границу.

/** Порог «≈ на уровне» для итогового вердикта, процентные пункты. */
const SAME_EPS_PP = 0.5;
/** Меньше трёх поставщиков — это не рейтинг, а шум: позиция не показывается. */
const MIN_SUPPLIERS_FOR_RANK = 3;
/** Меньше четырёх партий в культуре — подсветилась бы любая первая партия. */
const MIN_BATCHES_FOR_OUTLIER = 4;
/** Во сколько раз брак партии должен превысить средний брак фермера по культуре. */
const OUTLIER_FACTOR = 1.5;

export type QualityVerdict = "better" | "same" | "worse";

/** Партия переговорного листа: только веса, проценты и категории — без логистики. */
export type QualityBatch = {
  itemId: number;
  date: string | null;
  actNumber: string | null; // BR-9, уже без префикса сезона
  actualKg: number | null;
  acceptedKg: number | null;
  acceptedPct: number;
  brakPct: number | null;
  categories: CategoryShare[];
  // Считает ЯДРО, не UI: иначе порог разъедется между экраном и печатью.
  outlier: boolean;
};

export type QualityCulture = {
  cultureId: number;
  name: string;
  color: string;
  acceptanceType: "simple" | "calibre";
  contractTons: number | null; // Σ volume_tons строк культуры; null = строки контракта нет

  acceptedKg: number;
  brakPct: number | null;

  // ⚠ ДВА РАЗНЫХ НАБОРА ПОЗИЦИЙ В ОДНОЙ СТРОКЕ — не сливать:
  //   brakPct       — только позиции ЭТОГО фермера;
  //   othersBrakPct — позиции культуры БЕЗ него (excludeSupplier).
  othersBrakPct: number | null; // null = у остальных актов нет → «сравнивать пока не с кем»
  deltaPp: number | null; // brakPct − othersBrakPct, п.п.; важен знак, а не десятые

  rank: { position: number; of: number } | null; // null при of < 3
  suppliersWithBrak: number; // M — для подсказки «культуру возит N фермеров»
  sharePct: number; // доля фермера в принятом весе культуры
  nonStandardPct: number | null; // null для simple-приёмки

  categories: CategoryShare[]; // размерный порядок (compareCalibreRanges)
  batches: QualityBatch[]; // по дате убыв.
};

export type QualityWeek = {
  isoYear: number;
  isoWeek: number;
  label: string;
  positions: number;
  actualKg: number;
  acceptedKg: number;
  brakPct: number | null;
};

export type FarmerQuality = {
  farmer: { id: number; name: string };
  season: number;
  generatedAt: string; // todayLocalISO() — НЕ new Date().toISOString()

  kpi: {
    acceptedKg: number;
    avgBrakPct: number | null;
    actsCount: number;
    positionsTotal: number; // все позиции сезона, включая ещё не принятые
    weeksWithActs: number;
  };

  cultures: QualityCulture[];

  totals: {
    acceptedKg: number;
    brakPct: number | null;
    // ⚠ ЧИСЛА «брак у остальных» в итоге НЕТ сознательно: композит по культурам с разными
    // базами выглядит сопоставимым с браком фермера, но им не является. Только знак.
    benchmark: { verdict: QualityVerdict | null; basedOnCultures: number };
  };

  weeks: QualityWeek[];

  // Флаги для подписей и деградаций — считает ядро, UI только рисует.
  notes: {
    hasCalibre: boolean;
    weeksWithActs: number;
    chartReady: boolean;
  };
};

export type QualityCultureInput = {
  culture: {
    id: number;
    name: string;
    color: string;
    acceptanceType: "simple" | "calibre";
  };
  contractTons: number | null;
  /** ВСЕ позиции культуры за сезон — и его, и остальных поставщиков (база бенчмарка). */
  items: CultureItemFull[];
};

// Место по браку: 1 + сколько поставщиков строго лучше. Равный брак даёт равное место —
// придумывать порядок внутри ничьей нечем, а «4 и 5 из 9» при одинаковых 3,1% соврало бы.
function rankOf(
  brakPct: number | null,
  peers: { brakPct: number | null }[],
): { rank: { position: number; of: number } | null; suppliersWithBrak: number } {
  const measurable = peers.filter((p): p is { brakPct: number } => p.brakPct != null);
  const of = measurable.length;
  if (brakPct == null || of < MIN_SUPPLIERS_FOR_RANK) {
    return { rank: null, suppliersWithBrak: of };
  }
  const better = measurable.filter((p) => p.brakPct < brakPct).length;
  return { rank: { position: better + 1, of }, suppliersWithBrak: of };
}

function buildBatches(mine: CultureItemFull[], farmerBrakPct: number | null): QualityBatch[] {
  const canFlag = mine.length >= MIN_BATCHES_FOR_OUTLIER && farmerBrakPct != null;
  return mine
    .map((i) => {
      const acceptedKg = computeAcceptedKg(i.actualKg, i.brakPercent, i.calibres);
      return {
        itemId: i.itemId,
        date: i.date,
        actNumber: i.actNumber,
        actualKg: i.actualKg,
        acceptedKg,
        acceptedPct: computeAcceptedPercent(i.brakPercent, i.calibres),
        brakPct: i.brakPercent,
        categories: categoryShares([i]),
        outlier:
          canFlag &&
          i.brakPercent != null &&
          i.brakPercent >= farmerBrakPct * OUTLIER_FACTOR,
      };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.itemId - a.itemId);
}

// Недели строятся по ДАТЕ ПРИБЫТИЯ (CultureItem.arrival), как на профиле культуры: позиция
// без прибытия в динамику не идёт вовсе. Недель БЕЗ актов в списке нет — нулевые точки
// между поставками читались бы как «неделя с идеальным качеством».
function buildWeeks(mine: CultureItemFull[]): QualityWeek[] {
  const byWeek = new Map<
    string,
    { isoYear: number; isoWeek: number; items: CultureItem[] }
  >();
  for (const i of mine) {
    if (!i.arrival) continue;
    const w = isoWeek(i.arrival);
    const key = `${w.isoYear}-${w.isoWeek}`;
    const cur = byWeek.get(key) ?? { isoYear: w.isoYear, isoWeek: w.isoWeek, items: [] };
    cur.items.push(i);
    byWeek.set(key, cur);
  }
  return [...byWeek.values()]
    .map((w) => ({
      isoYear: w.isoYear,
      isoWeek: w.isoWeek,
      label: weekLabel(w.isoWeek),
      positions: w.items.length,
      actualKg: w.items.reduce((s, i) => s + (i.actualKg ?? 0), 0),
      acceptedKg: w.items.reduce(
        (s, i) => s + (computeAcceptedKg(i.actualKg, i.brakPercent, i.calibres) ?? 0),
        0,
      ),
      brakPct: brakPctOfItems(w.items),
    }))
    .sort((a, b) => a.isoYear - b.isoYear || a.isoWeek - b.isoWeek);
}

export function buildFarmerQuality(input: {
  farmer: { id: number; name: string };
  season: number;
  generatedAt: string;
  positionsTotal: number;
  cultures: QualityCultureInput[];
}): FarmerQuality {
  const { farmer, season, generatedAt, positionsTotal } = input;

  const allMine: CultureItemFull[] = [];
  const cultures: QualityCulture[] = [];

  for (const c of input.cultures) {
    // ⚠ ЕДИНСТВЕННОЕ МЕСТО, где набор позиций делится надвое. Обе половины режутся
    // именованными функциями ядра, а не filter'ом по месту: база сравнения обязана быть
    // одна и та же на всех вкладках.
    const mine = filterItemsBySuppliers(c.items, [farmer.id]);
    const others = excludeSupplier(c.items, farmer.id);
    allMine.push(...mine);

    // Агрегат по ВСЕЙ культуре — тот же, что рисует таблицу «По поставщикам» профиля
    // культуры. Строка фермера берётся из него, а не считается заново: иначе два экрана
    // разойдутся на округлении и на трактовке позиций без перевески.
    const agg = aggregateCultureItems(c.items);
    const row = agg.bySupplier.find((s) => s.farmerId === farmer.id);

    const brakPct = row?.brakPct ?? null;
    const othersBrakPct = brakPctOfItems(others);
    const { rank, suppliersWithBrak } = rankOf(brakPct, agg.bySupplier);

    cultures.push({
      cultureId: c.culture.id,
      name: c.culture.name,
      color: c.culture.color,
      acceptanceType: c.culture.acceptanceType,
      contractTons: c.contractTons,
      acceptedKg: row?.acceptedKg ?? 0,
      brakPct,
      othersBrakPct,
      deltaPp:
        brakPct != null && othersBrakPct != null ? brakPct - othersBrakPct : null,
      rank,
      suppliersWithBrak,
      sharePct: row?.sharePct ?? 0,
      nonStandardPct: nonStandardPctOfItems(mine),
      categories: row?.categoryPct ?? [],
      batches: buildBatches(mine, brakPct),
    });
  }

  cultures.sort((a, b) => b.acceptedKg - a.acceptedKg || a.name.localeCompare(b.name));

  // Вердикт — по ЗНАКУ дельты, взвешенной принятым объёмом фермера в тех культурах, где
  // база бенчмарка есть. Культуры без базы в знаменатель не идут (иначе молчаливое «на
  // уровне» от того, что сравнивать было не с кем).
  let deltaNum = 0;
  let deltaDen = 0;
  let basedOnCultures = 0;
  for (const c of cultures) {
    if (c.deltaPp == null) continue;
    basedOnCultures += 1;
    deltaNum += c.deltaPp * c.acceptedKg;
    deltaDen += c.acceptedKg;
  }
  let verdict: QualityVerdict | null = null;
  if (basedOnCultures > 0 && deltaDen > 0) {
    const weighted = deltaNum / deltaDen;
    verdict =
      Math.abs(weighted) < SAME_EPS_PP ? "same" : weighted > 0 ? "worse" : "better";
  }

  const weeks = buildWeeks(allMine);
  const acceptedKg = cultures.reduce((s, c) => s + c.acceptedKg, 0);
  const avgBrakPct = brakPctOfItems(allMine);

  return {
    farmer,
    season,
    generatedAt,
    kpi: {
      acceptedKg,
      avgBrakPct,
      actsCount: allMine.length, // акт 1:1 позиция (AcceptanceAct.shipment_item_id @unique)
      positionsTotal,
      weeksWithActs: weeks.length,
    },
    cultures,
    totals: {
      // Те же числа, что на плитках: итог таблицы обязан сходиться с KPI тождественно,
      // поэтому считается из одного набора, а не второй выборкой.
      acceptedKg,
      brakPct: avgBrakPct,
      benchmark: { verdict, basedOnCultures },
    },
    weeks,
    notes: {
      hasCalibre: cultures.some((c) => c.acceptanceType === "calibre"),
      weeksWithActs: weeks.length,
      chartReady: weeks.length >= MIN_WEEKS_FOR_CHART,
    },
  };
}
