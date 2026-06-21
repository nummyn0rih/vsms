import { Prisma } from "@/lib/generated/prisma/client";

// Расход ингредиентов на приёмке позиции (DOMAIN §3.4, BR-4): база = ФАКТИЧЕСКИЙ
// вес перевески (заложены в производство ДО браковки), НЕ accepted/planned.
// quantity = факт × расход-на-1-кг по рецептуре, округление ROUND_HALF_UP до 6 знаков.
// quantity<=0 — пропустить. Культура без рецептуры → пустой массив (акт без движений).
// Чистая функция (без БД) — расчёт переиспользуем и тестируем отдельно.
const SCALE = 6;

export function calcIngredientConsumption(
  actualWeightKg: Prisma.Decimal,
  recipe: { ingredientId: number; qtyPerKgProduct: Prisma.Decimal }[],
): { ingredientId: number; quantity: Prisma.Decimal }[] {
  return recipe
    .map((r) => ({
      ingredientId: r.ingredientId,
      quantity: actualWeightKg
        .mul(r.qtyPerKgProduct)
        .toDecimalPlaces(SCALE, Prisma.Decimal.ROUND_HALF_UP),
    }))
    .filter((m) => m.quantity.gt(0));
}
