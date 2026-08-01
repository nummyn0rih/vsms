"use server";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth/session";
import { zonedDayRange } from "@/server/changelog/labels";
import {
  aggregateFactoryOutflow,
  aggregateStockCells,
  listLedgerItemIds,
} from "@/server/inventory/cells";
import { summarizeIngredientLedger } from "@/server/inventory/ingredient-ledger";
import {
  FACTORY_LOCATION_ID,
  TRANSIT_TO_FACTORY,
  TRANSIT_TO_FARMER,
  TRANSFER_TRANSIT,
} from "@/server/shipments/packaging";
import {
  parseDateUTC,
  seasonYearOf,
  todayLocalISO,
} from "@/server/shipments/workdays";

// D4b: read-only витрина остатков тары (DOMAIN §3). Баланс НЕ хранится — это Σ
// движений по (локация, тип, состояние). Server-only loader + два action для
// дашборда. Гард — requireRole() (только аутентификация; роль не нужна, чтение под
// (app)-auth). Decimal → number на выходе (сериализуемо, целые на показе).

export type TareState = "good" | "scrap";

export type TareType = {
  id: number;
  name: string;
  kind: "box" | "barrel";
  capacityKg: number | null;
};

export type TareLocation = {
  id: number;
  name: string;
  kind: "factory" | "farmer" | "transit";
  inactive?: boolean;
};

export type TareCell = {
  locationId: number;
  packagingTypeId: number;
  state: TareState;
  quantity: number;
};

export type TareBalances = {
  types: TareType[];
  locations: TareLocation[];
  cells: TareCell[];
};

export type TareMovement = {
  date: string;
  chip: string;
  transit: boolean;
  fromName: string | null;
  toName: string | null;
  qty: number;
  srcKind: "ship" | "trip" | "inv";
  srcRef: string;
};

const FACTORY_NAME = "Завод";
const TRANSIT_TO_FACTORY_NAME = "В пути на завод";
const TRANSIT_TO_FARMER_NAME = "В пути с завода";
const TRANSFER_TRANSIT_NAME = "В пути между фермерами";

function isTransit(loc: number | null): boolean {
  return (
    loc === TRANSIT_TO_FACTORY ||
    loc === TRANSIT_TO_FARMER ||
    loc === TRANSFER_TRANSIT
  );
}

// itemIds — сужение выборки ДЛЯ АЛЕРТОВ (считать Σ только по типам, на которые есть
// порог). Матрица /packaging, доска и карточка поставщика зовут без аргумента и
// получают полную картину. На состав активных типов/фермеров фильтр не влияет.
export async function getTareBalances(itemIds?: number[]): Promise<TareBalances> {
  await requireRole();

  // Σ движений по (локация, тип, состояние) — агрегирует БД (audit-w4b, cells.ts).
  const [balances, ledgerTypeIds, activeTypes, activeFarmers] = await Promise.all([
    aggregateStockCells("packaging", itemIds),
    listLedgerItemIds("packaging", itemIds),
    prisma.packagingType.findMany({
      where: { active: true },
      select: { id: true, name: true, kind: true, capacity_kg: true },
      orderBy: { name: "asc" },
    }),
    prisma.farmer.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Типы: активные ∪ встреченные в движениях (деактивированные не теряем).
  const typeMap = new Map<number, TareType>(
    activeTypes.map((t) => [
      t.id,
      {
        id: t.id,
        name: t.name,
        kind: t.kind as "box" | "barrel",
        capacityKg: t.capacity_kg ? t.capacity_kg.toNumber() : null,
      },
    ]),
  );
  const extraTypeIds = ledgerTypeIds.filter((id) => !typeMap.has(id));
  if (extraTypeIds.length > 0) {
    const extra = await prisma.packagingType.findMany({
      where: { id: { in: extraTypeIds } },
      select: { id: true, name: true, kind: true, capacity_kg: true },
    });
    for (const t of extra) {
      typeMap.set(t.id, {
        id: t.id,
        name: t.name,
        kind: t.kind as "box" | "barrel",
        capacityKg: t.capacity_kg ? t.capacity_kg.toNumber() : null,
      });
    }
  }
  // Активные по имени (уже отсортированы) + «прочие» (деактивированные) по имени.
  const activeIds = new Set(activeTypes.map((t) => t.id));
  const types: TareType[] = [
    ...activeTypes.map((t) => typeMap.get(t.id)!),
    ...[...typeMap.values()]
      .filter((t) => !activeIds.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
  ];

  // Фермеры из движений с ненулевым балансом, но не активные (тара «застряла» у
  // soft-deleted фермера) — не теряем, помечаем inactive.
  const farmerBalIds = new Set<number>();
  for (const [k, v] of balances) {
    const loc = Number(k.split(":")[0]);
    if (loc > 0 && !v.isZero()) farmerBalIds.add(loc);
  }
  const activeFarmerIds = new Set(activeFarmers.map((f) => f.id));
  const extraFarmerIds = [...farmerBalIds].filter((id) => !activeFarmerIds.has(id));
  const extraFarmers =
    extraFarmerIds.length > 0
      ? await prisma.farmer.findMany({
          where: { id: { in: extraFarmerIds } },
          select: { id: true, name: true },
        })
      : [];

  // Транзит -3 показываем только при наличии переносов (иначе пустая строка в 95%
  // доставочных кейсов). -1/-2 — всегда (как было).
  const hasTransfer = [...balances].some(
    ([k, v]) => Number(k.split(":")[0]) === TRANSFER_TRANSIT && !v.isZero(),
  );

  const locations: TareLocation[] = [
    { id: FACTORY_LOCATION_ID, name: FACTORY_NAME, kind: "factory" },
    ...activeFarmers.map((f) => ({
      id: f.id,
      name: f.name,
      kind: "farmer" as const,
    })),
    ...extraFarmers
      .map((f) => ({
        id: f.id,
        name: f.name,
        kind: "farmer" as const,
        inactive: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    { id: TRANSIT_TO_FACTORY, name: TRANSIT_TO_FACTORY_NAME, kind: "transit" },
    { id: TRANSIT_TO_FARMER, name: TRANSIT_TO_FARMER_NAME, kind: "transit" },
    ...(hasTransfer
      ? [
          {
            id: TRANSFER_TRANSIT,
            name: TRANSFER_TRANSIT_NAME,
            kind: "transit" as const,
          },
        ]
      : []),
  ];

  const cells: TareCell[] = [];
  for (const [k, v] of balances) {
    if (v.isZero()) continue;
    const [loc, type, state] = k.split(":");
    cells.push({
      locationId: Number(loc),
      packagingTypeId: Number(type),
      state: state as TareState,
      quantity: v.toNumber(),
    });
  }
  // Порядок ячеек фиксируем: карточка поставщика (server/farmers/card.ts) строит
  // видимые списки прямо в порядке обхода cells, а порядок групп из БД не определён.
  cells.sort(
    (a, b) =>
      a.locationId - b.locationId ||
      a.packagingTypeId - b.packagingTypeId ||
      a.state.localeCompare(b.state),
  );

  return { types, locations, cells };
}

// Метка движения по типу + плечу. transit=true когда одна из сторон — сентинел.
// originFarmer — источник переноса рейса (для -3): from/to сами не различают
// «отправку» от «сторно прибытия» (оба фермер↔-3) — нужен якорь источника.
function chipFor(
  movementType: string,
  from: number | null,
  to: number | null,
  originFarmer: number | null = null,
): { chip: string; transit: boolean } {
  const transit = isTransit(from) || isTransit(to);
  switch (movementType) {
    case "opening":
      return { chip: "остаток на начало", transit: false };
    case "return":
      if (to === TRANSIT_TO_FACTORY) return { chip: "отгрузка", transit: true };
      if (from === TRANSIT_TO_FACTORY && to === FACTORY_LOCATION_ID)
        return { chip: "принято", transit: true };
      if (from === TRANSIT_TO_FACTORY) return { chip: "сторно отгрузки", transit: true };
      return { chip: "отгрузка", transit };
    case "delivery":
      // Перенос фермер→фермер: плечо через -3 (movement_type=delivery, как у -2).
      if (from === TRANSFER_TRANSIT || to === TRANSFER_TRANSIT) {
        if (to === TRANSFER_TRANSIT)
          return from === originFarmer
            ? { chip: "перенос: отправка", transit: true }
            : { chip: "перенос: сторно прибытия", transit: true };
        return to === originFarmer
          ? { chip: "перенос: сторно отправки", transit: true }
          : { chip: "перенос: прибытие", transit: true };
      }
      if (from === FACTORY_LOCATION_ID && to === TRANSIT_TO_FARMER)
        return { chip: "отправлено", transit: true };
      if (from === TRANSIT_TO_FARMER && to === FACTORY_LOCATION_ID)
        return { chip: "сторно отправки", transit: true };
      if (from === TRANSIT_TO_FARMER) return { chip: "доставка", transit: true };
      if (to === TRANSIT_TO_FARMER) return { chip: "сторно доставки", transit: true };
      return { chip: "доставка", transit };
    case "scrap":
      return { chip: "списание", transit: false };
    case "disposal":
      return { chip: "утилизация", transit: false };
    case "transfer":
      return { chip: "перемещение", transit };
    case "adjustment":
      return { chip: "коррекция", transit };
    default:
      return { chip: movementType, transit };
  }
}

// История движений ячейки (локация × тип × состояние) для drill-down. Знак qty —
// для ЭТОЙ ячейки. Источник (рейс/отгрузка/инвентаризация) — для метки.
export async function getTareMovements(
  locationId: number,
  packagingTypeId: number,
  state: TareState,
): Promise<TareMovement[]> {
  await requireRole();

  const rows = await prisma.stockMovement.findMany({
    where: {
      kind: "packaging",
      packaging_type_id: packagingTypeId,
      OR: [{ from_location_id: locationId }, { to_location_id: locationId }],
    },
    select: {
      date: true,
      quantity: true,
      from_location_id: true,
      to_location_id: true,
      from_state: true,
      to_state: true,
      movement_type: true,
      source_doc_type: true,
      source_doc_id: true,
    },
    orderBy: { date: "desc" },
  });

  // Включаем только движения, касающиеся (locationId, state); считаем знаковый qty.
  type Touched = (typeof rows)[number] & { signed: number };
  const touched: Touched[] = [];
  for (const m of rows) {
    let signed = 0;
    if (m.to_location_id === locationId && m.to_state === state)
      signed += m.quantity.toNumber();
    if (m.from_location_id === locationId && m.from_state === state)
      signed -= m.quantity.toNumber();
    if (signed === 0 && !(m.to_location_id === locationId && m.from_location_id === locationId))
      continue;
    touched.push({ ...m, signed });
  }

  // Батч-резолв имён фермеров (положительные локации) и кодов источников.
  const farmerIds = new Set<number>();
  const shipmentIds = new Set<number>();
  const materialIds = new Set<number>();
  for (const m of touched) {
    for (const loc of [m.from_location_id, m.to_location_id]) {
      if (loc != null && loc > 0) farmerIds.add(loc);
    }
    if (m.source_doc_id != null) {
      if (m.source_doc_type === "shipment") shipmentIds.add(m.source_doc_id);
      else if (m.source_doc_type === "material_shipment")
        materialIds.add(m.source_doc_id);
    }
  }
  const [farmers, shipments, materials] = await Promise.all([
    farmerIds.size > 0
      ? prisma.farmer.findMany({
          where: { id: { in: [...farmerIds] } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    shipmentIds.size > 0
      ? prisma.shipment.findMany({
          where: { id: { in: [...shipmentIds] } },
          select: { id: true, code: true },
        })
      : Promise.resolve([]),
    materialIds.size > 0
      ? prisma.materialShipment.findMany({
          where: { id: { in: [...materialIds] } },
          select: { id: true, code: true, source_farmer_id: true },
        })
      : Promise.resolve([]),
  ]);
  const farmerName = new Map(farmers.map((f) => [f.id, f.name]));
  const shipCode = new Map(shipments.map((s) => [s.id, s.code]));
  const tripCode = new Map(materials.map((s) => [s.id, s.code]));
  const srcFarmerByTrip = new Map(
    materials.map((s) => [s.id, s.source_farmer_id]),
  );

  const locName = (loc: number | null): string | null => {
    if (loc == null) return null;
    if (loc === FACTORY_LOCATION_ID) return FACTORY_NAME;
    if (loc === TRANSIT_TO_FACTORY) return TRANSIT_TO_FACTORY_NAME;
    if (loc === TRANSIT_TO_FARMER) return TRANSIT_TO_FARMER_NAME;
    if (loc === TRANSFER_TRANSIT) return TRANSFER_TRANSIT_NAME;
    return farmerName.get(loc) ?? `Фермер #${loc}`;
  };

  return touched.map((m) => {
    const originFarmer =
      m.source_doc_type === "material_shipment" && m.source_doc_id != null
        ? srcFarmerByTrip.get(m.source_doc_id) ?? null
        : null;
    const { chip, transit } = chipFor(
      m.movement_type,
      m.from_location_id,
      m.to_location_id,
      originFarmer,
    );
    let srcKind: TareMovement["srcKind"] = "inv";
    let srcRef = "Инвентаризация склада";
    if (m.source_doc_type === "shipment" && m.source_doc_id != null) {
      srcKind = "ship";
      srcRef = `Отгрузка ${shipCode.get(m.source_doc_id) ?? `#${m.source_doc_id}`}`;
    } else if (m.source_doc_type === "material_shipment" && m.source_doc_id != null) {
      srcKind = "trip";
      srcRef = `Рейс ${tripCode.get(m.source_doc_id) ?? `#${m.source_doc_id}`}`;
    }
    return {
      date: m.date.toISOString().slice(0, 10),
      chip,
      transit,
      fromName: locName(m.from_location_id),
      toName: locName(m.to_location_id),
      qty: m.signed,
      srcKind,
      srcRef,
    };
  });
}

// =====================================================================
// E4: витрина остатков ИНГРЕДИЕНТОВ — зеркало tare-функций выше, но проще:
// ингредиент всегда good (нет state/scrap), один транзит -2 (TRANSIT_TO_FARMER;
// -1 ингредиента не касается), колонки несут единицу (кг/л), количества —
// Decimal (микродозы, не округлять). Σ-агрегация — общая с тарой (cells.ts,
// audit-w4b), различие только в арности ключа (loc:ing вместо loc:type:state).
//
// ingredients-factory-source: у ингредиента завод — ВНЕШНИЙ БЕЗЛИМИТНЫЙ ИСТОЧНИК,
// а не локация (обратного потока нет: ингредиент уходит к фермеру и в производство).
// Поэтому локация 0 из витрины исключена — её «остаток» ничего не значит и уходит в
// минус по мере доставок. Транзит -2 остаётся: груз в дороге реален. Леджер не
// изменился, движения по-прежнему пишутся `0 → -2 → фермер` — скрыт только показ,
// решение обратимо. Тары это НЕ касается: там завод — полноценная локация (тара
// возвращается), getTareBalances не тронут.
// =====================================================================

export type IngredientCol = {
  id: number;
  name: string;
  unit: "kg" | "l";
};

// kind без "factory" (в отличие от TareLocation) — завод в ингредиентной витрине
// не локация, а внешний источник.
export type IngredientLocation = {
  id: number;
  name: string;
  kind: "farmer" | "transit";
  inactive?: boolean;
};

export type IngredientCell = {
  locationId: number;
  ingredientId: number;
  quantity: number;
};

export type IngredientBalances = {
  columns: IngredientCol[];
  locations: IngredientLocation[];
  cells: IngredientCell[];
};

export type IngredientMovement = {
  date: string;
  chip: string;
  transit: boolean;
  fromName: string | null;
  toName: string | null;
  qty: number;
  srcKind: "trip" | "act" | "inv";
  srcRef: string;
};

// Сводка над историей движений пары (локация × ингредиент): «остаток на начало ·
// поступило с завода · израсходовано в производство» (+ перенос между поставщиками,
// когда он есть). Считается ЧИСТОЙ функцией из тех же строк, что идут в список, —
// без второго запроса и второй свёртки. Decimal → number на выходе (сериализуемо).
export type IngredientLedgerTotals = {
  openingQty: number;
  receivedQty: number;
  transferNet: number;
  consumedQty: number;
  otherNet: number;
  balance: number;
};

export type IngredientLedger = {
  movements: IngredientMovement[];
  totals: IngredientLedgerTotals;
};

// «Забрано со склада» по ингредиентам за сезон — KPI /ingredients.
export type FactoryOutflow = {
  seasonYear: number;
  byIngredient: { ingredientId: number; quantity: number }[];
};

// itemIds — сужение выборки ДЛЯ АЛЕРТОВ (см. getTareBalances).
export async function getIngredientBalances(
  itemIds?: number[],
): Promise<IngredientBalances> {
  await requireRole();

  // Σ движений по (локация, ингредиент) — агрегирует БД (audit-w4b, cells.ts).
  const [balances, ledgerIngIds, activeIngredients, activeFarmers] = await Promise.all([
    aggregateStockCells("ingredient", itemIds),
    listLedgerItemIds("ingredient", itemIds),
    prisma.ingredient.findMany({
      where: { active: true },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
    prisma.farmer.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Колонки: активные ингредиенты ∪ встреченные в движениях (деактивированные не
  // теряем — дозагружаем по id), unit из БД.
  const colMap = new Map<number, IngredientCol>(
    activeIngredients.map((i) => [
      i.id,
      { id: i.id, name: i.name, unit: i.unit as "kg" | "l" },
    ]),
  );
  const extraIngIds = ledgerIngIds.filter((id) => !colMap.has(id));
  if (extraIngIds.length > 0) {
    const extra = await prisma.ingredient.findMany({
      where: { id: { in: extraIngIds } },
      select: { id: true, name: true, unit: true },
    });
    for (const i of extra) {
      colMap.set(i.id, { id: i.id, name: i.name, unit: i.unit as "kg" | "l" });
    }
  }
  const activeIngIds = new Set(activeIngredients.map((i) => i.id));
  const columns: IngredientCol[] = [
    ...activeIngredients.map((i) => colMap.get(i.id)!),
    ...[...colMap.values()]
      .filter((c) => !activeIngIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
  ];

  // Фермеры с ненулевым балансом, но не активные — не теряем, помечаем inactive.
  const farmerBalIds = new Set<number>();
  for (const [k, v] of balances) {
    const loc = Number(k.split(":")[0]);
    if (loc > 0 && !v.isZero()) farmerBalIds.add(loc);
  }
  const activeFarmerIds = new Set(activeFarmers.map((f) => f.id));
  const extraFarmerIds = [...farmerBalIds].filter((id) => !activeFarmerIds.has(id));
  const extraFarmers =
    extraFarmerIds.length > 0
      ? await prisma.farmer.findMany({
          where: { id: { in: extraFarmerIds } },
          select: { id: true, name: true },
        })
      : [];

  // Транзит -3 показываем только при наличии переносов (пустую строку прячем).
  const hasTransfer = [...balances].some(
    ([k, v]) => Number(k.split(":")[0]) === TRANSFER_TRANSIT && !v.isZero(),
  );

  // Завода в списке нет (см. шапку секции): он внешний источник, не локация.
  const locations: IngredientLocation[] = [
    ...activeFarmers.map((f) => ({
      id: f.id,
      name: f.name,
      kind: "farmer" as const,
    })),
    ...extraFarmers
      .map((f) => ({
        id: f.id,
        name: f.name,
        kind: "farmer" as const,
        inactive: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    // Транзит: -2 «В пути с завода» (доставка) + -3 «между фермерами» (перенос, по
    // наличию). Для ингредиента -1 не используется.
    { id: TRANSIT_TO_FARMER, name: TRANSIT_TO_FARMER_NAME, kind: "transit" },
    ...(hasTransfer
      ? [
          {
            id: TRANSFER_TRANSIT,
            name: TRANSFER_TRANSIT_NAME,
            kind: "transit" as const,
          },
        ]
      : []),
  ];

  const cells: IngredientCell[] = [];
  for (const [k, v] of balances) {
    if (v.isZero()) continue;
    const [loc, ing] = k.split(":");
    // Ячейки завода отбрасываем вместе с его строкой — иначе «Итого у поставщиков»
    // в матрице подмешало бы остаток источника.
    if (Number(loc) === FACTORY_LOCATION_ID) continue;
    cells.push({
      locationId: Number(loc),
      ingredientId: Number(ing),
      quantity: v.toNumber(),
    });
  }
  // Детерминированный порядок — см. комментарий в getTareBalances.
  cells.sort(
    (a, b) => a.locationId - b.locationId || a.ingredientId - b.ingredientId,
  );

  return { columns, locations, cells };
}

// Метка движения ингредиента. transit=true когда сторона = -2 или -3.
// originFarmer — источник переноса рейса (для -3, см. chipFor выше).
function chipForIngredient(
  movementType: string,
  from: number | null,
  to: number | null,
  originFarmer: number | null = null,
): { chip: string; transit: boolean } {
  switch (movementType) {
    case "opening":
      return { chip: "остаток на начало", transit: false };
    case "delivery":
      // Перенос фермер→фермер: плечо через -3 (movement_type=delivery, как у -2).
      if (from === TRANSFER_TRANSIT || to === TRANSFER_TRANSIT) {
        if (to === TRANSFER_TRANSIT)
          return from === originFarmer
            ? { chip: "перенос: отправка", transit: true }
            : { chip: "перенос: сторно прибытия", transit: true };
        return to === originFarmer
          ? { chip: "перенос: сторно отправки", transit: true }
          : { chip: "перенос: прибытие", transit: true };
      }
      if (from === FACTORY_LOCATION_ID && to === TRANSIT_TO_FARMER)
        return { chip: "отправлено", transit: true };
      if (from === TRANSIT_TO_FARMER && to === FACTORY_LOCATION_ID)
        return { chip: "сторно отправки", transit: true };
      if (from === TRANSIT_TO_FARMER) return { chip: "доставка", transit: true };
      if (to === TRANSIT_TO_FARMER) return { chip: "сторно доставки", transit: true };
      return { chip: "доставка", transit: false };
    case "consumption":
      // from=фермер, to=null → расход; реверс from=null, to=фермер → сторно.
      if (to == null) return { chip: "расход в производство", transit: false };
      return { chip: "сторно расхода", transit: false };
    default:
      return { chip: movementType, transit: false };
  }
}

// История движений ячейки (локация × ингредиент) для drill-down + сводка над ней.
// Знак qty — для ЭТОЙ локации (+to / −from). Источник (рейс/акт) — для метки.
// Сводка считается из УЖЕ загруженных строк (summarizeIngredientLedger) — лишнего
// обращения к БД нет.
export async function getIngredientMovements(
  locationId: number,
  ingredientId: number,
): Promise<IngredientLedger> {
  await requireRole();

  const rows = await prisma.stockMovement.findMany({
    where: {
      kind: "ingredient",
      ingredient_id: ingredientId,
      OR: [{ from_location_id: locationId }, { to_location_id: locationId }],
    },
    select: {
      date: true,
      quantity: true,
      from_location_id: true,
      to_location_id: true,
      movement_type: true,
      source_doc_type: true,
      source_doc_id: true,
    },
    orderBy: { date: "desc" },
  });

  // Знаковый qty для locationId (без state). Движения, не касающиеся locId, отсев
  // уже на уровне where; здесь только считаем знак.
  type Touched = (typeof rows)[number] & { signed: number };
  const touched: Touched[] = rows.map((m) => {
    let signed = 0;
    if (m.to_location_id === locationId) signed += m.quantity.toNumber();
    if (m.from_location_id === locationId) signed -= m.quantity.toNumber();
    return { ...m, signed };
  });

  // Батч-резолв имён фермеров и кодов источников.
  const farmerIds = new Set<number>();
  const tripIds = new Set<number>();
  const actIds = new Set<number>();
  for (const m of touched) {
    for (const loc of [m.from_location_id, m.to_location_id]) {
      if (loc != null && loc > 0) farmerIds.add(loc);
    }
    if (m.source_doc_id != null) {
      if (m.source_doc_type === "material_shipment") tripIds.add(m.source_doc_id);
      else if (m.source_doc_type === "acceptance_act") actIds.add(m.source_doc_id);
    }
  }
  const [farmers, trips, acts] = await Promise.all([
    farmerIds.size > 0
      ? prisma.farmer.findMany({
          where: { id: { in: [...farmerIds] } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    tripIds.size > 0
      ? prisma.materialShipment.findMany({
          where: { id: { in: [...tripIds] } },
          select: { id: true, code: true, source_farmer_id: true },
        })
      : Promise.resolve([]),
    actIds.size > 0
      ? prisma.acceptanceAct.findMany({
          where: { id: { in: [...actIds] } },
          select: { id: true, act_number: true },
        })
      : Promise.resolve([]),
  ]);
  const farmerName = new Map(farmers.map((f) => [f.id, f.name]));
  const tripCode = new Map(trips.map((t) => [t.id, t.code]));
  const actCode = new Map(acts.map((a) => [a.id, a.act_number]));
  const srcFarmerByTrip = new Map(
    trips.map((t) => [t.id, t.source_farmer_id]),
  );

  const locName = (loc: number | null): string | null => {
    if (loc == null) return null;
    if (loc === FACTORY_LOCATION_ID) return FACTORY_NAME;
    if (loc === TRANSIT_TO_FARMER) return TRANSIT_TO_FARMER_NAME;
    if (loc === TRANSFER_TRANSIT) return TRANSFER_TRANSIT_NAME;
    return farmerName.get(loc) ?? `Фермер #${loc}`;
  };

  const movements: IngredientMovement[] = touched.map((m) => {
    const originFarmer =
      m.source_doc_type === "material_shipment" && m.source_doc_id != null
        ? srcFarmerByTrip.get(m.source_doc_id) ?? null
        : null;
    const { chip, transit } = chipForIngredient(
      m.movement_type,
      m.from_location_id,
      m.to_location_id,
      originFarmer,
    );
    let srcKind: IngredientMovement["srcKind"] = "inv";
    let srcRef = "Инвентаризация склада";
    if (m.source_doc_type === "material_shipment" && m.source_doc_id != null) {
      srcKind = "trip";
      srcRef = `Рейс ${tripCode.get(m.source_doc_id) ?? `#${m.source_doc_id}`}`;
    } else if (m.source_doc_type === "acceptance_act" && m.source_doc_id != null) {
      srcKind = "act";
      srcRef = `Акт ${actCode.get(m.source_doc_id) ?? `#${m.source_doc_id}`}`;
    }
    return {
      date: m.date.toISOString().slice(0, 10),
      chip,
      transit,
      fromName: locName(m.from_location_id),
      toName: locName(m.to_location_id),
      qty: m.signed,
      srcKind,
      srcRef,
    };
  });

  // Сводка — из тех же rows (Decimal целы до самого конца), число только на выходе.
  const s = summarizeIngredientLedger(rows, locationId);
  return {
    movements,
    totals: {
      openingQty: s.openingQty.toNumber(),
      receivedQty: s.receivedQty.toNumber(),
      transferNet: s.transferNet.toNumber(),
      consumedQty: s.consumedQty.toNumber(),
      otherNet: s.otherNet.toNumber(),
      balance: s.balance.toNumber(),
    },
  };
}

/**
 * «Забрано со склада за сезон» — KPI /ingredients. Завод для ингредиентов внешний
 * безлимитный источник, поэтому показываем не его остаток, а исходящий поток.
 *
 * Сезон (BR-17) — июнь→май; StockMovement сезона не хранит, поэтому границы считаем
 * по `date`. Границы — ИНСТАНТЫ местных суток (zonedDayRange, FACTORY_TZ), а не
 * UTC-полночь: иначе движение, созданное 1 июня в 01:00 МСК, попало бы в прошлый
 * сезон. «Сегодня» — через todayLocalISO() по той же причине.
 */
export async function getIngredientFactoryOutflow(): Promise<FactoryOutflow> {
  await requireRole();

  const seasonYear = seasonYearOf(parseDateUTC(todayLocalISO()));
  const range = zonedDayRange(`${seasonYear}-06-01`, `${seasonYear + 1}-05-31`);
  const outflow = await aggregateFactoryOutflow(range);

  const byIngredient = [...outflow]
    .filter(([, qty]) => !qty.isZero())
    .map(([ingredientId, qty]) => ({
      ingredientId,
      quantity: qty.toNumber(),
    }))
    .sort((a, b) => a.ingredientId - b.ingredientId);

  return { seasonYear, byIngredient };
}
