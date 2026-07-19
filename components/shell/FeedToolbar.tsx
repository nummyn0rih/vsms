"use client";

import { forwardRef, type ReactNode } from "react";

// Иконки тулбара — вербатим из прототипа (lenta-b0 / toolbar-states), stroke-icons.
const ico = {
  chevronLeft: <polyline points="15 18 9 12 15 6" />,
  chevronRight: <polyline points="9 18 15 12 9 6" />,
};

function Svg({ children, cls }: { children: ReactNode; cls?: string }) {
  return (
    <svg
      className={cls}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

type FeedToolbarProps = {
  /** Кнопка/диалог «+ Отгрузка» (под RoleGate на стороне вызова). */
  createSlot: ReactNode;
  weekLabel: string; // «Неделя 24»
  weekSub: string; // «8–13 июня»
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
  /** true → активна не текущая неделя, «Сегодня» подсвечена (вернуться к текущей). */
  todayActive: boolean;
  // Переключатель вида: набор кнопок задаёт маршрут (B5-nav). «Лента»/«Сводка» на
  // /shipments, «План»/«Доска» на /planner. disabled+tip → кнопка «скоро».
  viewMode: string;
  onViewChange: (v: string) => void;
  views: { key: string; label: string; disabled?: boolean; tip?: string }[];
  // Строка 2 (поиск/фильтры/тумблер/сброс) — только там, где есть фильтры (Лента).
  showFilters: boolean;
  // Combobox состава недели (B4c) — только в виде «План».
  scopeSlot?: ReactNode;
  // Часть B — фильтры/поиск/тумблер (состояние в ShipmentsFeed). Опциональны:
  // нужны только при showFilters (Лента). На /planner не передаются.
  search?: string;
  onSearch?: (v: string) => void;
  onClearSearch?: () => void;
  supplierCombo?: ReactNode;
  cultureCombo?: ReactNode;
  statusCombo?: ReactNode;
  hidePlanned?: boolean;
  onToggleHidePlanned?: () => void;
  showReset?: boolean;
  onReset?: () => void;
  // Ссылка «Печать» → print-роут (собирается в ShipmentsFeed с текущей неделей+фильтрами).
  printSlot?: ReactNode;
  // Тумблер «Развернуть/Свернуть все недели» (только Лента; собирается в ShipmentsFeed).
  expandSlot?: ReactNode;
  // Кнопка «Экспорт Excel» (только Лента; собирается в ShipmentsFeed). Клиентский xlsx.
  exportSlot?: ReactNode;
};

// Тулбар ленты. Row 1 — создание/неделя/вид (Часть A). Row 2 — поиск/фильтры/
// тумблер «скрыть плановые»/сброс (Часть B, всё клиентское поверх дерева).
// Heatmap/План/Excel — заглушки с тултипом «скоро».
export const FeedToolbar = forwardRef<HTMLDivElement, FeedToolbarProps>(
  function FeedToolbar(
    {
      createSlot,
      weekLabel,
      weekSub,
      onPrevWeek,
      onNextWeek,
      onToday,
      prevDisabled,
      nextDisabled,
      todayActive,
      viewMode,
      onViewChange,
      views,
      showFilters,
      scopeSlot,
      search,
      onSearch,
      onClearSearch,
      supplierCombo,
      cultureCombo,
      statusCombo,
      hidePlanned,
      onToggleHidePlanned,
      showReset,
      onReset,
      printSlot,
      expandSlot,
      exportSlot,
    },
    ref,
  ) {
    return (
      <div ref={ref} className="toolbar">
        <div className="tbar-row">
          {createSlot}

          <div className="weeknav">
            <button
              type="button"
              title="Предыдущая неделя"
              onClick={onPrevWeek}
              disabled={prevDisabled}
            >
              <Svg>{ico.chevronLeft}</Svg>
            </button>
            <div className="wlabel">
              {weekLabel} <span className="wsub">{weekSub}</span>
            </div>
            <button
              type="button"
              title="Следующая неделя"
              onClick={onNextWeek}
              disabled={nextDisabled}
            >
              <Svg>{ico.chevronRight}</Svg>
            </button>
          </div>

          <button
            type="button"
            onClick={onToday}
            className={`btn btn-sm ${todayActive ? "btn-today-active" : "btn-ghost"}`}
          >
            {todayActive && <span className="dotpulse" />}
            Сегодня
          </button>

          {scopeSlot}

          <div className="spacer" />

          {expandSlot}
          {printSlot}
          {exportSlot}

          <div className="seg">
            {views.map((v) =>
              v.disabled ? (
                <div className="tip-wrap" key={v.key}>
                  <button type="button" className="is-disabled" aria-disabled>
                    {v.label}
                  </button>
                  {v.tip && <span className="tip">{v.tip}</span>}
                </div>
              ) : (
                <button
                  type="button"
                  key={v.key}
                  className={viewMode === v.key ? "active" : ""}
                  onClick={() => onViewChange(v.key)}
                >
                  {v.label}
                </button>
              ),
            )}
          </div>
        </div>

        {/* Строка 2 — поиск/фильтры/тумблер/сброс (только в «Ленте»). */}
        {showFilters && (
        <div className="tbar-row">
          <div className={`search${search ? " has-val" : ""}`}>
            <Svg cls="ic-search">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </Svg>
            <input
              type="text"
              value={search ?? ""}
              onChange={(e) => onSearch?.(e.target.value)}
              placeholder="Поиск: фермер, культура, № акта…"
            />
            {search && (
              <button
                type="button"
                className="clear-x"
                title="Очистить"
                onClick={onClearSearch}
              >
                <Svg>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </Svg>
              </button>
            )}
          </div>

          {supplierCombo}
          {cultureCombo}
          {statusCombo}

          {showReset && (
            <button
              type="button"
              className="btn btn-sm btn-reset"
              onClick={onReset}
            >
              <Svg>
                <path d="M3 2v6h6" />
                <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
              </Svg>
              Сбросить
            </button>
          )}

          <div className="spacer" />

          <label className={`toggle${hidePlanned ? " on" : ""}`}>
            <input
              type="checkbox"
              className="sr-only"
              checked={hidePlanned ?? false}
              onChange={onToggleHidePlanned}
            />
            <span className={`switch${hidePlanned ? "" : " off"}`} />
            Скрыть плановые
          </label>
        </div>
        )}
      </div>
    );
  },
);
