"use client";

import { forwardRef, type ReactNode } from "react";

// Иконки тулбара — вербатим из прототипа (lenta-b0 / toolbar-states), stroke-icons.
const ico = {
  chevronLeft: <polyline points="15 18 9 12 15 6" />,
  chevronRight: <polyline points="9 18 15 12 9 6" />,
  chevronDown: <polyline points="6 9 12 15 18 9" />,
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
};

// Каркас тулбара ленты (Часть A). Поиск/фильтры/тумблер — статичная разметка
// без логики (интерактив — Часть B). Heatmap/План/Excel — заглушки с тултипом «скоро».
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

          <div className="spacer" />

          <div className="seg">
            <button type="button" className="active">
              Таблица
            </button>
            <div className="tip-wrap">
              <button type="button" className="is-disabled" aria-disabled>
                Heatmap
              </button>
              <span className="tip">скоро</span>
            </div>
            <div className="tip-wrap">
              <button type="button" className="is-disabled" aria-disabled>
                План
              </button>
              <span className="tip">скоро</span>
            </div>
          </div>
        </div>

        {/* Строка 2 — поиск/фильтры/тумблер: статичная разметка, логика в Части B. */}
        <div className="tbar-row">
          <div className="search">
            <Svg cls="ic-search">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </Svg>
            <input type="text" placeholder="Поиск: фермер, культура, № акта…" />
          </div>

          <div className="filter-wrap">
            <button type="button" className="filter">
              <Svg cls="fl-ic">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </Svg>
              Поставщик
              <Svg cls="fl-chev">{ico.chevronDown}</Svg>
            </button>
          </div>

          <div className="filter-wrap">
            <button type="button" className="filter">
              <Svg cls="fl-ic">
                <path d="M11 2 4 6v6c0 5 3 7.5 7 9 4-1.5 7-4 7-9V6z" />
              </Svg>
              Сырьё
              <Svg cls="fl-chev">{ico.chevronDown}</Svg>
            </button>
          </div>

          <div className="filter-wrap">
            <button type="button" className="filter">
              Статус: <span className="fv">все</span>
              <Svg cls="fl-chev">{ico.chevronDown}</Svg>
            </button>
          </div>

          <div className="spacer" />

          <label className="toggle">
            <span className="switch off" />
            Скрыть плановые
          </label>

          <div className="tip-wrap">
            <button type="button" className="btn btn-sm is-disabled" aria-disabled>
              <Svg>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </Svg>
              Excel
            </button>
            <span className="tip">скоро</span>
          </div>
        </div>
      </div>
    );
  },
);
