"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getTareMovements,
  type TareBalances,
  type TareMovement,
  type TareState,
  type TareType,
} from "@/server/inventory/balances";

// D4b: матрица остатков тары локация × тип. Read-only. Баланс приходит плоским
// списком cells (Σ движений считается на сервере); здесь — лукап-Map, тоталы,
// фильтры и drill-down. Стиль — токены прототипа inventory-tare-d4 / NormsMatrix.

const OUTFLOW = "#9a5a12"; // приглушённый amber для отрицательных (зазор учёта)

type Props = { data: TareBalances };

type SelectedCell = {
  location: TareBalances["locations"][number];
  type: TareType;
};

export function TareBalanceMatrix({ data }: Props) {
  const [state, setState] = useState<TareState>("good");
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [movements, setMovements] = useState<TareMovement[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Лукап баланса: `${loc}:${type}:${state}` → qty.
  const balMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data.cells) {
      m.set(`${c.locationId}:${c.packagingTypeId}:${c.state}`, c.quantity);
    }
    return m;
  }, [data.cells]);

  const cellVal = useCallback(
    (loc: number, type: number) => balMap.get(`${loc}:${type}:${state}`) ?? 0,
    [balMap, state],
  );

  const factory = data.locations.find((l) => l.kind === "factory");
  const farmers = data.locations.filter((l) => l.kind === "farmer");
  const transit = data.locations.filter((l) => l.kind === "transit");

  const farmerIsZero = useCallback(
    (loc: number) => data.types.every((t) => cellVal(loc, t.id) === 0),
    [data.types, cellVal],
  );
  const visibleFarmers = showAll
    ? farmers
    : farmers.filter((f) => !farmerIsZero(f.id));
  const hiddenCount = farmers.length - visibleFarmers.length;

  const systemTotal = useCallback(
    (type: number) =>
      data.locations.reduce((sum, l) => sum + cellVal(l.id, type), 0),
    [data.locations, cellVal],
  );

  // Кол-во движений по состоянию (для счётчиков сегмента).
  const stateHasData = useMemo(
    () => data.cells.some((c) => c.state === state),
    [data.cells, state],
  );

  function openCell(location: SelectedCell["location"], type: TareType) {
    if (cellVal(location.id, type.id) === 0) return;
    setSelected({ location, type });
    setMovements(null);
    setLoading(true);
    getTareMovements(location.id, type.id, state)
      .then((rows) => setMovements(rows))
      .finally(() => setLoading(false));
  }

  const closeDrawer = useCallback(() => setSelected(null), []);

  // Высота липкой шапки страницы → CSS-переменная для офсета липкой шапки
  // таблицы (калька с ShipmentsFeed/--toolbar-h). Шапка живёт в page.tsx.
  useEffect(() => {
    const head = document.getElementById("tare-page-head");
    if (!head) return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        "--tare-head-h",
        `${head.offsetHeight}px`,
      );
    });
    ro.observe(head);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--tare-head-h");
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

  return (
    <div>
      {/* ----- сегмент состояния + тоггл всех фермеров ----- */}
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <div className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
          {(["good", "scrap"] as TareState[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setState(s)}
              className={`cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                state === s
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "good" ? "Целая" : "Лом"}
            </button>
          ))}
        </div>
        {state === "good" && (
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
        )}
      </div>

      {state === "scrap" ? (
        <ScrapEmpty hasData={stateHasData} />
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            Фермеры с нулевым остатком скрыты. Клик по ячейке — история движений.
          </p>

          <div className="rounded-lg border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th
                    className="sticky left-0 z-30 border-b border-r bg-muted px-4 py-3 text-left font-medium"
                    style={{ top: "var(--tare-head-h, 0px)" }}
                  >
                    Локация
                  </th>
                  {data.types.map((t) => (
                    <th
                      key={t.id}
                      className="sticky z-20 border-b bg-muted px-4 py-3 text-right font-medium whitespace-nowrap"
                      style={{ top: "var(--tare-head-h, 0px)" }}
                    >
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="flex items-center gap-1.5">
                          <TypeIcon kind={t.kind} />
                          {t.name}
                        </span>
                        <span className="font-mono text-[11px] font-normal text-muted-foreground">
                          {t.kind}
                          {t.capacityKg != null && ` · ${t.capacityKg} кг`}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Завод */}
                {factory && (
                  <LocationRow
                    location={factory}
                    types={data.types}
                    cellVal={cellVal}
                    onOpen={openCell}
                    emphasis
                  />
                )}
                {/* Фермеры */}
                {visibleFarmers.map((f) => (
                  <LocationRow
                    key={f.id}
                    location={f}
                    types={data.types}
                    cellVal={cellVal}
                    onOpen={openCell}
                  />
                ))}
                {/* Транзит */}
                {transit.map((tr, i) => (
                  <LocationRow
                    key={tr.id}
                    location={tr}
                    types={data.types}
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
                        склад + фермеры + в пути
                      </span>
                    </span>
                  </th>
                  {data.types.map((t) => (
                    <td
                      key={t.id}
                      className="border-t-2 bg-muted/60 px-4 py-3 text-right font-mono text-[15px] font-semibold tabular-nums"
                    >
                      {systemTotal(t.id)}
                      <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">
                        шт
                      </span>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          <Legend />
        </>
      )}

      {/* ----- drill-down drawer ----- */}
      <Drawer
        selected={selected}
        balance={
          selected ? cellVal(selected.location.id, selected.type.id) : 0
        }
        state={state}
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
  types,
  cellVal,
  onOpen,
  emphasis,
  muted,
  topBorder,
}: {
  location: TareBalances["locations"][number];
  types: TareType[];
  cellVal: (loc: number, type: number) => number;
  onOpen: (loc: TareBalances["locations"][number], type: TareType) => void;
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
          {location.kind === "transit" && <TruckIcon className="size-3.5 text-muted-foreground" />}
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
      {types.map((t) => {
        const v = cellVal(location.id, t.id);
        const zero = v === 0;
        return (
          <td
            key={t.id}
            className={`border-b p-0 group-hover:bg-muted/30 ${rowBg} ${top}`}
          >
            <button
              type="button"
              disabled={zero}
              onClick={() => onOpen(location, t)}
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
                {zero ? "—" : v < 0 ? `−${Math.abs(v)}` : v}
              </span>
              {!zero && (
                <span className="font-sans text-xs text-muted-foreground">шт</span>
              )}
            </button>
          </td>
        );
      })}
    </tr>
  );
}

// ---------- пустое состояние «Лом» ----------
function ScrapEmpty({ hasData }: { hasData: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-6 py-14 text-center">
      <div className="mx-auto mb-4 grid size-11 place-items-center rounded-[10px] border bg-background text-muted-foreground">
        <TrashIcon className="size-5" />
      </div>
      <h3 className="mb-1.5 text-base font-semibold">
        {hasData ? "Есть списания" : "Списаний пока нет"}
      </h3>
      <p className="mx-auto max-w-[440px] text-sm text-muted-foreground">
        Лом — это состояние тары, не локация. Баланс лома появляется с операциями
        списания (целая → лом).
      </p>
    </div>
  );
}

// ---------- легенда ----------
function Legend() {
  return (
    <div className="mt-4 max-w-[760px] rounded-lg border bg-muted/30 px-4 py-3.5 text-[13px] leading-5 text-muted-foreground">
      <p>
        <span className="font-semibold text-foreground">Завод / Фермер</span> —
        реальный остаток целой тары на руках (начальный + доставлено − отгружено).
      </p>
      <p className="mt-2">
        <span className="font-semibold text-foreground">В пути</span> — тара в
        дороге, ещё не у получателя (отгружена или отправлена, но не принята).
      </p>
      <p className="mt-2 border-t border-dashed pt-2.5">
        Отрицательный остаток у фермера — временный зазор учёта: тара отгружена, а
        доставка завод→фермер ещё не отмечена.{" "}
        <span className="font-medium text-foreground">«Итого в системе»</span> по
        типу = склад + фермеры + в пути — сохраняемый физический объём тары.
      </p>
    </div>
  );
}

// ---------- drawer ----------
function Drawer({
  selected,
  balance,
  state,
  movements,
  loading,
  onClose,
}: {
  selected: SelectedCell | null;
  balance: number;
  state: TareState;
  movements: TareMovement[] | null;
  loading: boolean;
  onClose: () => void;
}) {
  const open = selected != null;
  const neg = balance < 0;
  const kind = selected?.location.kind;
  const meta = !selected
    ? ""
    : kind === "transit"
      ? selected.location.id === -1
        ? "Тара в дороге на завод — отгружена фермером, ещё не принята. Источник — отгрузки."
        : "Тара в дороге к фермеру — отправлена с завода, ещё не доставлена. Источник — рейсы тары."
      : neg
        ? "Отрицательный остаток — временный зазор учёта: тара отгружена, а доставка завод→фермер ещё не отмечена."
        : kind === "factory"
          ? "Физический остаток целой тары на складе завода."
          : "Реальный остаток тары у фермера: начальный + доставлено − отгружено.";

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
                      <TruckIcon className="size-3" />
                    )}
                    {selected.location.name}
                    {selected.location.kind === "farmer" && " · фермер"}
                  </div>
                  <h3 className="mt-1 text-[17px] font-semibold tracking-tight">
                    {selected.type.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="grid size-8 place-items-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Закрыть"
                >
                  <CloseIcon className="size-4" />
                </button>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span
                  className="font-mono text-3xl font-semibold tabular-nums"
                  style={neg ? { color: OUTFLOW } : undefined}
                >
                  {neg ? `−${Math.abs(balance)}` : balance}
                </span>
                <span className="text-sm text-muted-foreground">
                  шт · {state === "good" ? "целая" : "лом"}
                </span>
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
                    {movements.length} {plural(movements.length, "движение", "движения", "движений")}
                  </p>
                  <div className="flex flex-col">
                    {movements.map((m, i) => (
                      <MovementRow key={i} m={m} />
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Движений нет.</p>
              )}
            </div>

            <div className="flex items-start gap-2 border-t bg-muted/30 px-6 py-3 text-[11px] text-muted-foreground">
              <LockIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Read-only. Движения создаются автоматически из отгрузок и рейсов
                тары.
              </span>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function MovementRow({ m }: { m: TareMovement }) {
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
            <TruckIcon className="size-3" />
          ) : m.srcKind === "ship" ? (
            <ListIcon className="size-3" />
          ) : (
            <FactoryIcon className="size-3" />
          )}
          {m.srcRef}
        </div>
      </div>
      <div
        className="self-center text-right font-mono text-[15px] font-medium tabular-nums"
        style={pos ? undefined : { color: OUTFLOW }}
      >
        {pos ? `+${m.qty}` : `−${Math.abs(m.qty)}`}
      </div>
    </div>
  );
}

// ---------- helpers / icons ----------
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function TypeIcon({ kind }: { kind: TareType["kind"] }) {
  if (kind === "barrel") {
    return (
      <svg viewBox="0 0 24 24" className="size-3.5 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="5" rx="7" ry="2.5" />
        <path d="M5 5v14c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5" />
        <path d="M4.5 12h15" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 9.4 7.5 4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    </svg>
  );
}

function TruckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function FactoryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" />
      <path d="M5 21V7l8-4v18" />
      <path d="M19 21V11l-6-4" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
