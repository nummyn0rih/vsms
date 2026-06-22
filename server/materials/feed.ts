// Типы дерева ленты материалов (D3b): сезон → неделя(ISO отправления) → рейс →
// позиция, плюс ЧИСТЫЕ подытоги по типам тары. Модуль БЕЗ prisma — чтобы client-
// компоненты ленты импортировали типы/подытоги без затягивания pg/dns в бандл.
// Загрузчик getMaterialShipments — отдельно в ./feed-loader. Неделя — по дате
// ОТПРАВЛЕНИЯ (рейс тары планируют от завода).

export type MaterialFeedItem = {
  id: number;
  farmerId: number;
  farmerName: string;
  packagingTypeId: number;
  packagingTypeName: string;
  packagingKind: "box" | "barrel";
  capacityKg: number | null; // справочное брутто (подпись «· 250 кг»)
  quantity: number; // шт (целое)
};

export type MaterialTrip = {
  id: number;
  code: string;
  status: "planned" | "sent" | "arrived";
  departureDate: string | null;
  arrivalDate: string | null;
  driverName: string | null;
  transportCompanyName: string | null;
  driverPhone: string | null;
  driverInfo: string | null;
  createdAt: string;
  items: MaterialFeedItem[];
};

export type MaterialWeek = {
  isoYear: number;
  isoWeek: number;
  startDate: string; // понедельник
  endDate: string; // воскресенье
  position: "past" | "current" | "future";
  trips: MaterialTrip[];
};

export type MaterialFeed = {
  seasonYear: number;
  weeks: MaterialWeek[];
};

// --- Подытоги по типам тары (динамические, без зашитых «ящики/бочки») ---

export type TypeTotal = {
  packagingTypeId: number;
  name: string;
  kind: "box" | "barrel";
  qty: number;
};

// Σ quantity по каждому ВСТРЕЧЕННОМУ типу тары (стабильный порядок первого
// появления). Итоги динамические — на любые типы рейса, не только box/barrel.
export function totalsByType(items: MaterialFeedItem[]): TypeTotal[] {
  const byType = new Map<number, TypeTotal>();
  for (const it of items) {
    const cur = byType.get(it.packagingTypeId);
    if (cur) cur.qty += it.quantity;
    else
      byType.set(it.packagingTypeId, {
        packagingTypeId: it.packagingTypeId,
        name: it.packagingTypeName,
        kind: it.packagingKind,
        qty: it.quantity,
      });
  }
  return [...byType.values()];
}

// Те же итоги по всем позициям рейсов недели (для чипов в шапке недели).
export function weekTotalsByType(trips: MaterialTrip[]): TypeTotal[] {
  return totalsByType(trips.flatMap((t) => t.items));
}
