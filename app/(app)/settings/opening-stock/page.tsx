import { getOpeningBalances } from "@/server/inventory/opening";
import { OpeningStockTabs } from "./_components/OpeningStockTabs";

// Настройки → «Начальные остатки»: setup-данные склада (DOMAIN §3, opening).
// Две вкладки: Тара (целое, шт) и Ингредиенты (Decimal, кг/л). Матрица каждой —
// Завод+фермеры × предметы; ячейка = текущий начальный остаток.
export default async function OpeningStockPage() {
  const [packaging, ingredient] = await Promise.all([
    getOpeningBalances("packaging"),
    getOpeningBalances("ingredient"),
  ]);

  return <OpeningStockTabs packaging={packaging} ingredient={ingredient} />;
}
