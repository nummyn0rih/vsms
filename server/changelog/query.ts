import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth/session";

import { zonedDayRange } from "./labels";

// Чтение журнала изменений. Директивы "use server" здесь НЕТ намеренно: это
// read-загрузчик для серверного компонента, а не Server Action (эталон —
// server/farmers/settlement.ts, server/analytics/culture.ts).
//
// Соседний server/changelog.ts — ПИСАТЕЛЬ (logChange), его не трогаем: файл и
// одноимённая папка сосуществуют штатно ("@/server/changelog" резолвится в .ts,
// "@/server/changelog/query" — сюда).

export const CHANGELOG_PAGE_SIZE = 50;

export type ChangeLogRow = {
  id: number;
  timestamp: Date;
  entity: string;
  entityId: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  userId: number | null;
  userLogin: string | null; // null → правка сделана вне сессии («система»)
};

export type ChangeLogPage = {
  rows: ChangeLogRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type ChangeLogFilter = {
  entities?: string[];
  entityId?: number | null;
  userIds?: number[];
  includeSystem?: boolean; // записи с user_id = null
  from?: string | null; // YYYY-MM-DD, граница ВКЛЮЧИТЕЛЬНАЯ, местные сутки
  to?: string | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function buildWhere(p: ChangeLogFilter): Prisma.ChangeLogWhereInput {
  // Собираем через AND-массив, а не плоским объектом: и фильтр пользователя,
  // и поиск используют OR — на одном уровне они бы затёрли друг друга.
  const and: Prisma.ChangeLogWhereInput[] = [];

  if (p.entities?.length) and.push({ entity: { in: p.entities } });
  if (p.entityId != null) and.push({ entity_id: p.entityId });

  const userOr: Prisma.ChangeLogWhereInput[] = [];
  if (p.userIds?.length) userOr.push({ user_id: { in: p.userIds } });
  if (p.includeSystem) userOr.push({ user_id: null });
  if (userOr.length) and.push({ OR: userOr });

  // Границы — инстанты местных суток, а не UTC-полночь (см. zonedDayRange).
  const range = zonedDayRange(p.from, p.to);
  if (range.gte || range.lt) and.push({ timestamp: range });

  const q = p.q?.trim();
  if (q) {
    and.push({
      OR: [
        { field: { contains: q, mode: "insensitive" } },
        { old_value: { contains: q, mode: "insensitive" } },
        { new_value: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  return and.length ? { AND: and } : {};
}

/**
 * Страница журнала. Таблица append-only и растёт быстро — грузим только страницу,
 * никогда всё целиком.
 */
export async function getChangeLog(
  p: ChangeLogFilter = {},
): Promise<ChangeLogPage> {
  await requireRole("admin");

  const pageSize = clamp(Math.trunc(p.pageSize ?? CHANGELOG_PAGE_SIZE), 1, 200);
  const where = buildWhere(p);

  // count идёт ПЕРЕД выборкой (а не параллельно): без total нечем клампить номер
  // страницы, а ?page=999 в URL иначе отдал бы пустой экран без объяснения.
  const total = await prisma.changeLog.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = clamp(Math.trunc(p.page ?? 1) || 1, 1, pageCount);

  const rows = await prisma.changeLog.findMany({
    where,
    // id DESC — не украшение: внутри одной транзакции now() одинаков для всех строк,
    // а logChange пишет пачками, поэтому равные timestamp — штатный случай. Без второго
    // ключа порядок между страницами мог бы «плавать» и строки дублировались/терялись.
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      timestamp: true,
      entity: true,
      entity_id: true,
      field: true,
      old_value: true,
      new_value: true,
      user_id: true,
      user: { select: { login: true } },
    },
  });

  return {
    rows: rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      entity: r.entity,
      entityId: r.entity_id,
      field: r.field,
      oldValue: r.old_value,
      newValue: r.new_value,
      userId: r.user_id,
      userLogin: r.user?.login ?? null,
    })),
    total,
    page,
    pageSize,
    pageCount,
  };
}

/**
 * Опции фильтра «Пользователь». Отдаём всех (таблица User — единицы строк), включая
 * неактивных: автор давней правки мог быть уже архивирован, а его записи в журнале
 * остались и должны фильтроваться.
 */
export async function listChangeLogUsers(): Promise<
  { id: number; login: string }[]
> {
  await requireRole("admin");
  return prisma.user.findMany({
    select: { id: true, login: true },
    orderBy: { login: "asc" },
  });
}
