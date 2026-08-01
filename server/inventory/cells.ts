import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { FACTORY_LOCATION_ID } from "@/server/shipments/packaging";

// audit-w4b: Σ движений склада считает БД, а не JS. Баланс по-прежнему НЕ хранится
// (CLAUDE.md правило 2) — просто свёртка переехала из findMany-цикла в groupBy.
// Леджер append-only (откаты пишут нетто-сторно), поэтому тянуть его целиком на
// каждый расчёт становилось дороже весь сезон; groupBy отдаёт десятки строк.
//
// Модуль НЕ помечен "use server" сознательно: это внутренний примитив, а не Server
// Action. В balances.ts (там директива есть) он был бы обязан быть приватным, и его
// нельзя было бы сверить из scripts/w4b-balance-parity-verify.ts.

export type StockCellKind = "packaging" | "ingredient";

// Ключи ячеек — источник истины формата (balances.ts разбирает их через split(":")).
// Арность разная: у тары есть состояние (годная/лом), у ингредиента его нет.
export const cellKey = (loc: number, type: number, state: "good" | "scrap") =>
  `${loc}:${type}:${state}`;

export const ingCellKey = (loc: number, ing: number) => `${loc}:${ing}`;

// Фильтр по позициям пишется прямо в where: `itemIds ? { in: itemIds } : { not: null }`.
// Без фильтра — «все, где FK заполнен». Пустой массив даёт пустой результат (а не
// «все») — сужение должно быть явным, молчаливое расширение опаснее.

/**
 * Баланс ячеек = Σ движений: +quantity в (to_location, item, to_state), −quantity в
 * (from_location, item, from_state). Две groupBy-выборки на плечо, знаки и пропуск
 * null-сторон — 1:1 с прежней JS-свёрткой.
 *
 * Транзит-сентинелы (−1/−2/−3) НЕ отфильтровываются: это полноценные локации,
 * дашборды показывают их строками «В пути …».
 *
 * Считаем в Prisma.Decimal: quantity — Decimal(15,6), у ингредиентов бывают микродозы
 * (~0,00005). Приведение к number — только на выходе витрины, не здесь.
 */
export async function aggregateStockCells(
  kind: StockCellKind,
  itemIds?: number[],
): Promise<Map<string, Prisma.Decimal>> {
  const balances = new Map<string, Prisma.Decimal>();
  const add = (key: string, delta: Prisma.Decimal) => {
    balances.set(key, (balances.get(key) ?? new Prisma.Decimal(0)).plus(delta));
  };

  if (kind === "packaging") {
    // not: null на локации И состоянии — тот же гард, что был в JS
    // (`if (loc == null || type == null || state == null) return`): opening приходит
    // с from=null, disposal уходит с to=null — такое плечо в ячейку не пишется.
    const [inRows, outRows] = await Promise.all([
      prisma.stockMovement.groupBy({
        by: ["to_location_id", "packaging_type_id", "to_state"],
        where: {
          kind: "packaging",
          to_location_id: { not: null },
          to_state: { not: null },
          packaging_type_id: itemIds ? { in: itemIds } : { not: null },
        },
        _sum: { quantity: true },
      }),
      prisma.stockMovement.groupBy({
        by: ["from_location_id", "packaging_type_id", "from_state"],
        where: {
          kind: "packaging",
          from_location_id: { not: null },
          from_state: { not: null },
          packaging_type_id: itemIds ? { in: itemIds } : { not: null },
        },
        _sum: { quantity: true },
      }),
    ]);

    for (const r of inRows) {
      const q = r._sum.quantity;
      if (
        q == null ||
        r.to_location_id == null ||
        r.packaging_type_id == null ||
        r.to_state == null
      )
        continue;
      add(cellKey(r.to_location_id, r.packaging_type_id, r.to_state), q);
    }
    for (const r of outRows) {
      const q = r._sum.quantity;
      if (
        q == null ||
        r.from_location_id == null ||
        r.packaging_type_id == null ||
        r.from_state == null
      )
        continue;
      add(cellKey(r.from_location_id, r.packaging_type_id, r.from_state), q.neg());
    }
    return balances;
  }

  // Ингредиент: по состоянию НЕ группируем и не фильтруем — у него from_state/to_state
  // всегда null (DOMAIN §3), условие not:null отсекло бы весь леджер.
  const [inRows, outRows] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ["to_location_id", "ingredient_id"],
      where: {
        kind: "ingredient",
        to_location_id: { not: null },
        ingredient_id: itemIds ? { in: itemIds } : { not: null },
      },
      _sum: { quantity: true },
    }),
    prisma.stockMovement.groupBy({
      by: ["from_location_id", "ingredient_id"],
      where: {
        kind: "ingredient",
        from_location_id: { not: null },
        ingredient_id: itemIds ? { in: itemIds } : { not: null },
      },
      _sum: { quantity: true },
    }),
  ]);

  for (const r of inRows) {
    const q = r._sum.quantity;
    if (q == null || r.to_location_id == null || r.ingredient_id == null) continue;
    add(ingCellKey(r.to_location_id, r.ingredient_id), q);
  }
  for (const r of outRows) {
    const q = r._sum.quantity;
    if (q == null || r.from_location_id == null || r.ingredient_id == null) continue;
    add(ingCellKey(r.from_location_id, r.ingredient_id), q.neg());
  }
  return balances;
}

/**
 * ingredients-factory-source: сколько ингредиента УШЛО с завода за период («забрано
 * со склада»). Завод для ингредиентов — внешний безлимитный источник: его остаток не
 * показываем, но исходящий поток — ровно та цифра, которая нужна.
 *
 * База — плечо отправки `завод(0) → −2`, то есть груз считается забранным в момент
 * ухода со склада (включая то, что ещё в пути). Нетто: сторно отправки `−2 → 0`
 * вычитается — откаты append-only, гард «по существованию» дал бы завышение.
 *
 * `movement_type: "delivery"` обязателен: без него в цифру попал бы opening завода
 * (`null → 0`) и любые ручные правки — это остаток источника, а не отток.
 *
 * Механика та же, что у aggregateStockCells: две groupBy на плечо, Decimal, свёртка
 * в Map. Границы периода приходят инстантами (см. zonedDayRange) — считать их здесь
 * нельзя, это дело вызывающего.
 */
export async function aggregateFactoryOutflow(
  range: { gte?: Date; lt?: Date } = {},
): Promise<Map<number, Prisma.Decimal>> {
  const out = new Map<number, Prisma.Decimal>();
  const add = (ingredientId: number, delta: Prisma.Decimal) => {
    out.set(
      ingredientId,
      (out.get(ingredientId) ?? new Prisma.Decimal(0)).plus(delta),
    );
  };

  const dateFilter =
    range.gte != null || range.lt != null ? { date: range } : {};

  const [sentRows, revertedRows] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ["ingredient_id"],
      where: {
        kind: "ingredient",
        movement_type: "delivery",
        from_location_id: FACTORY_LOCATION_ID,
        ingredient_id: { not: null },
        ...dateFilter,
      },
      _sum: { quantity: true },
    }),
    prisma.stockMovement.groupBy({
      by: ["ingredient_id"],
      where: {
        kind: "ingredient",
        movement_type: "delivery",
        to_location_id: FACTORY_LOCATION_ID,
        ingredient_id: { not: null },
        ...dateFilter,
      },
      _sum: { quantity: true },
    }),
  ]);

  for (const r of sentRows) {
    const q = r._sum.quantity;
    if (q == null || r.ingredient_id == null) continue;
    add(r.ingredient_id, q);
  }
  for (const r of revertedRows) {
    const q = r._sum.quantity;
    if (q == null || r.ingredient_id == null) continue;
    add(r.ingredient_id, q.neg());
  }
  return out;
}

/**
 * Позиции, встречающиеся в леджере (distinct по FK). Витринам нужно, чтобы
 * ДЕАКТИВИРОВАННЫЙ тип тары / ингредиент не исчезал из колонок, если по нему были
 * движения.
 *
 * Отдельная выборка, а не объединение item_id из двух агрегаций выше: та дала бы
 * тот же ответ лишь при допущении «у каждого движения хотя бы одна сторона заполнена
 * полностью (локация + состояние)». Прежний JS-цикл считал по ВСЕМ строкам без такого
 * допущения; distinct по индексу [kind, <fk>] стоит столько же.
 */
export async function listLedgerItemIds(
  kind: StockCellKind,
  itemIds?: number[],
): Promise<number[]> {
  if (kind === "packaging") {
    const rows = await prisma.stockMovement.groupBy({
      by: ["packaging_type_id"],
      where: {
        kind: "packaging",
        packaging_type_id: itemIds ? { in: itemIds } : { not: null },
      },
    });
    return rows
      .map((r) => r.packaging_type_id)
      .filter((id): id is number => id != null);
  }
  const rows = await prisma.stockMovement.groupBy({
    by: ["ingredient_id"],
    where: {
      kind: "ingredient",
      ingredient_id: itemIds ? { in: itemIds } : { not: null },
    },
  });
  return rows.map((r) => r.ingredient_id).filter((id): id is number => id != null);
}
