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
  actualKg: number | null; // факт перевески (B4b), null = ещё не взвешено
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

// Σ по культурам над набором машин (для чипов дня/недели — в т.ч. отфильтрованных
// на клиенте). Чистая, переиспользуется и сервером, и клиентским пересчётом (B6).
export function summarizeCultures(machines: FeedShipment[]): {
  cultures: CultureTotal[];
  totalKg: number;
} {
  return sumCultures(machines.flatMap((s) => s.items));
}

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

// --- Превью списания/возврата тары для диалогов статусов (чистое) ---

export type TarePreviewLine = {
  packagingTypeId: number;
  packagingName: string;
  kind: "box" | "barrel";
  units: number;
  cultures: { name: string; units: number }[]; // разбивка «Томаты 62 + Огурцы 41»
};

export type TarePreviewGroup = {
  farmerId: number;
  farmerName: string;
  lines: TarePreviewLine[]; // одна строка на тип тары у фермера
};

export type SendPreview = {
  groups: TarePreviewGroup[];
  totals: { boxes: number; barrels: number }; // → formatTareTotals
  computedPositions: number; // рассчитанные позиции (норма есть)
  totalTarePositions: number; // все позиции с тарой (навал исключён)
  farmersCount: number; // distinct фермеров среди рассчитанных
  missing: { cultureName: string; farmerName: string; packagingName: string }[];
};

// Группировка УЖЕ посчитанных сервером tareUnits по фермеру/типу тары для диалогов
// «Отправить»/«Откатить». Это агрегация (как summarizeCultures/daySummary), НЕ
// пересчёт тары: tareUnits приходит из feed-loader (плановый вес). Навал
// (packagingTypeId == null) и «нет нормы» в списания не идут.
export function buildSendPreview(items: FeedItem[]): SendPreview {
  const groupByFarmer = new Map<number, TarePreviewGroup>();
  const totals = { boxes: 0, barrels: 0 };
  const farmers = new Set<number>();
  const missing: SendPreview["missing"] = [];
  let computedPositions = 0;
  let totalTarePositions = 0;

  for (const it of items) {
    if (it.packagingTypeId == null) continue; // навал — без тары
    totalTarePositions += 1;

    if (it.tareMissingNorm || it.tareUnits == null || it.packagingKind == null) {
      if (it.tareMissingNorm) {
        missing.push({
          cultureName: it.cultureName,
          farmerName: it.farmerName,
          packagingName: it.packagingTypeName ?? "тара",
        });
      }
      continue;
    }

    computedPositions += 1;
    farmers.add(it.farmerId);
    if (it.packagingKind === "box") totals.boxes += it.tareUnits;
    else totals.barrels += it.tareUnits;

    let group = groupByFarmer.get(it.farmerId);
    if (!group) {
      group = { farmerId: it.farmerId, farmerName: it.farmerName, lines: [] };
      groupByFarmer.set(it.farmerId, group);
    }
    let line = group.lines.find((l) => l.packagingTypeId === it.packagingTypeId);
    if (!line) {
      line = {
        packagingTypeId: it.packagingTypeId,
        packagingName: it.packagingTypeName ?? "тара",
        kind: it.packagingKind,
        units: 0,
        cultures: [],
      };
      group.lines.push(line);
    }
    line.units += it.tareUnits;
    line.cultures.push({ name: it.cultureName, units: it.tareUnits });
  }

  return {
    groups: [...groupByFarmer.values()],
    totals,
    computedPositions,
    totalTarePositions,
    farmersCount: farmers.size,
    missing,
  };
}

export function weekSummary(week: FeedWeek): {
  cultures: CultureTotal[];
  totalKg: number;
  machineCount: number;
} {
  const machines = week.days.flatMap((d) => d.shipments);
  return { ...summarizeCultures(machines), machineCount: machines.length };
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
    ...summarizeCultures(day.shipments),
    tare: { boxes, barrels },
    hasUnpricedTare,
  };
}
