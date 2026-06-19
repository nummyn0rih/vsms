// Типы дерева ленты (B3): сезон → неделя(ISO) → день → машина → позиция, плюс
// ЧИСТЫЕ подытоги weekSummary/daySummary. Модуль БЕЗ prisma — чтобы client-
// компоненты ленты могли импортировать типы и подытоги без затягивания pg/dns
// в бандл. Серверный загрузчик getFeed — отдельно в ./feed-loader (тянет БД).
//
// Вес — везде в КГ (number). Тоннаж в данных НЕ храним: клиент делит на 1000 и
// форматирует 1–2 знака (tabular-nums). Неделя/день — по дате ПРИБЫТИЯ
// (DESIGN §2, BR-17).

// --- Типы дерева ленты ---

export type FeedItem = {
  id: number;
  farmerId: number;
  farmerName: string;
  cultureId: number;
  cultureName: string;
  color: string;
  plannedKg: number;
  packagingTypeId: number | null;
  packagingTypeName: string | null;
  packagingKind: "box" | "barrel" | null; // вид тары для итогов по kind
  tareUnits: number | null; // null = навал ИЛИ нет нормы
  tareMissingNorm: boolean; // тип задан, нормы по тройке нет → UI «?»
  contractLineId: number | null;
  contractLineLabel: string | null;
};

export type FeedShipment = {
  id: number;
  code: string;
  status: "planned" | "sent" | "arrived" | "accepted";
  departureDate: string | null;
  arrivalDate: string | null;
  driverName: string | null;
  transportCompanyName: string | null;
  driverId: number | null;
  driverPhone: string | null;
  driverInfo: string | null;
  comment: string | null;
  createdAt: string;
  items: FeedItem[];
};

export type FeedDay = {
  date: string; // YYYY-MM-DD
  weekdayName: string;
  isWorkday: boolean;
  shipments: FeedShipment[]; // пусто допустимо (рабочий день без машин)
};

export type FeedWeek = {
  isoYear: number;
  isoWeek: number;
  startDate: string; // понедельник
  endDate: string; // воскресенье
  position: "past" | "current" | "future";
  days: FeedDay[];
};

export type Feed = {
  seasonYear: number;
  weeks: FeedWeek[];
};

// --- Подытоги (чистые) ---

export type CultureTotal = {
  cultureId: number;
  color: string;
  name: string;
  totalKg: number;
};

// Σ по культурам в стабильном порядке первого появления.
function sumCultures(items: FeedItem[]): { cultures: CultureTotal[]; totalKg: number } {
  const byCulture = new Map<number, CultureTotal>();
  let totalKg = 0;
  for (const it of items) {
    totalKg += it.plannedKg;
    const cur = byCulture.get(it.cultureId);
    if (cur) cur.totalKg += it.plannedKg;
    else
      byCulture.set(it.cultureId, {
        cultureId: it.cultureId,
        color: it.color,
        name: it.cultureName,
        totalKg: it.plannedKg,
      });
  }
  return { cultures: [...byCulture.values()], totalKg };
}

export function weekSummary(week: FeedWeek): {
  cultures: CultureTotal[];
  totalKg: number;
  machineCount: number;
} {
  const items: FeedItem[] = [];
  let machineCount = 0;
  for (const day of week.days) {
    machineCount += day.shipments.length;
    for (const s of day.shipments) items.push(...s.items);
  }
  return { ...sumCultures(items), machineCount };
}

export function daySummary(day: FeedDay): {
  cultures: CultureTotal[];
  totalKg: number;
  // Итоги тары агрегируются по виду (kind), а не по имени типа: все box → boxes,
  // все barrel → barrels (DESIGN §2). Рендер — через formatTareTotals.
  tare: { boxes: number; barrels: number };
  hasUnpricedTare: boolean;
} {
  const items = day.shipments.flatMap((s) => s.items);
  let boxes = 0;
  let barrels = 0;
  let hasUnpricedTare = false;
  for (const it of items) {
    if (it.tareMissingNorm) hasUnpricedTare = true;
    // Навал (tareUnits=null без флага) и «нет нормы» в сводку тары не входят.
    if (it.tareUnits != null && it.packagingKind) {
      if (it.packagingKind === "box") boxes += it.tareUnits;
      else if (it.packagingKind === "barrel") barrels += it.tareUnits;
    }
  }
  return {
    ...sumCultures(items),
    tare: { boxes, barrels },
    hasUnpricedTare,
  };
}
