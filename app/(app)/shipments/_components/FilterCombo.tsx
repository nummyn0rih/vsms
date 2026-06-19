"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// Combobox-фильтр ленты: кнопка `.filter` + выпадающий `.combo` (разметка/классы
// вербатим из toolbar-states.html §02). Мультивыбор, live-apply (отметка сразу
// меняет фильтр выше), поиск опций, закрытие по клику вне / Esc.
// Активная кнопка — нейтральная заливка `.active` + счётчик (НЕ статусные цвета).

export type ComboOption = {
  id: string | number;
  name: string;
  color?: string; // цветной квадрат (культуры)
  count?: number; // .ct — число машин сезона (стабильно, по полному дереву)
};

function Svg({
  children,
  cls,
  size = 15,
}: {
  children: ReactNode;
  cls?: string;
  size?: number;
}) {
  return (
    <svg
      className={cls}
      width={size}
      height={size}
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

const chevronDown = <polyline points="6 9 12 15 18 9" />;
const searchIcon = (
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </>
);
const checkIcon = <polyline points="20 6 9 17 4 12" />;

type FilterComboProps = {
  /** "icon" — Поставщик/Сырьё (иконка+лейбл). "status" — «Статус: все» / «Статус N». */
  kind: "icon" | "status";
  label: string;
  icon?: ReactNode; // svg-пути для kind="icon"
  options: ComboOption[];
  selected: Set<string | number>;
  onToggle: (id: string | number) => void;
  onClear: () => void;
  searchable?: boolean;
  searchPlaceholder?: string;
};

export function FilterCombo({
  kind,
  label,
  icon,
  options,
  selected,
  onToggle,
  onClear,
  searchable = false,
  searchPlaceholder,
}: FilterComboProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Закрытие по клику вне / Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = selected.size;
  const active = count > 0;

  const q = query.trim().toLowerCase();
  const shown = q
    ? options.filter((o) => o.name.toLowerCase().includes(q))
    : options;

  // Класс кнопки: active (нейтральная заливка) перебивает open для визуала покоя.
  const btnCls = `filter${open ? " open" : ""}${active ? " active" : ""}`;

  return (
    <div className="filter-wrap" ref={wrapRef}>
      <button
        type="button"
        className={btnCls}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {kind === "icon" && icon && (
          <Svg cls="fl-ic" size={14}>
            {icon}
          </Svg>
        )}
        {kind === "status" && !active ? (
          <>
            {label}: <span className="fv">все</span>
          </>
        ) : (
          label
        )}
        {active ? (
          <span className="count">{count}</span>
        ) : (
          <Svg cls="fl-chev" size={14}>
            {chevronDown}
          </Svg>
        )}
      </button>

      {open && (
        <div className="combo" id={listId}>
          {searchable && (
            <div className="combo-search">
              <Svg>{searchIcon}</Svg>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder ?? "Найти…"}
              />
            </div>
          )}
          <div className="combo-list">
            {shown.length === 0 ? (
              <div className="combo-opt" aria-disabled>
                <span className="nm" style={{ color: "var(--mute)" }}>
                  Ничего не найдено
                </span>
              </div>
            ) : (
              shown.map((o) => {
                const sel = selected.has(o.id);
                return (
                  <div
                    key={o.id}
                    className={`combo-opt${sel ? " sel" : ""}`}
                    role="checkbox"
                    aria-checked={sel}
                    tabIndex={0}
                    onClick={() => onToggle(o.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggle(o.id);
                      }
                    }}
                  >
                    <span className="cb">
                      <svg
                        width={11}
                        height={11}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        {checkIcon}
                      </svg>
                    </span>
                    {o.color && (
                      <span
                        className="sq"
                        style={{ backgroundColor: o.color }}
                      />
                    )}
                    <span className="nm">{o.name}</span>
                    {o.count != null && <span className="ct">{o.count}</span>}
                  </div>
                );
              })
            )}
          </div>
          <div className="combo-foot">
            <button
              type="button"
              className="clr"
              onClick={() => {
                onClear();
                setQuery("");
              }}
            >
              Очистить
            </button>
            <button
              type="button"
              className="apply"
              onClick={() => setOpen(false)}
            >
              Применить{count > 0 ? ` · ${count}` : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
