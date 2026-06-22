import { z } from "zod";

// Единый источник валидации MaterialShipment + MaterialShipmentItem (D3b): форма
// (zodResolver) и server actions (safeParse). Эталон — server/shipments/schema.ts.
// D3: только тара (item_kind=packaging), quantity задаётся явно (целое шт), без
// расчёта из нормы. Ингредиенты — этап E.

// Лимиты позиций рейса (как у отгрузки: 1 рейс = 1..4 позиции).
export const MIN_ITEMS = 1;
export const MAX_ITEMS = 4;

// Кол-во тары — целое > 0. Строкой (как Decimal в отгрузках): без coerce, чтобы
// не ломать типизацию RHF. Дробной тары не бывает.
const quantityPositiveInt = (msg: string) =>
  z
    .string()
    .trim()
    .min(1, msg)
    .refine((v) => {
      const n = Number(v.replace(",", "."));
      return Number.isInteger(n) && n > 0;
    }, msg);

export const materialItemSchema = z.object({
  farmer_id: z.string().trim().min(1, "Выберите фермера"),
  // В D3 навала нет — тип тары обязателен (item_kind всегда packaging).
  packaging_type_id: z.string().trim().min(1, "Выберите тип тары"),
  quantity: quantityPositiveInt("Количество должно быть целым числом больше 0"),
});

export type MaterialItemInput = z.infer<typeof materialItemSchema>;

export const materialShipmentSchema = z
  .object({
    // Водитель ОБЯЗАТЕЛЕН всегда (в отличие от Shipment, где опционален на planned):
    // MaterialShipment.driver_id NOT NULL в схеме.
    driver_id: z.string().trim().min(1, "Назначьте водителя"),
    departure_date: z.string().trim().min(1, "Укажите дату отправления"),
    arrival_date: z.string().trim().min(1, "Укажите дату прибытия"),
    items: z
      .array(materialItemSchema)
      .min(MIN_ITEMS, "Добавьте хотя бы одну позицию")
      .max(MAX_ITEMS, `Не больше ${MAX_ITEMS} позиций`),
  })
  .superRefine((val, ctx) => {
    // BR-12: departure <= arrival. Workday-проверку прибытия (BR-11) НЕ делаем —
    // рейс прибывает к фермеру, не на завод, день завода тут роли не играет.
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

export type MaterialShipmentInput = z.infer<typeof materialShipmentSchema>;

// --- View-типы для клиента (Decimal/Date → string) ---

export type MaterialItemRow = {
  id: number;
  farmer_id: number;
  farmer_name: string;
  packaging_type_id: number;
  packaging_type_name: string;
  packaging_kind: "box" | "barrel";
  capacity_kg: string | null; // справочное брутто (для подписи «· 250 кг»)
  quantity: string;
};

// Детализация для формы редактирования.
export type MaterialDetail = {
  id: number;
  status: "planned" | "sent" | "arrived";
  driver_id: number;
  departure_date: string | null;
  arrival_date: string | null;
  items: MaterialItemRow[];
};

// --- Опции Select'ов формы ---

export type MaterialDriverOption = {
  id: number;
  full_name: string;
  transport_company_name: string | null;
};
export type MaterialFarmerOption = { id: number; name: string };
export type MaterialPackagingOption = {
  id: number;
  name: string;
  kind: "box" | "barrel";
  capacity_kg: string | null;
};

export type MaterialOptions = {
  drivers: MaterialDriverOption[];
  farmers: MaterialFarmerOption[];
  packagingTypes: MaterialPackagingOption[];
};
