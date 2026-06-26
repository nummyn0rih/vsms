import type { CultureTotal, FeedShipment } from "@/server/shipments/feed";

// Типы вида «Доска» (B5-1). Чистый модуль (без prisma) — можно импортировать в
// client-компоненты. Карточка стоит в колонке дня своего arrival_date; колонки —
// рабочие дни недели (BR-18). Отправление = прибытие − 2 рабочих дня (computed).

export type BoardCard = {
  shipmentId: number;
  code: string;
  status: FeedShipment["status"];
  farmerName: string; // distinct фермеры машины: 1 → имя, иначе «имя +N»
  driverName: string | null;
  transportCompanyName: string | null;
  departureDate: string | null; // computed: arrival − 2 рабочих дня (не из БД)
  arrivalDate: string | null;
  cultures: CultureTotal[]; // чипы культур (цвет + плановый вес)
  tare: { boxes: number; barrels: number }; // итог тары машины (рассчитанные позиции)
  draggable: boolean; // status === "planned" (хват в B5-1, dnd в B5-1b)
};

export type BoardColumn = {
  dateISO: string;
  weekdayName: string; // полное имя дня (короткое — на клиенте)
  daySubtotalKg: number; // Σ плановых весов машин дня
  machineCount: number;
  cards: BoardCard[];
};

// Прогресс по культуре: Σ веса отгрузок недели (effective, BR-22) vs цель плана.
export type BoardProgress = {
  cultureId: number;
  name: string;
  color: string;
  plannedTons: number;
  targetTons: number;
};

export type BoardWeek = {
  seasonYear: number;
  isoYear: number;
  isoWeek: number;
  startDate: string;
  endDate: string;
  columns: BoardColumn[];
  progress: BoardProgress[]; // только культуры с целью (weekTarget != null)
  totalPlannedTons: number;
  totalTargetTons: number;
  hasPlan: boolean;
};
