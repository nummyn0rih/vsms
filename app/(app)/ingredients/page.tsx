import { INGREDIENT_UNIT_LABELS } from "@/server/ingredients/schema";
import { getIngredientBalances } from "@/server/inventory/balances";
import { FACTORY_LOCATION_ID } from "@/server/shipments/packaging";
import { IngredientBalanceMatrix } from "./_components/IngredientBalanceMatrix";

// Decimal-форматирование для сводки завода (как в матрице): без округления, без
// trailing-нулей. Дублируем мелкий хелпер — page серверный, матрица клиентская.
function fmtQty(v: number): string {
  return v.toLocaleString("ru-RU", {
    maximumFractionDigits: 6,
  });
}

export default async function IngredientsPage() {
  const data = await getIngredientBalances();

  // Сводка завода (остаток по ингредиентам) — статична, считаем из cells.
  const factory = data.columns.map((c) => {
    const cell = data.cells.find(
      (x) => x.locationId === FACTORY_LOCATION_ID && x.ingredientId === c.id,
    );
    return { name: c.name, unit: c.unit, qty: cell ? cell.quantity : 0 };
  });

  return (
    <div className="w-full max-w-[1120px]">
      <div
        id="ingredients-page-head"
        className="sticky top-0 z-40 -mx-6 flex items-start gap-6 border-b bg-background px-6 py-4"
      >
        <div className="min-w-0 flex-1 basis-0">
          <h1 className="text-2xl font-semibold tracking-tight">Ингредиенты</h1>
          <p className="text-sm text-muted-foreground">
            Реальные остатки ингредиентов по локациям: начальный + доставлено −
            расход в производство. Строка «в пути» — отправлено с завода, ещё не
            доставлено. Read-only.
          </p>
        </div>
        {factory.length > 0 && (
          <div className="min-w-0 flex-1 basis-0 rounded-lg border bg-card px-4 py-3 shadow-sm">
            <div className="mb-1.5 text-[11px] text-muted-foreground">
              На заводе
            </div>
            <div className="flex flex-wrap items-baseline gap-4">
              {factory.map((f) => (
                <span key={f.name} className="flex items-baseline gap-1.5">
                  <span className="text-xl font-semibold tabular-nums">
                    {fmtQty(f.qty)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {f.name}, {INGREDIENT_UNIT_LABELS[f.unit]}
                  </span>
                </span>
              ))}
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              Кг и л не суммируются — учёт по каждому ингредиенту раздельный.
            </div>
          </div>
        )}
      </div>

      <div className="pt-4">
        <IngredientBalanceMatrix data={data} />
      </div>
    </div>
  );
}
