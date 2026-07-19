"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import type { AcceptanceBoard as Board } from "@/server/acceptance/schema";
import type { ActContext } from "@/server/acceptance/schema";
import { markArrived } from "@/server/acceptance/actions";
import { getActContext } from "@/server/acceptance/act";
import {
  filterBoard,
  boardOptions,
  anyAcceptanceFilterActive,
} from "@/server/acceptance/board-filter";
import { currentSeasonWeek } from "@/server/shipments/workdays";
import { downloadXlsx, type XlsxRow } from "@/lib/xlsx-export";
import { FilterCombo } from "@/components/filters/FilterCombo";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AcceptanceMachine } from "./AcceptanceMachine";
import { AcceptedMachine } from "./AcceptedMachine";
import { AcceptanceActDialog } from "./AcceptanceActDialog";

// Иконки фильтров (stroke-пути, вербатим из ленты — тот же тулбар-паттерн).
const supplierIcon = (
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>
);
const cultureIcon = <path d="M11 2 4 6v6c0 5 3 7.5 7 9 4-1.5 7-4 7-9V6z" />;

function ZoneHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <span className="text-sm tabular-nums text-muted-foreground">{count}</span>
    </div>
  );
}

function EmptyZone({ note }: { note: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[#ebebeb] px-4 py-8 text-center text-sm text-muted-foreground">
      {note}
    </div>
  );
}

export function AcceptanceBoard({ board }: { board: Board }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

  // Состояние диалога акта держим ЗДЕСЬ (на доске), не в карточке: markArrived
  // перетасовывает зоны (sent→arrived), карточка размонтируется — диалог жил бы внутри
  // и терялся. Доска поверх перетасовки сохраняет состояние (фикс 1).
  const [actState, setActState] = useState<{
    context: ActContext;
    fromSent: boolean;
  } | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  // --- Фильтры (React state, без localStorage). Опции — из полного board. ---
  const [search, setSearch] = useState("");
  const [supplierSel, setSupplierSel] = useState<Set<number>>(new Set());
  const [cultureSel, setCultureSel] = useState<Set<number>>(new Set());

  const filters = { search, supplierSel, cultureSel };
  const anyFilterActive = anyAcceptanceFilterActive(filters);

  const options = useMemo(() => boardOptions(board), [board]);
  const view = useMemo(
    () => filterBoard(board, { search, supplierSel, cultureSel }),
    [board, search, supplierSel, cultureSel],
  );

  const resetAll = useCallback(() => {
    setSearch("");
    setSupplierSel(new Set());
    setCultureSel(new Set());
  }, []);

  function toggleNum(
    setSet: React.Dispatch<React.SetStateAction<Set<number>>>,
    id: number,
  ) {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // «Печать» → /print/acceptance с текущими фильтрами (сериализуем: sup/cult/q).
  const printHref = (() => {
    const p = new URLSearchParams();
    if (supplierSel.size) p.set("sup", [...supplierSel].join(","));
    if (cultureSel.size) p.set("cult", [...cultureSel].join(","));
    if (search.trim()) p.set("q", search.trim());
    const qs = p.toString();
    return qs ? `/print/acceptance?${qs}` : "/print/acceptance";
  })();

  // Экспорт Excel: позиции отфильтрованной доски (view = filterBoard), строка = позиция.
  // Три зоны плоско; зоны 1/2 (items) не несут брак%/принято/№ акта → пусто. Числа — числами.
  const XLSX_COLUMNS = [
    "Зона",
    "№ машины",
    "Водитель",
    "Перевозчик",
    "Культура",
    "Поставщик",
    "Факт кг",
    "Брак %",
    "Принято кг",
    "№ акта",
  ];
  function exportXlsx() {
    const rows: XlsxRow[] = [];
    for (const m of view.zone1) {
      for (const it of m.items) {
        rows.push({
          "Зона": "Ожидают перевески",
          "№ машины": m.code,
          "Водитель": m.driverName ?? "",
          "Перевозчик": m.transportCompanyName ?? "",
          "Культура": it.cultureName,
          "Поставщик": it.farmerName,
          "Факт кг": it.actualKg,
          "Брак %": null,
          "Принято кг": null,
          "№ акта": it.actNumber ?? "",
        });
      }
    }
    for (const m of view.zone2) {
      for (const it of m.items) {
        rows.push({
          "Зона": "На приёмке",
          "№ машины": m.code,
          "Водитель": m.driverName ?? "",
          "Перевозчик": m.transportCompanyName ?? "",
          "Культура": it.cultureName,
          "Поставщик": it.farmerName,
          "Факт кг": it.actualKg,
          "Брак %": null,
          "Принято кг": null,
          "№ акта": it.actNumber ?? "",
        });
      }
    }
    for (const m of view.zone3) {
      for (const pos of m.positions) {
        rows.push({
          "Зона": "Принято",
          "№ машины": m.code,
          "Водитель": m.driverName ?? "",
          "Перевозчик": m.transportCompanyName ?? "",
          "Культура": pos.cultureName,
          "Поставщик": pos.farmerName,
          "Факт кг": pos.actualKg,
          "Брак %": pos.brakPercent,
          "Принято кг": pos.acceptedKg,
          "№ акта": pos.actNumber ?? "",
        });
      }
    }
    const seasonYear = currentSeasonWeek().seasonYear;
    downloadXlsx({
      rows,
      columns: XLSX_COLUMNS,
      sheetName: "Приёмка",
      fileName: `vsms-приёмка-${seasonYear}.xlsx`,
    });
  }

  async function onOpenAct(
    itemId: number,
    machineId: number,
    machineStatus: "sent" | "arrived",
  ) {
    setPendingId(itemId);
    const fromSent = machineStatus === "sent";
    if (fromSent) {
      const arr = await markArrived({ shipmentId: machineId });
      if (!arr.ok) {
        setPendingId(null);
        toast.error(arr.error);
        return;
      }
    }
    const ctx = await getActContext({ shipmentItemId: itemId });
    setPendingId(null);
    if (!ctx) {
      toast.error("Позиция не найдена");
      return;
    }
    setActState({ context: ctx, fromSent });
  }

  // Пусто после фильтра показываем осмысленной подписью, а не дефолтной «Нет машин…».
  const emptyNote = (base: string) =>
    anyFilterActive ? "Ничего не найдено по фильтрам." : base;

  const toolbar = (
    <div className="tbar-row mb-6 border-b border-[#ebebeb] pb-4">
        <div className={`search${search ? " has-val" : ""}`}>
          <svg
            className="ic-search"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск: № машины, водитель…"
          />
          {search && (
            <button
              type="button"
              className="clear-x"
              title="Очистить"
              onClick={() => setSearch("")}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <FilterCombo
          kind="icon"
          label="Поставщик"
          icon={supplierIcon}
          options={options.farmers}
          selected={supplierSel}
          onToggle={(id) => toggleNum(setSupplierSel, id as number)}
          onClear={() => setSupplierSel(new Set())}
          searchable
          searchPlaceholder="Найти поставщика…"
        />
        <FilterCombo
          kind="icon"
          label="Сырьё"
          icon={cultureIcon}
          options={options.cultures}
          selected={cultureSel}
          onToggle={(id) => toggleNum(setCultureSel, id as number)}
          onClear={() => setCultureSel(new Set())}
          searchable
          searchPlaceholder="Найти культуру…"
        />

        {anyFilterActive && (
          <button
            type="button"
            className="btn btn-sm btn-reset"
            onClick={resetAll}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 2v6h6" />
              <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
            </svg>
            Сбросить
          </button>
        )}

        <div className="spacer" />

        <a href={printHref} target="_blank" rel="noopener" className="btn btn-sm">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          Печать
        </a>

        <button type="button" onClick={exportXlsx} className="btn btn-sm">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Экспорт Excel
        </button>
    </div>
  );

  return (
    <TooltipProvider>
      {toolbar}
      <div className="flex flex-col gap-8">
        {/* Зона 1: машины в пути (sent) — ожидают перевески. */}
        <section>
          <ZoneHeader title="Ожидают перевески" count={view.zone1.length} />
          {view.zone1.length === 0 ? (
            <EmptyZone note={emptyNote("Нет машин в пути.")} />
          ) : (
            <div className="flex flex-col gap-3">
              {view.zone1.map((m) => (
                <AcceptanceMachine
                  key={m.id}
                  machine={m}
                  onOpenAct={onOpenAct}
                  pendingId={pendingId}
                />
              ))}
            </div>
          )}
        </section>

        {/* Зона 2: машины на приёмке (arrived). */}
        <section>
          <ZoneHeader title="На приёмке" count={view.zone2.length} />
          {view.zone2.length === 0 ? (
            <EmptyZone note={emptyNote("Нет машин на приёмке.")} />
          ) : (
            <div className="flex flex-col gap-3">
              {view.zone2.map((m) => (
                <AcceptanceMachine
                  key={m.id}
                  machine={m}
                  onOpenAct={onOpenAct}
                  pendingId={pendingId}
                />
              ))}
            </div>
          )}
        </section>

        {/* Зона 3: принято (accepted) — карточки свёрнуты, разворот по клику. */}
        <section>
          <ZoneHeader title="Принято" count={view.acceptedCount} />
          {view.zone3.length === 0 ? (
            <EmptyZone note={emptyNote("Нет принятых машин.")} />
          ) : (
            <div className="flex flex-col gap-3">
              {view.zone3.map((m) => (
                <AcceptedMachine key={m.id} machine={m} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Один диалог акта на доску — переживает перетасовку зон (фикс 1/3). */}
      {actState && (
        <AcceptanceActDialog
          key={actState.context.shipmentItemId}
          context={actState.context}
          open
          onOpenChange={(v) => {
            if (!v) {
              setActState(null);
              router.refresh();
            }
          }}
          openedFromSent={actState.fromSent}
          isAdmin={isAdmin}
        />
      )}
    </TooltipProvider>
  );
}
