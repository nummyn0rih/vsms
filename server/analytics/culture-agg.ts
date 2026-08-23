import {
  compareCalibreRanges,
  type CalibreOrderKey,
  computeAcceptedKg,
  computeNonStandardPercent,
  computeSettlement,
  computeWeightedBrak,
} from "@/server/acceptance/accepted";
import { isoWeek } from "@/server/shipments/workdays";

// Чистое ядро профиля культуры (/analytics/culture/[id]) — БЕЗ prisma, чтобы считаться
// юнит-тестами (culture.test.ts) без БД и сессии. Загрузчик getCultureAnalytics — рядом,
// в ./culture (он тянет БД, execution и справочники).
//
// Формулы принятого/оплачиваемого/брака НЕ дублируются: computeAcceptedKg,
// computeSettlement (BR-33), computeWeightedBrak — единственные источники.

export const KG_PER_TON = 1000;
const BRAK_LABEL = "Брак"; // синтетическая reject-категория стека калибра (brak_percent акта)
const PLAIN_LABEL = "Принято"; // синтетическая принятая категория simple-акта (калибра нет)

// Доля категории в фактическом весе: label + признак «в зачёт» + % и тонны.
export type CategoryShare = {
  label: string;
  isAccepted: boolean;
  pct: number;
  tons: number;
};

type BrakRow = { actualKg: number; brakPercent: number };

// computeWeightedBrak возвращает 0 при пустом наборе — для UI нужен «—», поэтому null.
function weightedBrakOrNull(rows: BrakRow[]): number | null {
  const den = rows.reduce((s, r) => s + r.actualKg, 0);
  return den > 0 ? computeWeightedBrak(rows) : null;
}

// Строка базы брака из позиции. Позиция БЕЗ перевески в базу не входит вовсе (знаменатель —
// фактический вес), а не считается нулём; брак без акта-процента — 0.
// ⚠ Единственное место, где строится эта пара: агрегатор и brakPctOfItems обязаны отбирать
// позиции одинаково, иначе «брак у него» и «брак у остальных» посчитаются разными правилами.
function brakRowOf(i: CultureItem): BrakRow | null {
  return i.actualKg != null
    ? { actualKg: i.actualKg, brakPercent: i.brakPercent ?? 0 }
    : null;
}

// Взвешенный по факт. весу брак произвольного НАБОРА позиций; null = базы нет.
// Тождественно равен bySupplier[].brakPct для набора позиций одного поставщика —
// поэтому бенчмарк «у остальных» считается ровно тем же выражением, что «у него».
export function brakPctOfItems(items: CultureItem[]): number | null {
  const rows: BrakRow[] = [];
  for (const i of items) {
    const r = brakRowOf(i);
    if (r) rows.push(r);
  }
  return weightedBrakOrNull(rows);
}

// Σ непринятых КАТЕГОРИЙ калибра, взвешенная фактическим весом («не в зачёт, %»).
// null = ни у одной позиции набора категорий нет (simple-приёмка): там «не в зачёт» —
// это брак, и он показывается отдельным числом. Формула доли одной позиции — общая
// с расчётным листом (computeNonStandardPercent), второй копии нет.
export function nonStandardPctOfItems(items: CultureItem[]): number | null {
  let den = 0;
  let num = 0;
  let hasCalibre = false;
  for (const i of items) {
    if (i.actualKg == null) continue;
    den += i.actualKg;
    if (i.calibres.length === 0) continue;
    hasCalibre = true;
    num += (i.actualKg * computeNonStandardPercent(i.calibres)) / 100;
  }
  return hasCalibre && den > 0 ? (num / den) * 100 : null;
}

// Принятая позиция культуры (загрузчик маппит из Prisma-результата). Чистое DTO —
// агрегатор ниже тестируется без сессии/БД.
// ⚠ minCm/maxCm/rangeId у категории нужны НЕ для арифметики, а для показа: без них
// сортировать категории размерным порядком нечем (categoryShares их и использует).
export type CultureItem = {
  shipmentId: number;
  farmerId: number;
  farmerName: string;
  arrival: Date | null; // дата прибытия (недели строятся по ней)
  actualKg: number | null;
  brakPercent: number | null;
  settlementPercent: number | null; // BR-33: % к оплате от факта, null = корректировки нет
  calibres: {
    label: string;
    isAccepted: boolean;
    percent: number;
    minCm: number | null; // границы категории (см) — ключ размерного порядка показа
    maxCm: number | null;
    rangeId: number; // CalibreRange.id — тай-брейкер порядка
  }[];
};

export type CultureItemsAggregate = {
  acceptedKgTotal: number;
  paidKgTotal: number; // Σ оплачиваемого (BR-33) — та же выборка, что acceptedKgTotal
  avgBrakPct: number | null;
  positionsCount: number;
  tripsCount: number;
  farmersCount: number;
  // ⚠ ДВЕ БАЗЫ ВЕСА В ОДНОЙ НЕДЕЛЕ (DOMAIN §1) — не складывать и не путать:
  //   tons       — ПРИНЯТЫЙ вес (после брака и нестандарта), база тонн выполнения;
  //   actualTons — ФАКТИЧЕСКИЙ вес перевески, база брака.
  // Тождественно actualTons ≥ tons: принятый = факт × Σ принятых %. Разрыв на графике —
  // ровно брак + нестандарт.
  weekTons: Map<
    string,
    { isoYear: number; isoWeek: number; tons: number; actualTons: number }
  >;
  weekBrakPct: Map<string, { isoYear: number; isoWeek: number; pct: number }>;
  bySupplier: {
    farmerId: number;
    farmerName: string;
    acceptedKg: number;
    paidKg: number;
    brakPct: number | null;
    categoryPct: CategoryShare[];
    sharePct: number;
  }[];
  calibre: CategoryShare[];
};

// Доли категорий калибра в ФАКТИЧЕСКОМ весе набора позиций. Единственная реализация:
// зовётся и для культуры целиком (стек «Калибр»), и для каждого поставщика (колонка
// «% категорий»). Вторую базу долей не заводить — знаменатель всегда Σ факт. веса.
//   категория калибра → actual × percent/100
//   позиция БЕЗ категорий (simple-акт) → одна принятая доля «Принято» (формула — computeAcceptedKg)
//   брак → отдельная доля акта (categories + brak = 100), в calibreResults её нет
// Сумма долей = 100% факта. Пустые доли не создаём (иначе категория-призрак в легенде).
//
// ПОРЯДОК — размерный (compareCalibreRanges), а не по доле: иначе у каждого фермера свой
// порядок категорий и колонки таблицы не сопоставить глазами. Синтетические «Принято» и
// «Брак» — не CalibreRange (id/границ у них нет), поэтому пришпилены в хвост явно.
export function categoryShares(items: CultureItem[]): CategoryShare[] {
  // Значение несёт и вес, и ключ сортировки (CalibreOrderKey: minCm/maxCm/id).
  const catKg = new Map<
    string,
    CalibreOrderKey & { isAccepted: boolean; kg: number }
  >();
  let actualKgTotal = 0;
  let brakKgTotal = 0; // вес брака (actual × brak%)
  let plainKg = 0; // принятый вес позиций без калибра

  for (const i of items) {
    if (i.actualKg == null) continue; // без перевески доли не считаются
    actualKgTotal += i.actualKg;
    brakKgTotal += (i.actualKg * (i.brakPercent ?? 0)) / 100;
    if (i.calibres.length === 0) {
      plainKg += computeAcceptedKg(i.actualKg, i.brakPercent, []) ?? 0;
      continue;
    }
    for (const c of i.calibres) {
      // Ключ — подпись: внутри одной культуры она 1:1 с диапазоном (строится из его
      // границ), поэтому ключ сортировки берём у первой встреченной категории.
      const cur = catKg.get(c.label) ?? {
        isAccepted: c.isAccepted,
        kg: 0,
        minCm: c.minCm,
        maxCm: c.maxCm,
        id: c.rangeId,
      };
      cur.kg += (i.actualKg * c.percent) / 100;
      catKg.set(c.label, cur);
    }
  }

  // Синтетические доли доливаются в ОДНОИМЁННУЮ категорию, если такая есть в схеме
  // (у культуры может быть заведён свой безразмерный «Брак») — иначе ломоть задвоится.
  const addSynthetic = (label: string, isAccepted: boolean, kg: number) => {
    if (kg <= 0) return;
    const cur = catKg.get(label) ?? {
      isAccepted,
      kg: 0,
      minCm: null,
      maxCm: null,
      id: 0,
    };
    cur.kg += kg;
    catKg.set(label, cur);
  };
  addSynthetic(PLAIN_LABEL, true, plainKg);
  addSynthetic(BRAK_LABEL, false, brakKgTotal);

  // «Принято» и «Брак» — не диапазоны, их место фиксировано: перед хвостом и в самом
  // хвосте. Остальные — размерным порядком.
  const rank = (label: string) => (label === BRAK_LABEL ? 2 : label === PLAIN_LABEL ? 1 : 0);

  return [...catKg.entries()]
    .sort(([aLabel, a], [bLabel, b]) => {
      const byRank = rank(aLabel) - rank(bLabel);
      return byRank !== 0 ? byRank : compareCalibreRanges(a, b);
    })
    .map(([label, c]) => ({
      label,
      isAccepted: c.isAccepted,
      pct: actualKgTotal > 0 ? (c.kg / actualKgTotal) * 100 : 0,
      tons: c.kg / KG_PER_TON,
    }));
}

// Оплачиваемый вес позиции (BR-33) = принятый + доплата от факта. Формула — только
// computeSettlement, своей арифметики здесь нет. allocation (разнос доплаты ПО СТРОКАМ
// контракта) в аналитике культуры не нужен: считаем ВЕС поставщика, а не деньги по строкам,
// поэтому contract_line_id не грузим и передаём null — на paidKg он не влияет.
function paidKgOf(item: CultureItem, acceptedKg: number | null): number {
  return computeSettlement({
    actualKg: item.actualKg,
    acceptedKg,
    settlementPercent: item.settlementPercent,
    itemLineId: null,
    calibres: item.calibres.map((c) => ({
      percent: c.percent,
      isAccepted: c.isAccepted,
      contractLineId: null,
    })),
  }).paidKg;
}

// Всё, что считается из позиций культуры: объём/брак/недели/поставщики/калибр.
// Формулы — только computeAcceptedKg + computeWeightedBrak, ничего своего.
export function aggregateCultureItems(items: CultureItem[]): CultureItemsAggregate {
  const weekTons = new Map<
    string,
    { isoYear: number; isoWeek: number; tons: number; actualTons: number }
  >();
  const weekBrakRows = new Map<
    string,
    { isoYear: number; isoWeek: number; rows: BrakRow[] }
  >();
  const supplierAgg = new Map<
    number,
    {
      farmerName: string;
      acceptedKg: number;
      paidKg: number;
      brakRows: BrakRow[];
      items: CultureItem[];
    }
  >();

  let acceptedKgTotal = 0;
  let paidKgTotal = 0;
  const brakRowsAll: BrakRow[] = [];

  for (const i of items) {
    const acceptedKg = computeAcceptedKg(i.actualKg, i.brakPercent, i.calibres) ?? 0;
    acceptedKgTotal += acceptedKg;
    const paidKg = paidKgOf(i, acceptedKg);
    paidKgTotal += paidKg;
    const brakRow = brakRowOf(i);
    if (brakRow) brakRowsAll.push(brakRow);

    // недели — по дате прибытия (позиции без неё в динамику не идут)
    if (i.arrival) {
      const w = isoWeek(i.arrival);
      const key = `${w.isoYear}-${w.isoWeek}`;
      const cur = weekTons.get(key) ?? {
        isoYear: w.isoYear,
        isoWeek: w.isoWeek,
        tons: 0,
        actualTons: 0,
      };
      cur.tons += acceptedKg / KG_PER_TON;
      // Фактический вес — тем же проходом; своей выборки/агрегации под серию «по
      // перевеске» не заводим. Позиция без перевески даёт 0, а не пропуск недели.
      cur.actualTons += (i.actualKg ?? 0) / KG_PER_TON;
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
      paidKg: 0,
      brakRows: [],
      items: [],
    };
    agg.acceptedKg += acceptedKg;
    agg.paidKg += paidKg;
    if (brakRow) agg.brakRows.push(brakRow);
    agg.items.push(i); // нужны целиком: доли категорий поставщика считает categoryShares
    supplierAgg.set(i.farmerId, agg);
  }

  return {
    acceptedKgTotal,
    paidKgTotal,
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
        paidKg: a.paidKg,
        brakPct: weightedBrakOrNull(a.brakRows),
        categoryPct: categoryShares(a.items),
        // База доли — принятый вес того же набора позиций, что и строки таблицы,
        // поэтому Σ долей = 100% тождественно. Ноль в знаменателе → 0, не NaN.
        sharePct: acceptedKgTotal > 0 ? (a.acceptedKg / acceptedKgTotal) * 100 : 0,
      }))
      .sort(
        (a, b) => b.acceptedKg - a.acceptedKg || a.farmerName.localeCompare(b.farmerName),
      ),
    calibre: categoryShares(items),
  };
}

// ===== Фильтр по поставщикам (профиль культуры) =====
// Режем НАБОР ПОЗИЦИЙ на входе агрегации, а не готовый результат: тогда недели, брак,
// доли категорий и доли поставщиков пересчитываются одной и той же реализацией, и
// инвариант «Σ долей видимых строк = 100%» держится тождественно (sharePct считается от
// acceptedKgTotal ТОГО ЖЕ набора). Второго набора агрегаций не заводить.

// «1,2,3» из ?suppliers= → [1,2]: мусор, дубли и непозитивные — вон. Общий парсер экрана
// и печатного листа, чтобы фильтр в URL читался обоими одинаково.
export function parseSupplierIds(raw: string | string[] | undefined): number[] {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s) return [];
  const out = new Set<number>();
  for (const part of s.split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

// Пустой список = все поставщики (поведение экрана без фильтра).
// Дженерик по T: разрез «Качество» кладёт сюда CultureItemFull (с № акта и датой партии),
// и после фильтра эти поля обязаны остаться — иначе переговорный лист нечем строить.
export function filterItemsBySuppliers<T extends CultureItem>(
  items: T[],
  supplierIds: number[],
): T[] {
  if (supplierIds.length === 0) return items;
  const sel = new Set(supplierIds);
  return items.filter((i) => sel.has(i.farmerId));
}

// База бенчмарка «все, КРОМЕ него» — дополнение к filterItemsBySuppliers([farmerId]).
// ⚠ Отдельная функция, а не items.filter(...) по месту: у базы сравнения должно быть одно
// имя и один тест, иначе она разъедется между вкладками «Качество» и «Аналитика».
export function excludeSupplier<T extends CultureItem>(
  items: T[],
  farmerId: number,
): T[] {
  return items.filter((i) => i.farmerId !== farmerId);
}

// Опции комбобокса — из НЕотфильтрованных позиций культуры (иначе выбранный поставщик
// схлопывает список до себя и снять выбор нечем). count — число позиций сезона (.ct).
export function supplierOptionsOf(
  items: CultureItem[],
): { id: number; name: string; count: number }[] {
  const byId = new Map<number, { id: number; name: string; count: number }>();
  for (const i of items) {
    const cur = byId.get(i.farmerId) ?? { id: i.farmerId, name: i.farmerName, count: 0 };
    cur.count += 1;
    byId.set(i.farmerId, cur);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
