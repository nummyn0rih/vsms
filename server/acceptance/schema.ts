import { z } from "zod";

// B4b — перевеска. Вес фактической партии (actual_weight_kg). null = очистка
// (односторонний переход sent→arrived это не откатывает, см. actions.setActualWeight).
export const setActualWeightSchema = z.object({
  shipmentItemId: z.number().int().positive(),
  actualWeightKg: z
    .number()
    .positive("Вес должен быть больше 0")
    .nullable(),
});

export type SetActualWeightInput = z.infer<typeof setActualWeightSchema>;

export const markArrivedSchema = z.object({
  shipmentId: z.number().int().positive(),
});

// --- C1a. Акт приёмки позиции (simple). Принятый вес — производное (BR-10),
// не хранится; форма пишет № акта + % брака + привязку строки. Вес идёт через
// setActualWeight (один источник actual_weight_kg, BR-25). ---

// Категория калибра в сохранении акта. contractLineId null = без оплаты (нестандарт).
export const calibreEntrySchema = z.object({
  calibreRangeId: z.number().int().positive(),
  percent: z.number().min(0, "0–100%").max(100, "0–100%"),
  contractLineId: z.number().int().positive().nullable(),
});

// Путь (simple/calibre) определяется типом культуры на сервере — здесь оба поля
// опциональны, ветку проверяет saveAct по acceptance_type.
export const saveActSchema = z.object({
  shipmentItemId: z.number().int().positive(),
  actNumber: z.string().trim().min(1, "Укажите № акта"),
  brakPercent: z
    .number()
    .min(0, "Брак 0–100%")
    .max(100, "Брак 0–100%"),
  contractLineId: z.number().int().positive().optional(), // simple
  calibres: z.array(calibreEntrySchema).optional(), // calibre
});

export type SaveActInput = z.infer<typeof saveActSchema>;

export const revertActSchema = z.object({
  shipmentItemId: z.number().int().positive(),
});

// Контекст формы акта (client-импортируемый). Цены — string (Decimal сериализуем
// как строку), веса — number в кг.
export type ActContractLine = {
  id: number;
  label: string | null;
  pricePerKg: string;
};

// Категория схемы калибра культуры (для таблицы формы). minCm/maxCm — string|null
// (Decimal сериализуем строкой); оба null = безразмерная категория.
export type ActCalibreRange = {
  id: number;
  label: string;
  minCm: string | null;
  maxCm: string | null;
  isAccepted: boolean;
};

export type ActContext = {
  shipmentItemId: number;
  acceptanceType: "simple" | "calibre";
  cultureName: string;
  cultureColor: string;
  farmerName: string;
  machineCode: string;
  departureDate: string | null;
  driverName: string | null;
  transportCompanyName: string | null;
  machineStatus: "sent" | "arrived" | "accepted";
  actualKg: number | null;
  contractLines: ActContractLine[];
  autoLineId: number | null; // строк ровно одна — привязка авто (BR-8)
  isLastUnaccepted: boolean; // приёмка этой позиции примет машину целиком (BR-13)
  calibreRanges: ActCalibreRange[]; // категории схемы (пусто для simple)
  itemLineId: number | null; // ShipmentItem.contract_line_id — дефолт принятых категорий
  existing: {
    actNumber: string;
    brakPercent: number;
    contractLineId: number | null;
    calibres: {
      calibreRangeId: number;
      percent: number;
      contractLineId: number | null;
    }[];
  } | null;
};

// --- Типы доски приёмки (BR-26). Импортируются client-компонентами, поэтому без
// тяжёлых зависимостей (prisma тянет board.ts). Веса в КГ (number). ---

export type AcceptanceItem = {
  id: number;
  cultureName: string;
  color: string;
  farmerName: string;
  plannedKg: number;
  actualKg: number | null;
  accepted: boolean; // есть AcceptanceAct (BR-13: позиция принята)
  actNumber: string | null;
};

export type AcceptanceMachine = {
  id: number;
  code: string;
  status: "sent" | "arrived";
  departureDate: string | null;
  arrivalDate: string | null;
  driverName: string | null;
  transportCompanyName: string | null;
  driverPhone: string | null;
  driverInfo: string | null;
  comment: string | null;
  weighed: number; // позиций с введённым фактом
  acceptedCount: number; // позиций с актом (производная «Частично принята», BR-13)
  total: number; // всего позиций
  items: AcceptanceItem[];
};

// --- Зона 3 «Принято» (C3c). Принятый вес и стоимость — вычисляемые (BR-2/10/§5),
// ничего не хранится. Веса в КГ, цены/суммы в ₽ (number; округление — на показе). ---

// Чип калибр-разбивки. У принятых категорий показываем kg; у непринятых (нестандарт)
// и строки «брак» — пометку «не в зачёт». isBrak — последняя строка (percent=brak%).
export type AcceptedCalibreChip = {
  label: string; // «6–9 см» | «>12 см» | label безразмерной категории | «брак»
  percent: number;
  kg: number; // actual × percent/100
  isAccepted: boolean;
  isBrak?: boolean;
};

// Нестандарт со своей строкой контракта (is_accepted=false, contract_line_id != null):
// информационная подстрока, в принятый вес и стоимость НЕ идёт (решение по C3c).
export type AcceptedNonStandard = {
  label: string; // «Нестандарт {диапазон}»
  kg: number;
  lineLabel: string | null;
};

export type AcceptedPosition = {
  id: number; // shipmentItemId
  cultureName: string;
  color: string;
  farmerName: string;
  actNumber: string | null;
  actualKg: number;
  brakPercent: number;
  acceptedKg: number; // computeAcceptedKg (BR-10), к оплате
  calibres: AcceptedCalibreChip[]; // [] для simple; иначе категории + «брак» последней
  nonStandard: AcceptedNonStandard[]; // непринятые категории со своей строкой
  lineLabel: string | null; // строка контракта для футера (основная)
  pricePerKg: number | null; // цена основной строки (null → «× цена» не показываем)
  costRub: number; // itemCost (C3a)
};

export type AcceptedMachine = {
  id: number;
  code: string;
  departureDate: string | null;
  arrivalDate: string | null;
  driverName: string | null;
  transportCompanyName: string | null;
  driverPhone: string | null;
  driverInfo: string | null;
  acceptedCount: number; // принято позиций (= total, машина accepted)
  total: number;
  machineSumRub: number; // Σ costRub позиций
  positions: AcceptedPosition[];
};

export type AcceptanceBoard = {
  zone1: AcceptanceMachine[]; // sent — ожидают перевески
  zone2: AcceptanceMachine[]; // arrived — на приёмке
  zone3: AcceptedMachine[]; // accepted — принято (C3c)
  acceptedCount: number; // счётчик зоны 3 (= zone3.length)
};
