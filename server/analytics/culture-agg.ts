import {
  computeAcceptedKg,
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

// Принятая позиция культуры (загрузчик маппит из Prisma-результата). Чистое DTO —
// агрегатор ниже тестируется без сессии/БД.
export type CultureItem = {
  shipmentId: number;
  farmerId: number;
  farmerName: string;
  arrival: Date | null; // дата прибытия (недели строятся по ней)
  actualKg: number | null;
  brakPercent: number | null;
  settlementPercent: number | null; // BR-33: % к оплате от факта, null = корректировки нет
  calibres: { label: string; isAccepted: boolean; percent: number }[];
};

export type CultureItemsAggregate = {
  acceptedKgTotal: number;
  paidKgTotal: number; // Σ оплачиваемого (BR-33) — та же выборка, что acceptedKgTotal
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
export function categoryShares(items: CultureItem[]): CategoryShare[] {
  const catKg = new Map<string, { isAccepted: boolean; kg: number }>();
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
      const cur = catKg.get(c.label) ?? { isAccepted: c.isAccepted, kg: 0 };
      cur.kg += (i.actualKg * c.percent) / 100;
      catKg.set(c.label, cur);
    }
  }

  if (plainKg > 0) catKg.set(PLAIN_LABEL, { isAccepted: true, kg: plainKg });
  if (brakKgTotal > 0) {
    const cur = catKg.get(BRAK_LABEL) ?? { isAccepted: false, kg: 0 };
    cur.kg += brakKgTotal;
    catKg.set(BRAK_LABEL, cur);
  }

  return (
    [...catKg.entries()]
      .map(([label, c]) => ({
        label,
        isAccepted: c.isAccepted,
        pct: actualKgTotal > 0 ? (c.kg / actualKgTotal) * 100 : 0,
        tons: c.kg / KG_PER_TON,
      }))
      // принятые категории первыми (по убыванию доли), «не в зачёт» — в конец
      .sort((a, b) => Number(b.isAccepted) - Number(a.isAccepted) || b.pct - a.pct)
  );
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
  const weekTons = new Map<string, { isoYear: number; isoWeek: number; tons: number }>();
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
