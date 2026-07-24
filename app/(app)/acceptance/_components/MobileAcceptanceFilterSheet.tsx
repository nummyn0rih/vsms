"use client";

import type { ComboOption } from "@/components/filters/FilterCombo";
import type { AcceptanceBoard as Board } from "@/server/acceptance/schema";
import { filterBoard } from "@/server/acceptance/board-filter";
import { pluralRu } from "@/server/shipments/format";

// Bottom-sheet фильтров мобильной приёмки — калька MobileFilterSheet ленты (те же классы
// .sheet/.opt-chip/.sq, live-apply тапом по чипу). Отличия: секции «Сырьё»/«Поставщик»
// (статуса нет — его задаёт сама зона) + поле поиска сверху. Счётчик показа считает тот
// же filterBoard (board-filter.ts), что десктопная доска и печатный лист.
export function MobileAcceptanceFilterSheet({
  open,
  onClose,
  board,
  options,
  search,
  supplierSel,
  cultureSel,
  onSearch,
  onToggleSupplier,
  onToggleCulture,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  board: Board;
  options: { farmers: ComboOption[]; cultures: ComboOption[] };
  search: string;
  supplierSel: Set<number>;
  cultureSel: Set<number>;
  onSearch: (value: string) => void;
  onToggleSupplier: (id: number) => void;
  onToggleCulture: (id: number) => void;
  onReset: () => void;
}) {
  if (!open) return null;

  const v = filterBoard(board, { search, supplierSel, cultureSel });
  const matched = v.zone1.length + v.zone2.length + v.zone3.length;

  return (
    <div className="md:hidden">
      <div className="ov-scrim" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <span className="sheet-title">Фильтры</span>
          <button type="button" className="sheet-clear" onClick={onReset}>
            Сбросить
          </button>
        </div>

        <div className="sheet-body">
          <div className={`search${search ? " has-val" : ""}`} style={{ marginTop: 10 }}>
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
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Поиск: № машины, водитель…"
            />
            {search && (
              <button
                type="button"
                className="clear-x"
                title="Очистить"
                onClick={() => onSearch("")}
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

          <div className="sheet-sec">
            <div className="sheet-sec-lab">Сырьё</div>
            <div className="opt-chips">
              {options.cultures.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`opt-chip${cultureSel.has(c.id as number) ? " sel" : ""}`}
                  onClick={() => onToggleCulture(c.id as number)}
                >
                  <span className="sq" style={{ backgroundColor: c.color }} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="sheet-sec">
            <div className="sheet-sec-lab">Поставщик</div>
            <div className="opt-chips">
              {options.farmers.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`opt-chip${supplierSel.has(f.id as number) ? " sel" : ""}`}
                  onClick={() => onToggleSupplier(f.id as number)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sheet-foot">
          <button type="button" className="abtn ghost" style={{ flex: 1 }} onClick={onReset}>
            Сбросить
          </button>
          <button type="button" className="abtn" style={{ flex: 1.6 }} onClick={onClose}>
            Показать {matched} {pluralRu(matched, "машину", "машины", "машин")}
          </button>
        </div>
      </div>
    </div>
  );
}
