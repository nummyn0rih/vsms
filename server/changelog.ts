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
  if (list.length === 0) return;

  await db.changeLog.createMany({
    data: list.map((e) => ({
      entity: e.entity,
      entity_id: e.entityId,
      field: e.field,
      old_value: e.oldValue ?? null,
      new_value: e.newValue ?? null,
      user_id: userId ?? null,
    })),
  });
}
