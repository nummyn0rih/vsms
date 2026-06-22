import { getOpeningBalances } from "@/server/inventory/opening";
import { OpeningStockMatrix } from "./_components/OpeningStockMatrix";

// Настройки → «Начальные остатки тары»: setup-данные склада (DOMAIN §3, opening).
// Матрица Завод+фермеры × типы тары; ячейка = текущий начальный остаток.
export default async function OpeningStockPage() {
  const { locations, types, values } = await getOpeningBalances();

  return (
    <OpeningStockMatrix locations={locations} types={types} values={values} />
  );
}
