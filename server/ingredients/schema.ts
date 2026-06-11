import { z } from "zod";

// Единый источник валидации Ingredient: импортируется и формой (zodResolver),
// и server actions (safeParse). Не дублировать правила в двух местах.

// Человекочитаемые подписи enum. В БД храним сам enum (kg/l), в UI — подписи.
export const INGREDIENT_UNIT_LABELS: Record<"kg" | "l", string> = {
  kg: "кг",
  l: "л",
};

export const ingredientSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно"),
  unit: z.enum(["kg", "l"]),
});

export type IngredientInput = z.infer<typeof ingredientSchema>;

// Вью-тип для клиентских компонентов.
export type IngredientRow = {
  id: number;
  name: string;
  unit: "kg" | "l";
  active: boolean;
};
