import { z } from "zod";

// Единый источник валидации Shipment + ShipmentItem: форма (zodResolver) и server
// actions (safeParse). Эталон — server/contracts/schema.ts. Select-id и Decimal —
// строками (без coerce, чтобы не ломать типизацию RHF).

// Decimal-вес держим строкой (точность важна), проверяем «число > 0». Образец contracts.
const decimalPositive = (msg: string) =>
  z
    .string()
    .trim()
    .min(1, msg)
    .refine((v) => {
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) && n > 0;
    }, msg);

// Лимиты позиций машины (BR: 1 рейс = 1–4 позиции).
export const MIN_ITEMS = 1;
export const MAX_ITEMS = 4;

export const shipmentItemSchema = z.object({
  farmer_id: z.string().trim().min(1, "Выберите фермера"),
  culture_id: z.string().trim().min(1, "Выберите культуру"),
  planned_weight_kg: decimalPositive("Вес должен быть больше 0"),
  // Тип тары позиции (из разрешённых типов культуры). Пусто = навал. Серверная
  // валидация членства типа в культуре — в items.ts (B2.5).
  packaging_type_id: z.string().trim().optional(),
  // Привязка к строке контракта необязательна на planned (NOT NULL только при
  // accepted, BR-8 — этап C). BR-7 (своя культура+фермер) проверяется на сервере.
  contract_line_id: z.string().trim().optional(),
});

export type ShipmentItemInput = z.infer<typeof shipmentItemSchema>;

export const shipmentSchema = z
  .object({
    // Водитель опционален на planned (обязателен при переходе в sent, B2).
    driver_id: z.string().trim().optional(),
    // YYYY-MM-DD из <input type="date">. Клиент подставляет вторую дату (±2 дня),
    // на сервер приходят обе. Проверка рабочего дня (BR-11) — в actions (нужна БД).
    departure_date: z.string().trim().min(1, "Укажите дату отправления"),
    arrival_date: z.string().trim().min(1, "Укажите дату прибытия"),
    comment: z.string().trim().optional(),
    items: z
      .array(shipmentItemSchema)
      .min(MIN_ITEMS, "Добавьте хотя бы одну позицию")
      .max(MAX_ITEMS, `Не больше ${MAX_ITEMS} позиций`),
  })
  .superRefine((val, ctx) => {
    // BR-12: departure <= arrival (равенство допустимо — ручная правка могла сблизить).
    if (
      val.departure_date &&
      val.arrival_date &&
      val.departure_date > val.arrival_date
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["departure_date"],
        message: "Отправление не может быть позже прибытия",
      });
    }
  });

export type ShipmentInput = z.infer<typeof shipmentSchema>;

// --- View-типы для клиента (Decimal/Date → string) ---

export type ShipmentItemRow = {
  id: number;
  farmer_id: number;
  farmer_name: string;
  culture_id: number;
  culture_name: string;
  color: string;
  planned_weight_kg: string;
  packaging_type_id: number | null;
  packaging_type_name: string | null;
  contract_line_id: number | null;
  contract_line_label: string | null;
};

export type ShipmentListRow = {
  id: number;
  code: string;
  status: "planned" | "sent" | "arrived" | "accepted";
  departure_date: string | null; // YYYY-MM-DD
  arrival_date: string | null;
  driver_name: string | null;
  transport_company_name: string | null;
  comment: string | null;
  items: ShipmentItemRow[];
};

// Детализация для формы редактирования.
export type ShipmentDetail = {
  id: number;
  status: "planned" | "sent" | "arrived" | "accepted";
  driver_id: number | null;
  departure_date: string | null;
  arrival_date: string | null;
  comment: string;
  items: ShipmentItemRow[];
};

// --- Опции Select'ов формы ---

export type DriverOption = {
  id: number;
  full_name: string;
  transport_company_name: string | null;
};
export type FarmerOption = { id: number; name: string };
// Разрешённый тип тары культуры (для выбора в позиции отгрузки).
export type CulturePackagingOption = {
  id: number;
  name: string;
  is_default: boolean;
};
export type CultureOption = {
  id: number;
  name: string;
  color: string;
  packagingTypes: CulturePackagingOption[];
};

// Нетто-норма по тройке — клиент считает инфо-строку «≈ N тары» (сервер — источник истины).
export type PackagingNormOption = {
  farmer_id: number;
  culture_id: number;
  packaging_type_id: number;
  value: string;
};

// Строка контракта текущего сезона — клиент фильтрует по выбранным фермеру+культуре.
export type ContractLineOption = {
  id: number;
  farmer_id: number;
  culture_id: number;
  label: string | null;
  price_per_kg: string;
};

export type ShipmentOptions = {
  drivers: DriverOption[];
  farmers: FarmerOption[];
  cultures: CultureOption[];
  contractLines: ContractLineOption[];
  packagingNorms: PackagingNormOption[];
};

// --- Предпросмотр движений тары перед отправкой (B2, AlertDialog «Отправить») ---

// ok=false → отправка невозможна: либо нет водителя, либо нет норм по парам.
export type ShipmentTarePreview =
  | {
      ok: true;
      lines: { farmerName: string; packagingName: string; units: number }[];
    }
  | {
      ok: false;
      driverMissing: boolean;
      // «ИП Ковальчук × Томаты» — пары без нормы фасовки.
      missing: string[];
    };
