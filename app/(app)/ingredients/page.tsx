import { INGREDIENT_UNIT_LABELS } from "@/server/ingredients/schema";
import { listAlertRules } from "@/server/alert-rules/actions";
import { computeIngredientAlerts } from "@/server/alert-rules/alerts";
import {
  getIngredientBalances,
  getIngredientFactoryOutflow,
} from "@/server/inventory/balances";
import { DeficitPanel } from "@/components/inventory/DeficitPanel";
import { IngredientBalanceMatrix } from "./_components/IngredientBalanceMatrix";

// Decimal-форматирование для KPI (как в матрице): без округления, без trailing-нулей.
// Дублируем мелкий хелпер — page серверный, матрица клиентская.
function fmtQty(v: number): string {
  return v.toLocaleString("ru-RU", {
    maximumFractionDigits: 6,
  });
}

export default async function IngredientsPage() {
  const [data, rules, outflow] = await Promise.all([
    getIngredientBalances(),
    listAlertRules(),
    getIngredientFactoryOutflow(),
  ]);
  const alerts = computeIngredientAlerts(rules, data);

  // ingredients-factory-source: завод — внешний безлимитный источник, его остаток
  // не показываем. Вместо него — сколько с него забрали за сезон (нетто плеча
  // «завод → в пути», т.е. включая груз, который ещё едет).
  const takenMap = new Map(
    outflow.byIngredient.map((r) => [r.ingredientId, r.quantity]),
  );
  const taken = data.columns
    .map((c) => ({
      name: c.name,
      unit: c.unit,
      qty: takenMap.get(c.id) ?? 0,
    }))
    .filter((r) => r.qty !== 0);
  // «2026/27» — сезон июнь→май (BR-17).
  const seasonLabel = `${outflow.seasonYear}/${String(outflow.seasonYear + 1).slice(2)}`;

  return (
    <div className="w-full max-w-[1120px]">
      <div
        id="ingredients-page-head"
        className="sticky top-0 z-40 -mx-6 flex items-start gap-6 border-b bg-background px-6 py-4"
      >
        <div className="min-w-0 flex-1 basis-0">
          <h1 className="text-2xl font-semibold tracking-tight">Ингредиенты</h1>
          <p className="text-sm text-muted-foreground">
            Реальные остатки ингредиентов у поставщиков: начальный + поступило −
            расход в производство. Строка «в пути» — отправлено с завода, ещё не
            доставлено. Завод — внешний источник, его остаток не отслеживается.
            Read-only.
          </p>
        </div>
        {taken.length > 0 && (
          <div className="min-w-0 flex-1 basis-0 rounded-lg border bg-card px-4 py-3 shadow-sm">
            <div className="mb-1.5 text-[11px] text-muted-foreground">
              Забрано со склада · сезон {seasonLabel}
            </div>
            <div className="flex flex-wrap items-baseline gap-4">
              {taken.map((t) => (
                <span key={t.name} className="flex items-baseline gap-1.5">
                  <span className="text-xl font-semibold tabular-nums">
                    {fmtQty(t.qty)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t.name}, {INGREDIENT_UNIT_LABELS[t.unit]}
                  </span>
                </span>
              ))}
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              Включая груз в пути. Кг и л не суммируются — учёт по каждому
              ингредиенту раздельный.
            </div>
          </div>
        )}
      </div>

      <div className="pt-4 space-y-4">
        <DeficitPanel
          title="Дефицит ингредиентов"
          rows={alerts}
          footerNote="Индикатор не блокирует. Кг и л не суммируются — учёт по каждому ингредиенту раздельный."
        />
        <IngredientBalanceMatrix data={data} />
      </div>
    </div>
  );
}
