import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import type { ChangeEntry } from "@/server/changelog";

import type { ContractLineInput } from "./schema";
import {
  LINE_ENTITY,
  buildLineLogEntries,
  diffContractLines,
  formatLineTitle,
  normalizeContractLine,
  type LineSnapshot,
} from "./lines-diff";

// Персист строк контракта. Чистый (без "use server") — вызывается из create/updateContract
// внутри одной транзакции, чтобы контракт, его строки и записи журнала сохранялись
// атомарно (либо всё, либо ничего).
//
// НЕ пересоздаём набор (было deleteMany+createMany): на строку ссылаются ShipmentItem и
// CalibreResult с onDelete: Restrict — как только по контракту появилась приёмка, любое
// сохранение падало о FK. Теперь диф по id: сопоставление, точечные update, а удаление
// разрешено только для строк без ссылок. Сравнение и тексты — в ./lines-diff (юнит-тесты).

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// Доменная ошибка строк контракта (строка занята приёмкой). Ловится в action → адресное
// сообщение пользователю вместо общего «Не удалось сохранить». Эталон — ShipmentValidationError.
export class ContractLinesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractLinesError";
  }
}

export type PersistLinesResult = {
  entries: ChangeEntry[]; // готовые записи журнала — пишет вызывающий, одним logChange
  counts: { created: number; updated: number; deleted: number };
};

// Строки, на которые уже ссылается отгрузка или калибр акта. Две разные таблицы — одним
// запросом Prisma их не объединит; нужен факт использования, а не количество, поэтому
// distinct, а не groupBy с _count.
async function findReferencedLineIds(tx: Tx, ids: number[]): Promise<Set<number>> {
  const items = await tx.shipmentItem.findMany({
    where: { contract_line_id: { in: ids } },
    select: { contract_line_id: true },
    distinct: ["contract_line_id"],
  });
  const calibres = await tx.calibreResult.findMany({
    where: { contract_line_id: { in: ids } },
    select: { contract_line_id: true },
    distinct: ["contract_line_id"],
  });

  const used = new Set<number>();
  for (const r of [...items, ...calibres]) {
    if (r.contract_line_id != null) used.add(r.contract_line_id);
  }
  return used;
}

export async function persistContractLines(
  tx: Tx,
  contractId: number,
  lines: ContractLineInput[],
): Promise<PersistLinesResult> {
  // Снимок «до». label берём как в БД (string | null), НЕ через `?? ""` как getContract:
  // иначе метка «менялась бы» на каждом сохранении. Decimal.toString() уже канонический.
  const existing = await tx.contractLine.findMany({
    where: { contract_id: contractId },
    include: { culture: { select: { name: true } } },
    orderBy: { id: "asc" },
  });
  const before: LineSnapshot[] = existing.map((l) => ({
    id: l.id,
    culture_id: l.culture_id,
    label: l.label,
    volume_tons: l.volume_tons.toString(),
    price_per_kg: l.price_per_kg.toString(),
  }));

  const after = lines.map(normalizeContractLine);
  const diff = diffContractLines(before, after);

  // Имена культур для сообщений и журнала: старые — из include, новые (добавленная строка
  // или смена культуры) — одним запросом.
  const names = new Map(existing.map((l) => [l.culture_id, l.culture.name]));
  const unknown = [...new Set(after.map((a) => a.culture_id))].filter(
    (id) => !names.has(id),
  );
  if (unknown.length > 0) {
    const rows = await tx.culture.findMany({
      where: { id: { in: unknown } },
      select: { id: true, name: true },
    });
    for (const c of rows) names.set(c.id, c.name);
  }
  const cultureName = (id: number) => names.get(id) ?? String(id);

  // Гард ссылок — только для рискованных строк: удаляемых и меняющих культуру. Если таких
  // нет (обычный случай: правка цены/объёма), запросов не будет вовсе.
  const cultureChanged = diff.updated.filter((u) =>
    u.changes.some((c) => c.field === "culture_id"),
  );
  const risky = [...diff.deleted.map((d) => d.id), ...cultureChanged.map((u) => u.id)];
  if (risky.length > 0) {
    const used = await findReferencedLineIds(tx, risky);

    const blockedDelete = diff.deleted.filter((d) => used.has(d.id));
    if (blockedDelete.length > 0) {
      const titles = blockedDelete
        .map((d) => `«${formatLineTitle(d, cultureName)}»`)
        .join(", ");
      throw new ContractLinesError(
        `Строку ${titles} нельзя удалить: по ней уже есть отгрузки или принятые позиции. ` +
          `Измените её значения или оставьте как есть.`,
      );
    }

    // Смена культуры у занятой строки не ломает FK, но ломает смысл: позиция «Огурцы»
    // осталась бы привязанной к строке, ставшей «Томатами», и выполнение со стоимостью
    // разъехались бы молча (BR-7 — позиция и строка одной культуры).
    const blockedCulture = cultureChanged.filter((u) => used.has(u.id));
    if (blockedCulture.length > 0) {
      const titles = blockedCulture
        .map((u) => `«${formatLineTitle(u.before, cultureName)}»`)
        .join(", ");
      throw new ContractLinesError(
        `У строки ${titles} нельзя изменить культуру: по ней уже есть отгрузки или ` +
          `принятые позиции. Заведите новую строку с нужной культурой.`,
      );
    }
  }

  if (diff.deleted.length > 0) {
    const ids = diff.deleted.map((d) => d.id);
    // contract_id в условии — чтобы удаление не могло выйти за пределы контракта.
    const { count } = await tx.contractLine.deleteMany({
      where: { id: { in: ids }, contract_id: contractId },
    });
    if (count !== ids.length) {
      throw new ContractLinesError(
        "Строки контракта изменились в другом окне — откройте форму заново",
      );
    }
  }

  // Правки: только изменившиеся поля, id строки не трогаем (на нём держатся привязки).
  for (const u of diff.updated) {
    const changed = new Set(u.changes.map((c) => c.field));
    const data: Prisma.ContractLineUncheckedUpdateInput = {};
    if (changed.has("culture_id")) data.culture_id = u.after.culture_id;
    if (changed.has("label")) data.label = u.after.label;
    // Decimal передаём строкой — Prisma сохраняет точность.
    if (changed.has("volume_tons")) data.volume_tons = u.after.volume_tons;
    if (changed.has("price_per_kg")) data.price_per_kg = u.after.price_per_kg;
    await tx.contractLine.update({ where: { id: u.id }, data });
  }

  // Создаём ПО ОДНОЙ: нужны id для по-строчных записей журнала, а порядок возврата
  // createManyAndReturn Prisma не гарантирует — при двух неотличимых строках (BR-5)
  // сопоставить id с записью было бы нечем. Строк в контракте единицы.
  const createdIds: number[] = [];
  for (const l of diff.created) {
    const row = await tx.contractLine.create({
      data: {
        contract_id: contractId,
        culture_id: l.culture_id,
        label: l.label,
        volume_tons: l.volume_tons,
        price_per_kg: l.price_per_kg,
      },
      select: { id: true },
    });
    createdIds.push(row.id);
  }

  const entries = buildLineLogEntries(diff, {
    contractId,
    createdIds,
    cultureName,
  }).map((e) => ({ entity: LINE_ENTITY, ...e }));

  return {
    entries,
    counts: {
      created: diff.created.length,
      updated: diff.updated.length,
      deleted: diff.deleted.length,
    },
  };
}
