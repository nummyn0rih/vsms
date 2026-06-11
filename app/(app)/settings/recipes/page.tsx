import {
  listCultureOptions,
  listIngredientOptions,
  listRecipesByCulture,
} from "@/server/recipes/actions";
import type { RecipeRow } from "@/server/recipes/schema";
import { RecipesManager } from "./_components/RecipesManager";

// searchParams в Next 16 — асинхронный. Выбранная культура живёт в URL (?culture),
// страница перезапрашивает строки рецепта на сервере при смене.
export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ culture?: string }>;
}) {
  const { culture } = await searchParams;
  const cultureId = culture ? Number(culture) : undefined;

  const [cultureOptions, ingredientOptions] = await Promise.all([
    listCultureOptions(),
    listIngredientOptions(),
  ]);

  const recipes: RecipeRow[] = cultureId
    ? await listRecipesByCulture(cultureId)
    : [];

  return (
    <RecipesManager
      cultureOptions={cultureOptions}
      ingredientOptions={ingredientOptions}
      selectedCultureId={cultureId}
      recipes={recipes}
    />
  );
}
