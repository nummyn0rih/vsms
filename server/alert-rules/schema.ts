import { z } from "zod";

// Единый источник валидации AlertRule (порог дефицита тары/ингредиента,
// DOMAIN.md §2). Форма и server actions. Сами алерты (сравнение с балансом) —
// V1.1; здесь только CRUD порогов.

export const ITEM_KIND_LABELS: Record<"packaging" | "ingredient", string> = {
  packaging: "Тара",
  ingredient: "Ингредиент",
};

// Сентинел «у любого фермера» в Select → location_scope = null.
export const LOCATION_ANY = "any";

// Завод как локация правила (ingredients-factory-source): для ингредиента бессмысленно —
// это внешний безлимитный источник, дефицита у него не бывает. В Select его и так нет,
// гард закрывает путь мимо формы.
export const FACTORY_SCOPE = "0";

// Поля item_id/location_scope приходят строкой из Select; threshold — строкой из
// Input. Числа/null резолвим в server actions (паттерн driver).
export const alertRuleSchema = z
  .object({
    item_kind: z.enum(["packaging", "ingredient"]),
    item_id: z.string().trim().min(1, "Выберите позицию"),
    location_scope: z.string(), // LOCATION_ANY или Farmer.id
    threshold: z
      .string()
      .trim()
      .min(1, "Укажите порог")
      .refine((v) => Number(v) > 0, "Порог должен быть больше 0"),
  })
  .superRefine((v, ctx) => {
    if (v.item_kind === "ingredient" && v.location_scope === FACTORY_SCOPE) {
      ctx.addIssue({
        code: "custom",
        path: ["location_scope"],
        message: "Завод — внешний источник ингредиентов, дефицита у него нет",
      });
    }
  });

export type AlertRuleInput = z.infer<typeof alertRuleSchema>;

// Вью-тип: soft-pointer item_id резолвится в имя по item_kind; location — в имя
// фермера либо «У любого фермера».
export type AlertRuleRow = {
  id: number;
  item_kind: "packaging" | "ingredient";
  item_id: number;
  item_name: string;
  location_scope: number | null;
  location_name: string;
  threshold: number;
};

export type ItemOption = { id: number; name: string };
export type FarmerOption = { id: number; name: string };
