"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";

import type { ScopePickerItem } from "@/server/plan/schema";
import { addCultureToScope, removeCultureFromScope } from "@/server/plan/actions";

// Combobox состава недели (B4c, BR-23). Кнопка «Культуры · N» + поповер с поиском и
// чекбоксами. Разметка/классы — вербатим из plan-scope-b4c.html. Механика (open/Esc/
// клик-вне/поиск/focus) — как FilterCombo. Состав — общий server-state: тогл свободной
// культуры пишет WeeklyPlanScope и перечитывает неделю. Закреплённые (есть цель/
// отгрузки) снять нельзя — клик поясняет причину, не молчит.

function Svg({
  children,
  size = 15,
  cls,
  width = 2,
}: {
  children: ReactNode;
  size?: number;
  cls?: string;
  width?: number;
}) {
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const listIcon = (
  <>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </>
);
const chevronDown = <polyline points="6 9 12 15 18 9" />;
const searchIcon = (
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </>
);
const checkIcon = <polyline points="20 6 9 17 4 12" />;
const lockIcon = (
  <>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </>
);
const infoIcon = (
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </>
);

const REASON_TEXT: Record<"target" | "shipments", string> = {
  target: "есть цель",
  shipments: "есть отгрузки",
};

type ScopeComboProps = {
  seasonYear: number;
  isoYear: number;
  isoWeek: number;
  items: ScopePickerItem[];
  count: number; // N — число видимых строк (= week.rows.length)
  open: boolean;
  setOpen: (v: boolean) => void;
  reload: () => Promise<void>;
};

export function ScopeCombo({
  seasonYear,
  isoYear,
  isoWeek,
  items,
  count,
  open,
  setOpen,
  reload,
}: ScopeComboProps) {
  const { data: session } = useSession();
  const canEdit = session?.user?.role === "admin";
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [shakeId, setShakeId] = useState<number | null>(null);
  const [roTip, setRoTip] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Закрытие по клику вне / Esc (как FilterCombo).
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
  }, [open, setOpen]);

  // Read-only тултип скрываем по клику вне.
  useEffect(() => {
    if (!roTip) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setRoTip(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [roTip]);

  function handleButtonClick() {
    if (!canEdit) {
      setRoTip((v) => !v);
      return;
    }
    setOpen(!open);
  }

  function shake(cultureId: number) {
    setShakeId(cultureId);
    window.setTimeout(() => setShakeId((id) => (id === cultureId ? null : id)), 520);
  }

  async function toggleFree(item: ScopePickerItem) {
    if (busy) return;
    setBusy(true);
    const res = item.selected
      ? await removeCultureFromScope({ isoYear, isoWeek, cultureId: item.cultureId })
      : await addCultureToScope({
          seasonYear,
          isoYear,
          isoWeek,
          cultureId: item.cultureId,
        });
    if (res.ok) await reload();
    setBusy(false);
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter((o) => o.cultureName.toLowerCase().includes(q))
    : items;
  const locked = shown.filter((o) => o.locked);
  const free = shown.filter((o) => !o.locked);

  const active = count > 0;
  const btnCls = [
    "scope-btn",
    active ? "active" : "",
    open ? "open" : "",
    canEdit ? "" : "ro",
  ]
    .filter(Boolean)
    .join(" ");

  function renderOpt(o: ScopePickerItem) {
    const scbCls = [
      "scb",
      o.selected ? "checked" : "",
      o.locked ? "locked" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const optCls = [
      "scope-opt",
      o.locked ? "locked" : "",
      shakeId === o.cultureId ? "shake" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        key={o.cultureId}
        className={optCls}
        role="checkbox"
        aria-checked={o.selected}
        aria-disabled={o.locked}
        tabIndex={0}
        onClick={() => (o.locked ? shake(o.cultureId) : toggleFree(o))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (o.locked) shake(o.cultureId);
            else toggleFree(o);
          }
        }}
      >
        <span className={scbCls}>
          <Svg size={12} width={3.2}>
            {checkIcon}
          </Svg>
        </span>
        <span className="chip" style={{ background: o.color }} />
        <span className="nm">{o.cultureName}</span>
        {o.locked && o.lockReason && (
          <span className="rsn">
            <Svg size={11}>{lockIcon}</Svg>
            {REASON_TEXT[o.lockReason]}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="scope-anchor" ref={wrapRef}>
      <button
        type="button"
        className={btnCls}
        aria-expanded={open}
        aria-disabled={!canEdit}
        onClick={handleButtonClick}
      >
        <span className="lead">
          <Svg size={15}>{listIcon}</Svg>
          Культуры
        </span>
        <span className="cnt">{count}</span>
        <Svg cls="caret" size={14}>
          {chevronDown}
        </Svg>
      </button>

      {!canEdit && roTip && (
        <div className="ro-tip">
          <Svg size={13}>{infoIcon}</Svg>
          Состав задаёт администратор
        </div>
      )}

      {canEdit && open && (
        <div className="scope-pop">
          <div className="scope-search">
            <Svg size={15}>{searchIcon}</Svg>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти культуру…"
            />
          </div>
          <div className="scope-list">
            {shown.length === 0 ? (
              <div className="scope-empty">Ничего не найдено</div>
            ) : (
              <>
                {locked.length > 0 && (
                  <>
                    <div className="scope-sec">
                      Закреплены активностью <span className="ln" />
                    </div>
                    {locked.map(renderOpt)}
                  </>
                )}
                {free.length > 0 && (
                  <>
                    <div className="scope-sec">
                      Свободные · добавить под план <span className="ln" />
                    </div>
                    {free.map(renderOpt)}
                  </>
                )}
              </>
            )}
          </div>
          <div className="scope-foot">
            <span className="applied">
              <Svg size={13} width={2.4}>
                {checkIcon}
              </Svg>
              Сохраняется сразу · <b>{count}</b> в плане
            </span>
            <span className="esc">Esc — закрыть</span>
          </div>
        </div>
      )}
    </div>
  );
}
