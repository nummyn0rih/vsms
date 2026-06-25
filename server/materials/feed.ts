// Типы дерева ленты материалов (D3b): сезон → неделя(ISO отправления) → рейс →
// позиция, плюс ЧИСТЫЕ подытоги по типам тары. Модуль БЕЗ prisma — чтобы client-
// компоненты ленты импортировали типы/подытоги без затягивания pg/dns в бандл.
// Загрузчик getMaterialShipments — отдельно в ./feed-loader. Неделя — по дате
// ОТПРАВЛЕНИЯ (рейс тары планируют от завода).

// Позиция полиморфна по itemKind (E2): тара ИЛИ ингредиент. Packaging-поля
// заполнены только у тары (иначе null), ingredient-поля — только у ингредиента.
export type MaterialFeedItem = {
  id: number;
  farmerId: number;
  farmerName: string;
  itemKind: "packaging" | "ingredient";
  // Тара (itemKind=packaging) — иначе null.
  packagingTypeId: number | null;
  packagingTypeName: string | null;
  packagingKind: "box" | "barrel" | null;
  capacityKg: number | null; // справочное брутто (подпись «· 250 кг»)
  // Ингредиент (itemKind=ingredient) — иначе null.
  ingredientId: number | null;
  ingredientName: string | null;
  ingredientUnit: "kg" | "l" | null;
  quantity: number; // тара — шт (целое); ингредиент — Decimal в kg/l
  arrivedAt: string | null; // D3-2a: дата прибытия позиции (ISO) или null = в пути
};

export type MaterialTrip = {
  id: number;
  code: string;
  // status — сырой статус из БД (enum общий с отгрузками). Для отображения брать
  // derivedStatus: он добавляет "partial" (часть позиций прибыла) — в БД не хранится.
  status: "planned" | "sent" | "arrived";
  derivedStatus: "planned" | "sent" | "partial" | "arrived";
  arrivedCount: number; // позиций с arrived_at
  totalCount: number; // всего позиций
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
// появления). Только позиции тары (ингредиенты исключаются). Итоги динамические —
// на любые типы рейса, не только box/barrel.
export function totalsByType(items: MaterialFeedItem[]): TypeTotal[] {
  const byType = new Map<number, TypeTotal>();
  for (const it of items) {
    if (it.itemKind !== "packaging" || it.packagingTypeId == null) continue;
    const cur = byType.get(it.packagingTypeId);
    if (cur) cur.qty += it.quantity;
    else
      byType.set(it.packagingTypeId, {
        packagingTypeId: it.packagingTypeId,
        name: it.packagingTypeName ?? "тара",
        kind: it.packagingKind ?? "box",
        qty: it.quantity,
      });
  }
  return [...byType.values()];
}

// Те же итоги по всем позициям рейсов недели (для чипов в шапке недели).
export function weekTotalsByType(trips: MaterialTrip[]): TypeTotal[] {
  return totalsByType(trips.flatMap((t) => t.items));
}

// --- Подытоги ингредиентов ПО ИНГРЕДИЕНТУ (с именем; kg и l не смешиваются — у
// каждого ингредиента своя единица) ---

export type IngredientTotal = {
  ingredientId: number;
  name: string;
  unit: "kg" | "l";
  qty: number;
};

// Σ quantity по каждому встреченному ингредиенту (стабильный порядок первого
// появления). Единицы не складываются вместе: агрегат идёт по ингредиенту.
export function ingredientTotals(items: MaterialFeedItem[]): IngredientTotal[] {
  const byIng = new Map<number, IngredientTotal>();
  for (const it of items) {
    if (it.itemKind !== "ingredient" || it.ingredientId == null) continue;
    const cur = byIng.get(it.ingredientId);
    if (cur) cur.qty += it.quantity;
    else
      byIng.set(it.ingredientId, {
        ingredientId: it.ingredientId,
        name: it.ingredientName ?? "ингредиент",
        unit: it.ingredientUnit ?? "kg",
        qty: it.quantity,
      });
  }
  return [...byIng.values()];
}

// Те же итоги ингредиентов по всем рейсам недели (чипы в шапке недели).
export function weekIngredientTotals(trips: MaterialTrip[]): IngredientTotal[] {
  return ingredientTotals(trips.flatMap((t) => t.items));
}
