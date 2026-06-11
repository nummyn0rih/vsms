import { z } from "zod";

// Единый источник валидации IngredientRecipe (рецептура: пара культура×ингредиент
// → расход на кг продукции, DOMAIN.md §2). Форма и server actions.

export const recipeSchema = z.object({
  culture_id: z.coerce.number().int().positive("Выберите культуру"),
  ingredient_id: z.coerce.number().int().positive("Выберите ингредиент"),
  qty_per_kg_product: z.coerce
    .number()
    .positive("Расход должен быть больше 0"),
});

export type RecipeInput = z.infer<typeof recipeSchema>;

// Строка рецепта культуры с резолвом ингредиента (имя + ед. для подсказки).
export type RecipeRow = {
  id: number;
  ingredient_id: number;
  ingredient_name: string;
  ingredient_unit: "kg" | "l";
  qty_per_kg_product: number;
};

export type CultureOption = { id: number; name: string };
export type IngredientOption = { id: number; name: string; unit: "kg" | "l" };
