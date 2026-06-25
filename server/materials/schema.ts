import { z } from "zod";

// Единый источник валидации MaterialShipment + MaterialShipmentItem (D3b/E1): форма
// (zodResolver) и server actions (safeParse). Эталон — server/shipments/schema.ts.
// E1: позиция полиморфна по item_kind — тара (packaging, quantity целое шт) ИЛИ
// ингредиент (ingredient, quantity Decimal>0, ед. l/kg). Ровно один FK по kind
// (зеркало CHECK БД). Смешанные kind в одном рейсе разрешены. UI ингредиентов — E2,
// поэтому item_kind по умолчанию "packaging" (текущая форма его не шлёт).

// Лимиты позиций рейса (как у отгрузки: 1 рейс = 1..4 позиции).
export const MIN_ITEMS = 1;
export const MAX_ITEMS = 10;

const isPositiveInt = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isInteger(n) && n > 0;
};
const isPositiveDecimal = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n > 0;
};

export const materialItemSchema = z
  .object({
    farmer_id: z.string().trim().min(1, "Выберите фермера"),
    // Опционально: текущая форма (E1) шлёт только тару без item_kind → undefined
    // трактуется как packaging. .default() НЕ используем — он расщепляет input/output
    // типы zod и ломает дженерики RHF (resolver input ≠ useForm output).
    item_kind: z.enum(["packaging", "ingredient"]).optional(),
    // Полиморфизм: ровно один FK по item_kind. Оба опциональны на уровне типа,
    // обязательность проверяется в superRefine по kind.
    packaging_type_id: z.string().trim().optional(),
    ingredient_id: z.string().trim().optional(),
    // Кол-во строкой (как Decimal в отгрузках): без coerce, чтобы не ломать RHF.
    quantity: z.string().trim().min(1, "Укажите количество"),
  })
  .superRefine((val, ctx) => {
    if (val.item_kind === "ingredient") {
      if (!val.ingredient_id || val.ingredient_id.trim() === "") {
        ctx.addIssue({ code: "custom", path: ["ingredient_id"], message: "Выберите ингредиент" });
      }
      if (val.packaging_type_id && val.packaging_type_id.trim() !== "") {
        ctx.addIssue({ code: "custom", path: ["packaging_type_id"], message: "Лишний тип тары для ингредиента" });
      }
      if (!isPositiveDecimal(val.quantity)) {
        ctx.addIssue({ code: "custom", path: ["quantity"], message: "Количество должно быть больше 0" });
      }
    } else {
      if (!val.packaging_type_id || val.packaging_type_id.trim() === "") {
        ctx.addIssue({ code: "custom", path: ["packaging_type_id"], message: "Выберите тип тары" });
      }
      if (val.ingredient_id && val.ingredient_id.trim() !== "") {
        ctx.addIssue({ code: "custom", path: ["ingredient_id"], message: "Лишний ингредиент для тары" });
      }
      if (!isPositiveInt(val.quantity)) {
        ctx.addIssue({ code: "custom", path: ["quantity"], message: "Количество должно быть целым числом больше 0" });
      }
    }
  });

export type MaterialItemInput = z.infer<typeof materialItemSchema>;

export const materialShipmentSchema = z
  .object({
    // Водитель ОБЯЗАТЕЛЕН всегда (в отличие от Shipment, где опционален на planned):
    // MaterialShipment.driver_id NOT NULL в схеме.
    driver_id: z.string().trim().min(1, "Назначьте водителя"),
    // transfer-1: источник переноса (FK-строка, как farmer_id). Пусто/undefined =
    // доставка с завода; задано = перенос ОТ этого фермера (транзит -3).
    source_farmer_id: z.string().trim().optional(),
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

    // Запрет дублей по группе (farmer × kind × FK). Леджер агрегирует движения по
    // (kind, FK, farmer) без ссылки на строку → две строки одной группы ломают
    // по-позиционное прибытие (markItem второй видит net>0 и пропускает плечо).
    // Бизнес-дубль = одна строка с суммой. Неполные строки пропускаем (их ловит
    // materialItemSchema), чтобы не дублировать ошибки.
    const seen = new Set<string>();
    val.items.forEach((it, i) => {
      const kind = it.item_kind ?? "packaging";
      const fk = kind === "ingredient" ? it.ingredient_id : it.packaging_type_id;
      if (!it.farmer_id || !fk || fk.trim() === "") return;
      const key = `${it.farmer_id}|${kind}|${fk}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, kind === "ingredient" ? "ingredient_id" : "packaging_type_id"],
          message: "Для этого фермера и типа груза позиция уже есть — объедините количество",
        });
      } else {
        seen.add(key);
      }
    });

    // transfer-1: если задан источник переноса — он должен быть валиден (>0), а каждый
    // получатель (farmer_id позиции) НЕ может совпадать с источником (self-transfer запрещён).
    const src = val.source_farmer_id?.trim();
    if (src) {
      if (!(Number(src) > 0)) {
        ctx.addIssue({
          code: "custom",
          path: ["source_farmer_id"],
          message: "Некорректный источник переноса",
        });
      }
      val.items.forEach((it, i) => {
        if (it.farmer_id && it.farmer_id.trim() === src) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "farmer_id"],
            message: "Получатель не может совпадать с источником переноса",
          });
        }
      });
    }
  });

export type MaterialShipmentInput = z.infer<typeof materialShipmentSchema>;

// --- View-типы для клиента (Decimal/Date → string) ---

export type MaterialItemRow = {
  id: number;
  farmer_id: number;
  farmer_name: string;
  item_kind: "packaging" | "ingredient";
  // Тара (item_kind=packaging) — иначе null.
  packaging_type_id: number | null;
  packaging_type_name: string | null;
  packaging_kind: "box" | "barrel" | null;
  capacity_kg: string | null; // справочное брутто (для подписи «· 250 кг»)
  // Ингредиент (item_kind=ingredient) — иначе null.
  ingredient_id: number | null;
  ingredient_name: string | null;
  ingredient_unit: "kg" | "l" | null;
  quantity: string;
  // D3-2a: дата прибытия позиции (ISO yyyy-mm-dd) или null = в пути.
  arrived_at: string | null;
};

// Детализация для формы редактирования.
export type MaterialDetail = {
  id: number;
  status: "planned" | "sent" | "arrived";
  driver_id: number;
  // transfer-1: источник переноса (null = доставка с завода) — для round-trip формы.
  source_farmer_id: number | null;
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
export type MaterialIngredientOption = {
  id: number;
  name: string;
  unit: "kg" | "l";
};

export type MaterialOptions = {
  drivers: MaterialDriverOption[];
  farmers: MaterialFarmerOption[];
  packagingTypes: MaterialPackagingOption[];
  ingredients: MaterialIngredientOption[];
};
