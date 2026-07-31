import { prisma } from "@/lib/prisma";

// Инфраструктура аудита (BR-16, этап A6). Пишет изменения в ChangeLog.
// Одна запись = одно поле (для update передаём диф несколькими записями).

export type ChangeEntry = {
  entity: string;
  entityId: number;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
};

// db по умолчанию = глобальный prisma; параметр оставлен для будущих транзакций ($transaction).
export async function logChange(
  entries: ChangeEntry | ChangeEntry[],
  userId?: number | null,
  db: Pick<typeof prisma, "changeLog"> = prisma,
) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) {
    // Часть вызовов легитимно пуста (диф отфильтрован до нуля), поэтому не бросаем —
    // но молчаливый пустой диф маскирует забытое заполнение entries (BR-16 требует
    // запись на КАЖДОЕ изменённое поле), так что след в логе оставляем. Вызывающего
    // берём из стека, чтобы не тащить лишний параметр через все call-site'ы.
    console.warn(
      "[logChange] пустой список entries — изменение не залогировано",
      new Error().stack?.split("\n")[2]?.trim() ?? "",
    );
    return;
  }

  const { count } = await db.changeLog.createMany({
    data: list.map((e) => ({
      entity: e.entity,
      entity_id: e.entityId,
      field: e.field,
      old_value: e.oldValue ?? null,
      new_value: e.newValue ?? null,
      user_id: userId ?? null,
    })),
  });

  // Правило 6 CLAUDE.md: сверять результат строками, а не отсутствием ошибки. Недозапись
  // оставила бы неполный аудит (BR-16) молча. Зовут нас всегда внутри $transaction
  // вызывающего → throw откатит и само изменение вместе с логом.
  if (count !== list.length) {
    throw new Error(
      `ChangeLog: записано ${count} из ${list.length} строк ` +
        `(${list[0].entity}#${list[0].entityId})`,
    );
  }
}
