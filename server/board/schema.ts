import type { CultureTotal, FeedShipment } from "@/server/shipments/feed";

// Типы вида «Доска» (B5-1). Чистый модуль (без prisma) — можно импортировать в
// client-компоненты. Карточка стоит в колонке дня своего arrival_date; колонки —
// рабочие дни недели (BR-18). Отправление = прибытие − 2 рабочих дня (computed).

// Разбивка машины по фермерам — для строк .frows карточки-машины (B5-1b).
export type BoardFarmerRow = {
  farmerId: number;
  farmerName: string;
  cultureNames: string[]; // distinct культуры фермера в этом рейсе («Огурцы», «Перец»)
  totalKg: number; // Σ планового веса фермера
};

export type BoardCard = {
  shipmentId: number;
  code: string;
  status: FeedShipment["status"];
  farmers: BoardFarmerRow[]; // 1 → одно-фермерская карточка; >1 → карточка-машина
  driverName: string | null;
  transportCompanyName: string | null;
  departureDate: string | null; // computed: arrival − 2 рабочих дня (не из БД)
  arrivalDate: string | null;
  cultures: CultureTotal[]; // чипы культур (цвет + плановый вес), объединённые по машине
  tare: { boxes: number; barrels: number }; // итог тары машины (рассчитанные позиции)
  draggable: boolean; // planned || sent (sent — перенос только прибытия)
  arrivalOnly: boolean; // status === "sent": перенос меняет только дату прибытия
  locked: boolean; // status arrived|accepted: без переноса
};

export type BoardColumn = {
  dateISO: string;
  weekdayName: string; // полное имя дня (короткое — на клиенте)
  daySubtotalKg: number; // Σ плановых весов машин дня
  machineCount: number;
  addDepartureISO: string; // отправление новой отгрузки этого дня (приб − 2 раб. дня) для «+ Отгрузка»
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
