import { t1, type XlsxRow, type XlsxSheet } from "@/lib/xlsx-export";
import type {
  FarmerSettlement,
  SettlementBatch,
  SettlementLine,
} from "@/server/farmers/settlement-agg";
import { PENDING_STATUS, UNPAID_REASON } from "@/server/farmers/settlement-labels";

// Книга Excel по расчётному листу фермера: те же числа, что на вкладке «Расчёты» и на
// печатном листе, из ТОГО ЖЕ пропа FarmerSettlement. Второй выборки и второй агрегации
// нет, поэтому файл сходится с экраном тождественно.
//
// ⚠ ФОРМУЛ ЗДЕСЬ НЕТ: каждое число берётся из data как есть, меняются только единица
// измерения (кг → т) и округление ОТОБРАЖЕНИЯ. Никакой арифметики поверх ядра.
//
// Правила чисел (Excel должен уметь считать по ячейкам, поэтому всё — числами):
//   тонны            → t1() (0,1 т, паритет с fmtTons и тремя существующими экспортами);
//   кг и ₽           → ТОЧНОЕ значение из data, без округления — Σ колонки «Сумма, ₽»
//                      по строкам уровня «строка» сходится с «Итого» в ноль;
//   % приёмки        → t1() (0,1 %, паритет с fmtPct1);
//   выполнение, %    → Math.round (паритет с ProgressCell и печатным листом);
//   корректировка, % → как есть (Decimal(5,2), экран и печать её не округляют);
//   пусто            → null (пустая ячейка, не «—» и не 0);
//   дата             → строка «ДД.ММ.ГГГГ» (числовая дата потребовала бы формата ячейки,
//                      чего хелпер не делает), № акта → строка (ведущие нули).
//
// ⚠ Набор колонок ФИКСИРОВАН и не зависит от notes.hasSurcharge/наличия корректировки
// (на экране и на бумаге колонки адаптивные). Иначе книга без «Доплаты» у одного фермера
// и с «Доплатой» у другого не сравнивается между собой. По той же причине все три листа
// создаются всегда, даже пустыми — только с шапкой.

const SHEET_SETTLEMENT = "Расчёт";
const SHEET_UNPAID = "Без привязки";
const SHEET_PENDING = "Ожидают приёмки";

// Уровень строки листа 1 — им же фильтруют в Excel: суммировать деньги можно только по
// одному уровню, иначе партии сложатся со своими же строками контракта.
const LEVEL_LINE = "строка";
const LEVEL_BATCH = "партия";
const LEVEL_TOTAL = "итого";

const COLUMNS_SETTLEMENT = [
  "Уровень",
  "Культура",
  "Строка",
  "Дата",
  "№ акта",
  "Цена, ₽/кг",
  "Заявлено, т",
  "Зачтено, т",
  "Доплата, кг",
  "К оплате, т",
  "Сумма, ₽",
  "Выполнение, %",
  "Корректировка, %",
  // Пять колонок ниже — контекст ПАРТИИ ЦЕЛИКОМ, см. предупреждение у batchRow.
  "Факт партии, кг",
  "Принято по акту, кг",
  "Нестандарт, %",
  "Брак, %",
  "Строк контракта у партии",
];

const COLUMNS_UNPAID = [
  "Дата",
  "№ акта",
  "Культура",
  "Причина",
  "Факт, кг",
  "Принято по акту, кг",
  "Не оплачивается, кг",
  "Часть партии оплачена",
];

const COLUMNS_PENDING = ["Дата", "Культура", "Статус", "План, кг", "Факт, кг"];

// Даты в БД — UTC-полночь; локальная зона сдвинула бы день. С годом, как на печатном
// листе: файл уходит наружу и живёт дольше сессии.
const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function fmtDate(d: string | null): string | null {
  return d ? dateFmt.format(new Date(`${d}T00:00:00Z`)) : null;
}

const tons = (kg: number) => t1(kg / 1000);

// Причина как на экране и на бумаге: словарь общий (settlement-labels.ts), номер чужой
// строки — диагностика, без него «строка другого контракта» не проверяема.
function unpaidReason(u: FarmerSettlement["unpaid"][number]): string {
  return UNPAID_REASON[u.reason] + (u.foreignLineId != null ? ` (#${u.foreignLineId})` : "");
}

function lineRow(l: SettlementLine): XlsxRow {
  return {
    "Уровень": LEVEL_LINE,
    "Культура": l.cultureName,
    "Строка": l.label || null,
    "Дата": null,
    "№ акта": null,
    "Цена, ₽/кг": l.pricePerKg,
    // «Заявлено» и «Выполнение» — ВСЕГДА за сезон (объём строки задан на сезон),
    // остальные величины строки — за выбранный период. Два скоупа в одной строке —
    // ровно как на экране, где это подписано в заголовках колонок.
    "Заявлено, т": tons(l.season.targetKg),
    "Зачтено, т": tons(l.countedKg),
    "Доплата, кг": l.surchargeKg > 0 ? l.surchargeKg : null,
    "К оплате, т": tons(l.paidKg),
    "Сумма, ₽": l.costRub,
    "Выполнение, %": Math.round(l.season.pct),
    "Корректировка, %": null,
    "Факт партии, кг": null,
    "Принято по акту, кг": null,
    "Нестандарт, %": null,
    "Брак, %": null,
    "Строк контракта у партии": null,
  };
}

function batchRow(l: SettlementLine, b: SettlementBatch): XlsxRow {
  const p = b.position;
  return {
    "Уровень": LEVEL_BATCH,
    // Культура и строка дублируются со строки контракта намеренно: после автофильтра
    // «Уровень = партия» иначе не видно, к чему партия относится.
    "Культура": b.cultureName,
    "Строка": l.label || null,
    "Дата": fmtDate(b.date),
    "№ акта": b.actNumber,
    // Цена, «Заявлено» и «Выполнение» у партии пусты: это величины строки контракта
    // (и сезонные), у партии их нет.
    "Цена, ₽/кг": null,
    "Заявлено, т": null,
    "Зачтено, т": tons(b.countedKg),
    "Доплата, кг": b.surchargeKg > 0 ? b.surchargeKg : null,
    "К оплате, т": tons(b.paidKg),
    "Сумма, ₽": b.costRub,
    "Выполнение, %": null,
    "Корректировка, %": b.settlementPercent,
    // ⚠ Следующие пять колонок — контекст ПАРТИИ ЦЕЛИКОМ (batch.position.*). При
    // linesCount > 1 партия попадает в несколько строк контракта, и эти значения в них
    // ПОВТОРЯЮТСЯ. Складывать их нельзя — в «Итого» они пусты, и это осознанно.
    // Подпись про деление партии несёт колонка «Строк контракта у партии».
    "Факт партии, кг": p.actualKg,
    "Принято по акту, кг": p.acceptedKg,
    "Нестандарт, %": p.nonStandardPercent > 0 ? t1(p.nonStandardPercent) : null,
    "Брак, %": p.brakPercent != null ? t1(p.brakPercent) : null,
    "Строк контракта у партии": p.linesCount,
  };
}

function totalRow(t: FarmerSettlement["totals"]): XlsxRow {
  return {
    "Уровень": LEVEL_TOTAL,
    "Культура": null,
    "Строка": null,
    "Дата": null,
    "№ акта": null,
    "Цена, ₽/кг": null,
    "Заявлено, т": tons(t.season.targetKg),
    "Зачтено, т": tons(t.countedKg),
    "Доплата, кг": t.surchargeKg > 0 ? t.surchargeKg : null,
    "К оплате, т": tons(t.paidKg),
    "Сумма, ₽": t.costRub,
    "Выполнение, %": Math.round(t.season.pct),
    "Корректировка, %": null,
    // Контекст партии в итог не суммируется — см. batchRow.
    "Факт партии, кг": null,
    "Принято по акту, кг": null,
    "Нестандарт, %": null,
    "Брак, %": null,
    "Строк контракта у партии": null,
  };
}

// Три листа книги. Порядок строк — из data (ядро уже отсортировало: строки по культуре,
// партии по дате); пересортировка здесь запрещена — она разошлась бы с экраном.
export function buildSettlementBook(d: FarmerSettlement): XlsxSheet[] {
  const settlement: XlsxRow[] = [];
  for (const l of d.lines) {
    settlement.push(lineRow(l));
    for (const b of l.batches) settlement.push(batchRow(l, b));
  }
  // Итог печатаем, только если есть что итожить: строка «итого» с нулями у поставщика
  // без строк контракта читается как сбой расчёта (то же правило, что на печати).
  if (d.lines.length > 0) settlement.push(totalRow(d.totals));

  const unpaid: XlsxRow[] = d.unpaid.map((u) => ({
    "Дата": fmtDate(u.date),
    "№ акта": u.actNumber,
    "Культура": u.cultureName,
    "Причина": unpaidReason(u),
    "Факт, кг": u.actualKg,
    "Принято по акту, кг": u.acceptedKg,
    "Не оплачивается, кг": u.unpaidKg,
    "Часть партии оплачена": u.partial ? "да" : null,
  }));
  if (d.unpaid.length > 0) {
    // Метка итога — в первой колонке (приём листов «План» и «Сводка»). Сумм в ₽ здесь
    // нет и быть не может: платить по этому весу не по чему — нет строки с ценой.
    unpaid.push({
      "Дата": "Итого",
      "№ акта": null,
      "Культура": null,
      "Причина": `${d.unpaidTotals.positions} поз.`,
      "Факт, кг": null,
      "Принято по акту, кг": null,
      "Не оплачивается, кг": d.unpaidTotals.unpaidKg,
      "Часть партии оплачена": null,
    });
  }

  const pending: XlsxRow[] = d.pending.map((p) => ({
    "Дата": fmtDate(p.date),
    "Культура": p.cultureName,
    "Статус": PENDING_STATUS[p.status],
    "План, кг": p.plannedKg,
    // Факт — свойство позиции, а не акта: у ожидающих приёмки он есть, если машину
    // уже перевесили (null — только пока не взвешена). Σ факта по листу не выводим:
    // перевеска позиционная, сумма занизила бы факт.
    "Факт, кг": p.actualKg,
  }));

  return [
    { rows: settlement, columns: COLUMNS_SETTLEMENT, sheetName: SHEET_SETTLEMENT },
    { rows: unpaid, columns: COLUMNS_UNPAID, sheetName: SHEET_UNPAID },
    { rows: pending, columns: COLUMNS_PENDING, sheetName: SHEET_PENDING },
  ];
}

// Запрещённые в путях символы (ориентир — Windows, он строже POSIX). Пробелы и точки
// схлопываем в дефис: «Иванов И. И.» → «Иванов-И-И», как в остальных именах выгрузок.
const FS_UNSAFE = /[\\/:*?"<>|]/g;

function safeSegment(s: string, fallback: string): string {
  const cleaned = s
    .replace(FS_UNSAFE, "")
    .replace(/[\s.]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

// ⚠ Период берётся из НОРМАЛИЗОВАННОГО data.period, а не из сырого URL: то же правило,
// что у settlementPrintHref — битый ?from= уже упал в «сезон», и имя файла обязано
// называть ровно тот период, который посчитан внутри.
export function settlementFileName(
  d: Pick<FarmerSettlement, "farmer" | "season" | "period">,
): string {
  const name = safeSegment(d.farmer.name, String(d.farmer.id));
  const p = d.period;
  const period =
    p.kind !== "season" && p.from != null && p.to != null ? `-${p.from}..${p.to}` : "";
  return `vsms-расчёт-${name}-${d.season}${period}.xlsx`;
}
