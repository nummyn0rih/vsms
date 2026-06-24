"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlaskConical,
  Truck,
  FileText,
  Warehouse,
  Lock,
  X,
} from "lucide-react";

import { INGREDIENT_UNIT_LABELS } from "@/server/ingredients/schema";
import {
  getIngredientMovements,
  type IngredientBalances,
  type IngredientCol,
  type IngredientMovement,
} from "@/server/inventory/balances";

// E4: матрица остатков ингредиентов локация × ингредиент. Read-only, зеркало
// TareBalanceMatrix, но проще: нет состояния (good-only), один транзит -2,
// колонки несут единицу (кг/л), количества — Decimal (не округлять).

const OUTFLOW = "#9a5a12"; // приглушённый amber для отрицательных (зазор учёта)
const LOCATION_COL_W = 220; // ширина колонки «Локация»; остальные делят остаток поровну

type Props = { data: IngredientBalances };

type SelectedCell = {
  location: IngredientBalances["locations"][number];
  column: IngredientCol;
};

// Decimal-форматирование: дробные кг/л показываем как есть, без округления до
// целого; trailing-нули убираем (100 а не 100.000000, 0.00005 как есть). Тысячи
// разделяем неразрывным пробелом (50 000); микродозы (0,00005) это не затрагивает.
function fmtQty(v: number): string {
  const s = Math.abs(v).toLocaleString("ru-RU", {
    maximumFractionDigits: 6,
  });
  return v < 0 ? `−${s}` : s;
}

export function IngredientBalanceMatrix({ data }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [movements, setMovements] = useState<IngredientMovement[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Лукап баланса: `${loc}:${ing}` → qty.
  const balMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data.cells) {
      m.set(`${c.locationId}:${c.ingredientId}`, c.quantity);
    }
    return m;
  }, [data.cells]);

  const cellVal = useCallback(
    (loc: number, ing: number) => balMap.get(`${loc}:${ing}`) ?? 0,
    [balMap],
  );

  const factory = data.locations.find((l) => l.kind === "factory");
  const farmers = data.locations.filter((l) => l.kind === "farmer");
  const transit = data.locations.filter((l) => l.kind === "transit");

  const farmerIsZero = useCallback(
    (loc: number) => data.columns.every((c) => cellVal(loc, c.id) === 0),
    [data.columns, cellVal],
  );
  const visibleFarmers = showAll
    ? farmers
    : farmers.filter((f) => !farmerIsZero(f.id));
  const hiddenCount = farmers.length - visibleFarmers.length;

  // Итог колонки = Σ по всем локациям ПО ЭТОЙ колонке (единица колонки). Между
  // колонками НЕ суммируем — разные единицы (кг/л).
  const systemTotal = useCallback(
    (ing: number) =>
      data.locations.reduce((sum, l) => sum + cellVal(l.id, ing), 0),
    [data.locations, cellVal],
  );

  function openCell(location: SelectedCell["location"], column: IngredientCol) {
    if (cellVal(location.id, column.id) === 0) return;
    setSelected({ location, column });
    setMovements(null);
    setLoading(true);
    getIngredientMovements(location.id, column.id)
      .then((rows) => setMovements(rows))
      .finally(() => setLoading(false));
  }

  const closeDrawer = useCallback(() => setSelected(null), []);

  // Высота липкой шапки страницы → CSS-переменная для офсета липкой шапки таблицы.
  useEffect(() => {
    const head = document.getElementById("ingredients-page-head");
    if (!head) return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        "--ing-head-h",
        `${head.offsetHeight}px`,
      );
    });
    ro.observe(head);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--ing-head-h");
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, closeDrawer]);

  if (data.columns.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 px-6 py-14 text-center">
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-[10px] border bg-background text-muted-foreground">
          <FlaskConical className="size-5" />
        </div>
        <h3 className="mb-1.5 text-base font-semibold">Ингредиентов пока нет</h3>
        <p className="mx-auto max-w-[440px] text-sm text-muted-foreground">
          Добавьте ингредиенты в справочнике и задайте начальные остатки — баланс
          появится здесь как сумма движений.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* ----- тоггл всех фермеров ----- */}
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <label className={`toggle ml-auto${showAll ? " on" : ""}`}>
          <input
            type="checkbox"
            className="sr-only"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          <span className={`switch${showAll ? "" : " off"}`} />
          показать всех фермеров
          {hiddenCount > 0 && !showAll && (
            <span className="text-muted-foreground">({hiddenCount} скрыто)</span>
          )}
        </label>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Фермеры с нулевым остатком скрыты. Клик по ячейке — история движений.
      </p>

      <div className="rounded-lg border">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col style={{ width: LOCATION_COL_W }} />
            {data.columns.map((c) => (
              <col key={c.id} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className="sticky left-0 z-30 border-b border-r bg-muted px-4 py-3 text-left font-medium"
                style={{ top: "var(--ing-head-h, 0px)" }}
              >
                Локация
              </th>
              {data.columns.map((c) => (
                <th
                  key={c.id}
                  className="sticky z-20 border-b bg-muted px-4 py-3 text-right font-medium whitespace-nowrap"
                  style={{ top: "var(--ing-head-h, 0px)" }}
                >
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <FlaskConical className="size-3.5 text-muted-foreground" />
                      {c.name}
                    </span>
                    <span className="font-mono text-[11px] font-normal text-muted-foreground">
                      {INGREDIENT_UNIT_LABELS[c.unit]}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {factory && (
              <LocationRow
                location={factory}
                columns={data.columns}
                cellVal={cellVal}
                onOpen={openCell}
                emphasis
              />
            )}
            {visibleFarmers.map((f) => (
              <LocationRow
                key={f.id}
                location={f}
                columns={data.columns}
                cellVal={cellVal}
                onOpen={openCell}
              />
            ))}
            {transit.map((tr, i) => (
              <LocationRow
                key={tr.id}
                location={tr}
                columns={data.columns}
                cellVal={cellVal}
                onOpen={openCell}
                muted
                topBorder={i === 0}
              />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky left-0 z-10 border-t-2 bg-muted/60 px-4 py-3 text-left text-[13px] font-semibold">
                <span className="flex flex-col">
                  Итого в системе
                  <span className="text-[11px] font-normal text-muted-foreground">
                    живой остаток · учитывает расход
                  </span>
                </span>
              </th>
              {data.columns.map((c) => {
                const total = systemTotal(c.id);
                return (
                  <td
                    key={c.id}
                    className="border-t-2 bg-muted/60 px-4 py-3 text-right font-mono text-[15px] font-semibold tabular-nums"
                    style={total < 0 ? { color: OUTFLOW } : undefined}
                  >
                    {fmtQty(total)}
                    <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">
                      {INGREDIENT_UNIT_LABELS[c.unit]}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      <Legend />

      <Drawer
        selected={selected}
        balance={
          selected ? cellVal(selected.location.id, selected.column.id) : 0
        }
        movements={movements}
        loading={loading}
        onClose={closeDrawer}
      />
    </div>
  );
}

// ---------- строка локации ----------
function LocationRow({
  location,
  columns,
  cellVal,
  onOpen,
  emphasis,
  muted,
  topBorder,
}: {
  location: IngredientBalances["locations"][number];
  columns: IngredientCol[];
  cellVal: (loc: number, ing: number) => number;
  onOpen: (loc: IngredientBalances["locations"][number], col: IngredientCol) => void;
  emphasis?: boolean;
  muted?: boolean;
  topBorder?: boolean;
}) {
  const rowBg = emphasis ? "bg-muted/40" : "";
  const top = topBorder ? "border-t-2" : "";
  return (
    <tr className="group">
      <th
        className={`sticky left-0 z-10 border-b border-r bg-background px-4 text-left font-medium whitespace-nowrap group-hover:bg-muted/30 ${rowBg} ${top}`}
        style={{ height: 52 }}
      >
        <span className="flex items-center gap-2">
          {location.kind === "transit" && (
            <Truck className="size-3.5 text-muted-foreground" />
          )}
          {location.kind === "factory" ? (
            <span className="flex items-center gap-2">
              <span className="rounded border bg-background px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                завод
              </span>
              МКЗ
            </span>
          ) : (
            <span className={muted ? "text-muted-foreground" : ""}>
              {location.name}
            </span>
          )}
          {location.inactive && (
            <span className="text-[10px] text-muted-foreground">(архив)</span>
          )}
        </span>
      </th>
      {columns.map((c) => {
        const v = cellVal(location.id, c.id);
        const zero = v === 0;
        return (
          <td
            key={c.id}
            className={`border-b p-0 group-hover:bg-muted/30 ${rowBg} ${top}`}
          >
            <button
              type="button"
              disabled={zero}
              onClick={() => onOpen(location, c)}
              className={`flex h-[52px] w-full items-center justify-end gap-1 px-4 font-mono tabular-nums ${
                zero
                  ? "cursor-default text-muted-foreground/50"
                  : "cursor-pointer hover:bg-foreground/5"
              }`}
            >
              <span
                className="text-[15px] font-medium"
                style={v < 0 ? { color: OUTFLOW } : undefined}
              >
                {zero ? "—" : fmtQty(v)}
              </span>
              {!zero && (
                <span className="font-sans text-xs text-muted-foreground">
                  {INGREDIENT_UNIT_LABELS[c.unit]}
                </span>
              )}
            </button>
          </td>
        );
      })}
    </tr>
  );
}

// ---------- легенда ----------
function Legend() {
  return (
    <div className="mt-4 max-w-[760px] rounded-lg border bg-muted/30 px-4 py-3.5 text-[13px] leading-5 text-muted-foreground">
      <p>
        <span className="font-semibold text-foreground">Завод / Фермер</span> —
        реальный остаток ингредиента на руках (начальный + доставлено − расход).
      </p>
      <p className="mt-2">
        <span className="font-semibold text-foreground">В пути с завода</span> —
        ингредиент отправлен, но ещё не доставлен фермеру.
      </p>
      <p className="mt-2 border-t border-dashed pt-2.5">
        Отрицательный остаток у фермера — временный зазор учёта: расход отмечен
        раньше прибытия доставки.{" "}
        <span className="font-medium text-foreground">«Итого в системе»</span> по
        колонке — живой остаток (учитывает расход в производство); может быть
        меньше начального. Единицы (кг/л) между колонками не складываются.
      </p>
    </div>
  );
}

// ---------- drawer ----------
function Drawer({
  selected,
  balance,
  movements,
  loading,
  onClose,
}: {
  selected: SelectedCell | null;
  balance: number;
  movements: IngredientMovement[] | null;
  loading: boolean;
  onClose: () => void;
}) {
  const open = selected != null;
  const neg = balance < 0;
  const kind = selected?.location.kind;
  const unit = selected ? INGREDIENT_UNIT_LABELS[selected.column.unit] : "";
  const meta = !selected
    ? ""
    : kind === "transit"
      ? "Ингредиент в дороге к фермеру — отправлен с завода, ещё не доставлен. Источник — рейсы."
      : neg
        ? "Отрицательный остаток — временный зазор учёта: расход отмечен раньше прибытия доставки."
        : kind === "factory"
          ? "Физический остаток ингредиента на складе завода."
          : "Реальный остаток у фермера: начальный + доставлено − расход в производство.";

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/15 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`fixed top-0 right-0 z-50 flex h-screen w-[480px] max-w-[92vw] flex-col border-l bg-background shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        {selected && (
          <>
            <div className="border-b px-6 pt-5 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {selected.location.kind !== "factory" && (
                      <Truck className="size-3" />
                    )}
                    {selected.location.name}
                    {selected.location.kind === "farmer" && " · фермер"}
                  </div>
                  <h3 className="mt-1 text-[17px] font-semibold tracking-tight">
                    {selected.column.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="grid size-8 place-items-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Закрыть"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span
                  className="font-mono text-3xl font-semibold tabular-nums"
                  style={neg ? { color: OUTFLOW } : undefined}
                >
                  {fmtQty(balance)}
                </span>
                <span className="text-sm text-muted-foreground">{unit}</span>
              </div>
              <p
                className={`mt-2 text-xs leading-[17px] ${neg ? "" : "text-muted-foreground"}`}
                style={neg ? { color: OUTFLOW } : undefined}
              >
                {meta}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <h4 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                История движений
              </h4>
              {loading ? (
                <p className="text-sm text-muted-foreground">Загрузка…</p>
              ) : movements && movements.length > 0 ? (
                <>
                  <p className="mb-3 text-xs text-muted-foreground">
                    {movements.length}{" "}
                    {plural(movements.length, "движение", "движения", "движений")}
                  </p>
                  <div className="flex flex-col">
                    {movements.map((m, i) => (
                      <MovementRow key={i} m={m} unit={unit} />
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Движений нет.</p>
              )}
            </div>

            <div className="flex items-start gap-2 border-t bg-muted/30 px-6 py-3 text-[11px] text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Read-only. Движения создаются автоматически из рейсов и актов
                приёмки.
              </span>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function MovementRow({ m, unit }: { m: IngredientMovement; unit: string }) {
  const pos = m.qty >= 0;
  const flow =
    m.srcKind === "inv"
      ? "Инвентаризация склада"
      : `${m.fromName ?? "—"} → ${m.toName ?? "—"}`;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground ${
              m.transit ? "border-dashed bg-background" : "bg-muted"
            }`}
          >
            {m.chip}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {m.date}
          </span>
        </div>
        <div className="mt-1.5 text-[13px]">{flow}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {m.srcKind === "trip" ? (
            <Truck className="size-3" />
          ) : m.srcKind === "act" ? (
            <FileText className="size-3" />
          ) : (
            <Warehouse className="size-3" />
          )}
          {m.srcRef}
        </div>
      </div>
      <div
        className="self-center text-right font-mono text-[15px] font-medium tabular-nums"
        style={pos ? undefined : { color: OUTFLOW }}
      >
        {pos ? `+${fmtQty(m.qty)}` : fmtQty(m.qty)} {unit}
      </div>
    </div>
  );
}

// ---------- helpers ----------
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
