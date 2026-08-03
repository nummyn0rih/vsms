import { Prisma } from "@/lib/generated/prisma/client";

import type { ContractLineInput } from "./schema";

// Диф строк контракта для персиста и ChangeLog (BR-16: запись на КАЖДОЕ изменённое поле).
// Чистый модуль (без запросов в БД) — покрывается юнит-тестами; всё, что ходит в базу, в
// ./lines.ts. Эталон разделения — acceptance/act-diff.ts.
//
// Зачем диф, а не прежние deleteMany+createMany: на строку ссылаются ShipmentItem и
// CalibreResult (onDelete: Restrict). Пересоздание либо падало о FK, либо (будь ссылки
// nullable) осиротило бы привязки. ГЛАВНЫЙ ИНВАРИАНТ: id строки при правке НЕ меняется —
// сопоставляем before/after по id, а не по содержимому (BR-5 допускает две неотличимые
// строки одной культуры, различить их можно только id).

export const LINE_ENTITY = "ContractLine";

// Снимок «до» — из БД. label держим как в базе (string | null), а НЕ через `?? ""`, как в
// getContract: иначе метка «менялась бы» на каждом сохранении.
export type LineSnapshot = {
  id: number;
  culture_id: number;
  label: string | null;
  volume_tons: string;
  price_per_kg: string;
};

// Строка «после» — нормализованный вход формы. id = null → новая строка.
export type NormalizedLine = Omit<LineSnapshot, "id"> & { id: number | null };

export type LineField = "culture_id" | "label" | "volume_tons" | "price_per_kg";

export type LineChange = {
  field: LineField;
  oldValue: string | null;
  newValue: string | null;
};

export type LineUpdate = {
  id: number;
  before: LineSnapshot;
  after: NormalizedLine;
  changes: LineChange[]; // непустой: строки без изменений в updated не попадают
};

export type LinesDiff = {
  created: NormalizedLine[];
  updated: LineUpdate[];
  deleted: LineSnapshot[];
};

// Запись журнала без entity (его проставляет вызывающий) — форма ChangeEntry.
export type LineLogEntry = {
  entityId: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

/**
 * Канонический вид десятичной строки: "80,50" → "80.5", "100.000" → "100".
 *
 * Нужен для СРАВНЕНИЯ: из БД Decimal приходит уже нормализованным (Decimal(12,3) со
 * значением 100 отдаёт "100", не "100.000"), а форма пришлёт "100,00" или "100.0" —
 * наивное сравнение строк писало бы в журнал фиктивную правку цены при каждом сохранении.
 * Канонизируем самим Decimal, а не разбором строки: он и есть эталон нормализации.
 * Невалидное значение (zod его не пропустит) возвращаем как есть — диф не должен падать
 * на данных, которые всё равно отвергнет Prisma при записи.
 */
export function canonDecimal(raw: string): string {
  const s = raw.trim().replace(",", ".");
  try {
    return new Prisma.Decimal(s).toString();
  } catch {
    return s;
  }
}

// Вход формы → строка для сравнения и записи. label "" → null (в БД поле nullable).
// id: пусто/мусор → null, то есть «новая строка».
export function normalizeContractLine(line: ContractLineInput): NormalizedLine {
  const rawId = line.id?.trim();
  const id = rawId && /^\d+$/.test(rawId) ? Number(rawId) : 0;
  const label = line.label?.trim();
  return {
    id: id > 0 ? id : null,
    culture_id: Number(line.culture_id),
    label: label ? label : null,
    volume_tons: canonDecimal(line.volume_tons),
    price_per_kg: canonDecimal(line.price_per_kg),
  };
}

// Порядок полей в журнале фиксирован — чтобы записи одной правки читались одинаково.
const FIELD_ORDER: LineField[] = [
  "culture_id",
  "label",
  "volume_tons",
  "price_per_kg",
];

function fieldValue(
  l: { culture_id: number; label: string | null; volume_tons: string; price_per_kg: string },
  f: LineField,
): string | null {
  return f === "culture_id" ? String(l.culture_id) : l[f];
}

export function diffContractLines(
  before: LineSnapshot[],
  after: NormalizedLine[],
): LinesDiff {
  const byId = new Map(before.map((b) => [b.id, b]));
  const matched = new Set<number>();
  const created: NormalizedLine[] = [];
  const updated: LineUpdate[] = [];

  for (const a of after) {
    // id, которого нет среди строк ЭТОГО контракта (устаревшая вкладка, подделанный ввод),
    // и повтор уже сопоставленного id — считаем новой строкой. Так update/delete физически
    // не могут выйти за пределы контракта.
    const b = a.id != null && !matched.has(a.id) ? byId.get(a.id) : undefined;
    if (!b) {
      created.push({ ...a, id: null });
      continue;
    }
    matched.add(b.id);

    const changes: LineChange[] = [];
    for (const f of FIELD_ORDER) {
      const oldValue = fieldValue(b, f);
      const newValue = fieldValue(a, f);
      if (oldValue !== newValue) changes.push({ field: f, oldValue, newValue });
    }
    if (changes.length > 0) updated.push({ id: b.id, before: b, after: a, changes });
  }

  return { created, updated, deleted: before.filter((b) => !matched.has(b.id)) };
}

// ------------------------------------------------------------- тексты журнала

// Числа — по-русски (запятая), но БЕЗ округления: журнал цен обязан показывать ровно то,
// что записано. Intl не зовём (в тестах зависит от сборки Node), как в act-diff.
function fmtDec(s: string): string {
  return s.replace(".", ",");
}

type LineLike = {
  culture_id: number;
  label: string | null;
  volume_tons: string;
  price_per_kg: string;
};

/** «Огурцы · стандарт» или «Огурцы», если метки нет. Для сообщений об ошибке и журнала. */
export function formatLineTitle(
  l: Pick<LineLike, "culture_id" | "label">,
  cultureName: (id: number) => string,
): string {
  const name = cultureName(l.culture_id);
  return l.label ? `${name} · ${l.label}` : name;
}

/**
 * Состав строки для записей «добавлена»/«удалена»:
 * «Огурцы · стандарт · 80 т × 11 ₽/кг · контракт #12».
 * Номер контракта внутри значения — потому что после удаления строки её id никуда не ведёт,
 * а поиск журнала идёт по old_value/new_value (changelog/query.ts).
 */
export function formatLineComposition(
  l: LineLike,
  contractId: number,
  cultureName: (id: number) => string,
): string {
  return (
    `${formatLineTitle(l, cultureName)} · ${fmtDec(l.volume_tons)} т × ` +
    `${fmtDec(l.price_per_kg)} ₽/кг · контракт #${contractId}`
  );
}

// culture_id пишем ИМЕНЕМ культуры: formatValue журнала id справочников не резолвит, а
// «Культура: 3 → 7» нечитаемо. Остальные значения — с запятой; label как есть.
function logValue(
  field: LineField,
  value: string | null,
  cultureName: (id: number) => string,
): string | null {
  if (value == null) return null;
  if (field === "culture_id") return cultureName(Number(value));
  return field === "label" ? value : fmtDec(value);
}

/**
 * Записи ChangeLog по дифу: на update — по записи на КАЖДОЕ изменившееся поле, на
 * create/delete — одна запись с составом строки.
 * createdIds[i] соответствует diff.created[i] — персист создаёт строки по одной, в порядке
 * массива (createManyAndReturn не годится: порядок возврата Prisma не гарантирует).
 */
export function buildLineLogEntries(
  diff: LinesDiff,
  ctx: {
    contractId: number;
    createdIds: number[];
    cultureName: (id: number) => string;
  },
): LineLogEntry[] {
  const entries: LineLogEntry[] = [];

  for (const u of diff.updated) {
    for (const c of u.changes) {
      entries.push({
        entityId: u.id,
        field: c.field,
        oldValue: logValue(c.field, c.oldValue, ctx.cultureName),
        newValue: logValue(c.field, c.newValue, ctx.cultureName),
      });
    }
  }

  diff.created.forEach((l, i) => {
    const id = ctx.createdIds[i];
    if (id == null) return; // рассинхрон невозможен, но записи без entity_id быть не должно
    entries.push({
      entityId: id,
      field: "created",
      oldValue: null,
      newValue: formatLineComposition(l, ctx.contractId, ctx.cultureName),
    });
  });

  for (const l of diff.deleted) {
    entries.push({
      entityId: l.id,
      field: "deleted",
      oldValue: formatLineComposition(l, ctx.contractId, ctx.cultureName),
      newValue: null,
    });
  }

  return entries;
}
