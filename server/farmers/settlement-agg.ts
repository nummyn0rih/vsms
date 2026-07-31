import { Prisma } from "@/lib/generated/prisma/client";
import { computeAcceptedKg, computeAcceptedPercent } from "@/server/acceptance/accepted";
import {
  ZERO,
  attributeAcceptedToLines,
  attributeSurchargeToLines,
  lineExecution,
  type ExecItem,
} from "@/server/contracts/execution-core";
import { isInPeriod, type SettlementPeriod } from "./settlement-period";

// Чистое ядро расчётного листа по фермеру (вкладка «Расчёты») — БЕЗ prisma, чтобы
// считаться юнит-тестами (settlement-agg.test.ts) без БД и сессии. Загрузчик
// getFarmerSettlement — рядом, в ./settlement (он тянет БД и requireRole).
//
// ⚠ ФОРМУЛ ЗДЕСЬ НЕТ. Все величины — из существующего ядра расчётов:
//   принятый вес позиции      — computeAcceptedKg
//   разнос по строкам (тонны) — attributeAcceptedToLines
//   доплата BR-33 (деньги)    — attributeSurchargeToLines
//   выполнение и стоимость    — lineExecution
// Лист только группирует и суммирует их результаты. Совпадение с карточкой контракта
// (getContractExecution) обеспечивается тем, что это ТЕ ЖЕ функции на том же наборе.
//
// ⚠ ДВЕ БАЗЫ ВЕСА (DOMAIN §1, BR-33) — не сливать:
//   ВЫПОЛНЕНИЕ строки (season.countedKg/pct/remainingKg) — от ПРИНЯТОГО веса;
//   ДЕНЬГИ (paidKg/costRub) — от ОПЛАЧИВАЕМОГО = принятый + доплата.
//
// ⚠ ДВА СКОУПА В ОДНОМ ЛИСТЕ:
//   деньги и веса — ЗА ПЕРИОД (месяц/неделя/диапазон);
//   «Заявлено»/«Выполнение»/«Осталось» (блок season) — ВСЕГДА ЗА СЕЗОН, потому что
//   volume_tons строки задан на сезон. Показывать «принято за август ÷ объём за сезон»
//   как выполнение — неверное число, поэтому блоки разведены.

// Ключ-заглушка «оплачиваемый вес есть, а строки контракта нет». Позволяет прогнать
// непривязанный вес через ТЕ ЖЕ attribute*ToLines (которые молча выбрасывают null-строку)
// и получить исчерпывающее разбиение: ∈ lineMap → строки листа, = UNBOUND_LINE →
// «без привязки», прочее → строка вне листа (чужой контракт/сезон).
// НЕ путать с транзит-сентинелами склада (-1/-2/-3): там location_id, здесь contract_line_id.
export const UNBOUND_LINE = -1;

// Период живёт в ./settlement-period (client-safe, без Prisma) — ре-экспорт, чтобы у
// сервера и тестов была одна точка входа в ядро листа.
export {
  isInPeriod,
  periodColumnSuffix,
  resolveSettlementPeriod,
  shiftSettlementPeriod,
  type SettlementPeriod,
  type SettlementPeriodKind,
} from "./settlement-period";

// --- Вход сборки (загрузчик маппит из Prisma-результата) ---

export type SheetItemStatus = "planned" | "sent" | "arrived" | "accepted";

export type SheetLine = {
  lineId: number;
  contractId: number;
  cultureId: number;
  cultureName: string;
  color: string;
  label: string; // ContractLine.label («стандарт», «нестандарт >12»), "" если не задан
  volumeTons: Prisma.Decimal;
  price: Prisma.Decimal;
};

export type SheetItem = {
  itemId: number;
  actNumber: string | null; // BR-9, уже без префикса сезона (stripSeasonPrefix)
  date: string | null; // фактическая: arrival_date ?? departure_date
  cultureName: string;
  color: string;
  status: SheetItemStatus;
  plannedKg: number;
  exec: ExecItem | null; // null = акта приёмки нет → позиция ждёт приёмки
};

// --- Результат ---

// Вклад ОДНОЙ партии в ОДНУ строку контракта.
export type SettlementBatch = {
  itemId: number;
  actNumber: string | null;
  date: string | null;
  cultureName: string;
  color: string;

  // ⚠ ВКЛАД В ЭТУ СТРОКУ, а НЕ «принято по акту» (DOMAIN §5, C3d-2): нестандарт со своей
  // строкой идёт в зачёт своей строки, но в computeAcceptedKg позиции не входит.
  countedKg: number;
  surchargeKg: number; // доля доплаты BR-33 на эту строку — ТОЛЬКО деньги
  paidKg: number; // countedKg + surchargeKg (база ДЕНЕГ)
  costRub: number; // paidKg × цена строки
  settlementPercent: number | null; // != null → чип «корректировка N %»

  // Контекст ПАРТИИ ЦЕЛИКОМ (объяснение цепочки факт → принято при разговоре с фермером).
  // ⚠ НЕ СУММИРОВАТЬ по строкам: calibre-партия попадает в несколько строк, и эти поля
  // в каждой из них повторяются (при linesCount > 1 факт задвоился бы).
  position: {
    actualKg: number | null;
    acceptedKg: number | null; // computeAcceptedKg — «принято по акту»
    acceptedPercent: number; // computeAcceptedPercent, % от факта
    brakPercent: number | null;
    nonStandardPercent: number; // Σ % непринятых категорий — пояснение, не деньги
    linesCount: number; // в скольких строках листа участвует партия
  };
};

export type SettlementLine = {
  lineId: number;
  contractId: number;
  cultureId: number;
  cultureName: string;
  color: string;
  label: string;
  pricePerKg: number; // 0 → цена не задана (чип), вес есть, а суммы нет

  // --- ЗА ПЕРИОД (деньги листа) ---
  countedKg: number;
  surchargeKg: number;
  paidKg: number;
  costRub: number;

  // --- ЗА СЕЗОН (план строки от периода не зависит) ---
  season: {
    countedKg: number; // = LineExecutionRow.acceptedKg карточки контракта
    targetKg: number; // volume_tons × 1000
    pct: number; // countedKg / targetKg × 100, БЕЗ округления
    remainingKg: number; // < 0 = перевыполнение
  };

  batches: SettlementBatch[]; // Σ по batches ≡ периодные поля строки
};

// «Вес есть — денег нет»: причины взаимоисключающие, вес не теряется.
export type SettlementUnpaid = {
  itemId: number;
  actNumber: string | null;
  date: string | null;
  cultureName: string;
  color: string;
  reason: "no_line" | "foreign_line" | "no_weight";
  foreignLineId: number | null; // reason=foreign_line → строка вне листа (диагностика)
  actualKg: number | null;
  acceptedKg: number | null; // computeAcceptedKg — «принято по акту»
  unpaidKg: number; // оплачиваемый вес, оставшийся без строки листа
  partial: boolean; // часть партии оплачена и видна выше, в строке контракта
};

// Позиции БЕЗ акта приёмки — в расчёт не входят, но и «не пропали» (иначе машина,
// видимая на вкладке «Отгрузки», молча исчезает на «Расчётах»).
export type SettlementPending = {
  itemId: number;
  date: string | null;
  cultureName: string;
  color: string;
  // "accepted" здесь — аномалия данных (отгрузка принята, а акта у позиции нет).
  // Статус не фильтруем сознательно: позиция без акта не должна исчезать с листа
  // молча ни при каком статусе — ради этого секция и заведена.
  status: SheetItemStatus;
  plannedKg: number;
  actualKg: number | null;
};

export type FarmerSettlement = {
  farmer: { id: number; name: string };
  season: number;
  period: SettlementPeriod;
  generatedAt: string; // todayLocalISO() — НЕ new Date().toISOString()

  lines: SettlementLine[];

  totals: {
    countedKg: number; // Σ за период
    surchargeKg: number;
    paidKg: number;
    costRub: number;
    season: { countedKg: number; targetKg: number; pct: number };
  };

  unpaid: SettlementUnpaid[];
  unpaidTotals: { unpaidKg: number; positions: number };
  pending: SettlementPending[];

  // Флаги для подписей/предупреждений — считает ядро, UI только рисует.
  notes: {
    hasSurcharge: boolean; // есть доплата BR-33 → показывать колонку «Доплата»
    hasZeroPrice: boolean; // строка без цены: вес есть, сумма 0 — не дефект, но пометить
    undatedCount: number; // позиций без даты: в сезон входят, в узкое окно — никогда
    splitBatchCount: number; // партий, разложенных на >1 строку листа
  };
};

// --- Сборка ---

function addTo(map: Map<number, Prisma.Decimal>, key: number, kg: Prisma.Decimal) {
  map.set(key, (map.get(key) ?? ZERO).add(kg));
}

// Копия позиции, где отсутствующая строка заменена сентинелом. Для позиций СО строкой
// возвращает исходный exec — числа отображаемых строк листа sentinel не меняет никогда
// (ключ UNBOUND_LINE в lineMap не встречается), поэтому проход нужен только один.
function withSentinelLine(exec: ExecItem): ExecItem {
  if (exec.contractLineId != null) return exec;
  return { ...exec, contractLineId: UNBOUND_LINE };
}

// Σ % непринятых категорий (нестандарт + прочее «не в зачёт»). Для simple — 0:
// там «не в зачёт» это брак, он показывается отдельным полем.
function nonStandardPercentOf(exec: ExecItem): number {
  return exec.calibres.filter((c) => !c.isAccepted).reduce((s, c) => s + c.percent, 0);
}

export function buildSettlementSheet(input: {
  farmer: { id: number; name: string };
  season: number;
  period: SettlementPeriod;
  lines: SheetLine[];
  items: SheetItem[]; // УЖЕ отфильтрованы по сезону (как в getContractExecution)
  generatedAt: string;
}): FarmerSettlement {
  const { farmer, season, period, lines, items, generatedAt } = input;

  const lineById = new Map(lines.map((l) => [l.lineId, l]));

  // Разбор каждой принятой позиции: вклад в строки за период + за сезон + остаток без строки.
  type PerLine = { accepted: Prisma.Decimal; surcharge: Prisma.Decimal };
  const periodByLine = new Map<number, PerLine>();
  const seasonAcceptedByLine = new Map<number, Prisma.Decimal>();
  const batchesByLine = new Map<number, SettlementBatch[]>();
  const unpaid: SettlementUnpaid[] = [];
  const pending: SettlementPending[] = [];

  let undatedCount = 0;
  let splitBatchCount = 0;
  let hasSurcharge = false;

  for (const it of items) {
    if (it.exec == null) {
      // Акта нет → в расчёт не входит; показываем отдельным блоком «Ожидают приёмки».
      if (isInPeriod(it.date, period)) {
        pending.push({
          itemId: it.itemId,
          date: it.date,
          cultureName: it.cultureName,
          color: it.color,
          status: it.status,
          plannedKg: it.plannedKg,
          actualKg: null,
        });
      }
      continue;
    }

    const exec = it.exec;
    if (it.date == null) undatedCount += 1;

    const sentinel = withSentinelLine(exec);
    const acc = attributeAcceptedToLines([sentinel]);
    const sur = attributeSurchargeToLines([sentinel]);

    // Сезонный скоуп — по ВСЕМ позициям сезона (план строки от периода не зависит).
    for (const [lineId, kg] of acc) {
      if (lineById.has(lineId)) addTo(seasonAcceptedByLine, lineId, kg);
    }

    if (!isInPeriod(it.date, period)) continue;

    const actualKg = exec.actualKg?.toNumber() ?? null;
    const acceptedKg = computeAcceptedKg(actualKg, exec.brakPercent, exec.calibres);
    const positionBase = {
      actualKg,
      acceptedKg,
      acceptedPercent: computeAcceptedPercent(exec.brakPercent, exec.calibres),
      brakPercent: exec.brakPercent,
      nonStandardPercent: nonStandardPercentOf(exec),
    };

    // Ключи обеих карт — исчерпывающее разбиение оплачиваемого веса позиции.
    const keys = new Set<number>([...acc.keys(), ...sur.keys()]);
    const sheetKeys = [...keys].filter((k) => lineById.has(k));
    const linesCount = sheetKeys.length;
    if (linesCount > 1) splitBatchCount += 1;

    for (const lineId of sheetKeys) {
      const line = lineById.get(lineId)!;
      const countedKg = acc.get(lineId) ?? ZERO;
      const surchargeKg = sur.get(lineId) ?? ZERO;
      const exe = lineExecution(
        { volumeTons: line.volumeTons, price: line.price },
        countedKg,
        surchargeKg,
      );
      if (!surchargeKg.isZero()) hasSurcharge = true;

      const cur = periodByLine.get(lineId) ?? { accepted: ZERO, surcharge: ZERO };
      periodByLine.set(lineId, {
        accepted: cur.accepted.add(countedKg),
        surcharge: cur.surcharge.add(surchargeKg),
      });

      const list = batchesByLine.get(lineId) ?? [];
      list.push({
        itemId: it.itemId,
        actNumber: it.actNumber,
        date: it.date,
        cultureName: it.cultureName,
        color: it.color,
        countedKg: countedKg.toNumber(),
        surchargeKg: surchargeKg.toNumber(),
        paidKg: exe.paidKg.toNumber(),
        costRub: exe.cost.toNumber(),
        settlementPercent: exec.settlementPercent,
        position: { ...positionBase, linesCount },
      });
      batchesByLine.set(lineId, list);
    }

    // Остаток без строки листа: сентинел (строки нет) и чужие строки (другой сезон/контракт).
    for (const key of keys) {
      if (lineById.has(key)) continue;
      const unpaidKg = (acc.get(key) ?? ZERO).add(sur.get(key) ?? ZERO);
      if (unpaidKg.isZero()) continue;
      unpaid.push({
        itemId: it.itemId,
        actNumber: it.actNumber,
        date: it.date,
        cultureName: it.cultureName,
        color: it.color,
        reason: key === UNBOUND_LINE ? "no_line" : "foreign_line",
        foreignLineId: key === UNBOUND_LINE ? null : key,
        actualKg,
        acceptedKg,
        unpaidKg: unpaidKg.toNumber(),
        partial: linesCount > 0,
      });
    }

    // Акт есть, а перевески нет: позиция не даёт ни одного килограмма ни в одну строку
    // и без этой ветки исчезла бы с листа бесследно.
    if (actualKg == null && keys.size === 0) {
      unpaid.push({
        itemId: it.itemId,
        actNumber: it.actNumber,
        date: it.date,
        cultureName: it.cultureName,
        color: it.color,
        reason: "no_weight",
        foreignLineId: null,
        actualKg: null,
        acceptedKg: null,
        unpaidKg: 0,
        partial: false,
      });
    }
  }

  // Строки листа: периодные деньги + сезонное выполнение. lineExecution — одна и та же
  // функция для обоих скоупов, поэтому при period=сезон блоки тождественны.
  const sheetLines: SettlementLine[] = lines.map((l) => {
    const p = periodByLine.get(l.lineId) ?? { accepted: ZERO, surcharge: ZERO };
    const periodExec = lineExecution(
      { volumeTons: l.volumeTons, price: l.price },
      p.accepted,
      p.surcharge,
    );
    // Сезонный блок — БЕЗ доплаты: BR-33 в тонны выполнения не идёт.
    const seasonExec = lineExecution(
      { volumeTons: l.volumeTons, price: l.price },
      seasonAcceptedByLine.get(l.lineId) ?? ZERO,
    );
    return {
      lineId: l.lineId,
      contractId: l.contractId,
      cultureId: l.cultureId,
      cultureName: l.cultureName,
      color: l.color,
      label: l.label,
      pricePerKg: l.price.toNumber(),
      countedKg: periodExec.acceptedKg.toNumber(),
      surchargeKg: periodExec.surchargeKg.toNumber(),
      paidKg: periodExec.paidKg.toNumber(),
      costRub: periodExec.cost.toNumber(),
      season: {
        countedKg: seasonExec.acceptedKg.toNumber(),
        targetKg: seasonExec.targetKg.toNumber(),
        pct: seasonExec.pct.toNumber(),
        remainingKg: seasonExec.remainingKg.toNumber(),
      },
      batches: (batchesByLine.get(l.lineId) ?? []).sort(
        (a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.itemId - b.itemId,
      ),
    };
  });

  sheetLines.sort(
    (a, b) => a.cultureName.localeCompare(b.cultureName) || a.lineId - b.lineId,
  );

  const totals = sheetLines.reduce(
    (acc, l) => ({
      countedKg: acc.countedKg + l.countedKg,
      surchargeKg: acc.surchargeKg + l.surchargeKg,
      paidKg: acc.paidKg + l.paidKg,
      costRub: acc.costRub + l.costRub,
      seasonCountedKg: acc.seasonCountedKg + l.season.countedKg,
      seasonTargetKg: acc.seasonTargetKg + l.season.targetKg,
    }),
    { countedKg: 0, surchargeKg: 0, paidKg: 0, costRub: 0, seasonCountedKg: 0, seasonTargetKg: 0 },
  );

  const byDate = <T extends { date: string | null; itemId: number }>(a: T, b: T) =>
    (a.date ?? "").localeCompare(b.date ?? "") || a.itemId - b.itemId;

  return {
    farmer,
    season,
    period,
    generatedAt,
    lines: sheetLines,
    totals: {
      countedKg: totals.countedKg,
      surchargeKg: totals.surchargeKg,
      paidKg: totals.paidKg,
      costRub: totals.costRub,
      season: {
        countedKg: totals.seasonCountedKg,
        targetKg: totals.seasonTargetKg,
        // % выполнения — от ПРИНЯТОГО (доплата BR-33 в тонны не идёт), как sumFarmerTotal.
        pct:
          totals.seasonTargetKg > 0
            ? (totals.seasonCountedKg / totals.seasonTargetKg) * 100
            : 0,
      },
    },
    unpaid: unpaid.sort(byDate),
    unpaidTotals: {
      unpaidKg: unpaid.reduce((s, u) => s + u.unpaidKg, 0),
      positions: new Set(unpaid.map((u) => u.itemId)).size,
    },
    pending: pending.sort(byDate),
    notes: {
      hasSurcharge,
      hasZeroPrice: sheetLines.some((l) => l.pricePerKg === 0),
      undatedCount,
      splitBatchCount,
    },
  };
}
