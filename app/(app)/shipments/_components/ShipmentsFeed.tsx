"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Feed } from "@/server/shipments/feed";
import type { ShipmentOptions } from "@/server/shipments/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { WeekBlock } from "./WeekBlock";
import { ShipmentFormDialog } from "./ShipmentFormDialog";
import { FeedToolbar } from "./FeedToolbar";
import { weekKey, formatWeekRange } from "./week-format";

// Ближайший скроллящийся предок (контейнер <main> в app-оболочке).
function getScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return el;
    el = el.parentElement;
  }
  return null;
}

export function ShipmentsFeed({
  feed,
  options,
}: {
  feed: Feed;
  options: ShipmentOptions;
}) {
  const weeks = feed.weeks;

  // Якорь «Сегодня»: текущая неделя, иначе ближайшая будущая, иначе последняя.
  const currentIndex = weeks.findIndex((w) => w.position === "current");
  const futureIndex = weeks.findIndex((w) => w.position === "future");
  const anchorIndex =
    currentIndex !== -1 ? currentIndex : futureIndex !== -1 ? futureIndex : weeks.length - 1;
  const currentKey = weeks.length > 0 ? weekKey(weeks[anchorIndex]) : "";

  // Свёрнутость недель в React-state (НЕ localStorage). Прошлые свёрнуты,
  // текущая и будущие развёрнуты (DESIGN §2).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const w of weeks) {
      if (w.position === "past") s.add(weekKey(w));
    }
    return s;
  });

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Создание отгрузки: диалог в controlled-режиме, открывается из тулбара/пустого
  // состояния кнопкой в стиле прототипа (.btn-primary, 40px).
  const [createOpen, setCreateOpen] = useState(false);

  // Активная (просматриваемая) неделя — для метки тулбара. Обновляется scrollspy.
  const [activeKey, setActiveKey] = useState<string>(currentKey);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const weekEls = useRef<Map<string, HTMLElement>>(new Map());

  const setWeekRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) weekEls.current.set(key, el);
      else weekEls.current.delete(key);
    },
    [],
  );

  const scrollToKey = useCallback((key: string) => {
    weekEls.current.get(key)?.scrollIntoView({ block: "start" });
  }, []);

  // --toolbar-h (для top sticky-шапок недель) + scrollspy + авто-скролл к текущей.
  useEffect(() => {
    if (weeks.length === 0) return;
    const toolbar = toolbarRef.current;
    const scroller = getScrollParent(rootRef.current);

    const setToolbarH = () => {
      const h = toolbar?.offsetHeight ?? 0;
      document.documentElement.style.setProperty("--toolbar-h", `${h}px`);
    };
    setToolbarH();
    const ro = toolbar ? new ResizeObserver(setToolbarH) : null;
    if (toolbar) ro!.observe(toolbar);

    // Активна последняя неделя, чья шапка уже дошла до залипшей линии (top ≤ линия).
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const h = toolbar?.offsetHeight ?? 0;
        const containerTop = scroller ? scroller.getBoundingClientRect().top : 0;
        const line = containerTop + h + 4;
        let active = weekKey(weeks[0]);
        for (const w of weeks) {
          const el = weekEls.current.get(weekKey(w));
          if (!el) continue;
          if (el.getBoundingClientRect().top <= line) active = weekKey(w);
          else break;
        }
        setActiveKey((prev) => (prev === active ? prev : active));
      });
    };
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });

    // Авто-скролл к текущей неделе при первом рендере (поведение 17b).
    scrollToKey(currentKey);

    return () => {
      ro?.disconnect();
      target.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Кнопка «+ Отгрузка» (под RoleGate) — общий слот для тулбара и пустого сезона.
  const createButton = (
    <RoleGate allow={["admin"]}>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => setCreateOpen(true)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Отгрузка
      </button>
    </RoleGate>
  );

  const createDialog = (
    <ShipmentFormDialog
      mode="create"
      options={options}
      showTrigger={false}
      open={createOpen}
      onOpenChange={setCreateOpen}
    />
  );

  // Пустой сезон — нет ни одной отгрузки (A6).
  if (weeks.length === 0) {
    return (
      <div ref={rootRef}>
        <FeedToolbar
          ref={toolbarRef}
          createSlot={createButton}
          weekLabel={`Сезон ${feed.seasonYear}`}
          weekSub=""
          onPrevWeek={() => {}}
          onNextWeek={() => {}}
          onToday={() => {}}
          prevDisabled
          nextDisabled
          todayActive={false}
        />
        <div className="feedzone">
          <div className="empty">
            <div className="ill">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              </svg>
            </div>
            <h3>Пока нет отгрузок</h3>
            <p>
              В сезоне {feed.seasonYear} ещё не заведено ни одной отгрузки. Создайте
              первую — она появится в ленте по дням недели.
            </p>
            <div className="actions">{createButton}</div>
          </div>
        </div>
        {createDialog}
      </div>
    );
  }

  const activeIndex = Math.max(
    0,
    weeks.findIndex((w) => weekKey(w) === activeKey),
  );
  const activeWeek = weeks[activeIndex];
  const { range: activeRange } = formatWeekRange(activeWeek);

  return (
    <div ref={rootRef}>
      <FeedToolbar
        ref={toolbarRef}
        createSlot={createButton}
        weekLabel={`Неделя ${activeWeek.isoWeek}`}
        weekSub={activeRange}
        onPrevWeek={() => {
          if (activeIndex > 0) scrollToKey(weekKey(weeks[activeIndex - 1]));
        }}
        onNextWeek={() => {
          if (activeIndex < weeks.length - 1)
            scrollToKey(weekKey(weeks[activeIndex + 1]));
        }}
        onToday={() => scrollToKey(currentKey)}
        prevDisabled={activeIndex <= 0}
        nextDisabled={activeIndex >= weeks.length - 1}
        todayActive={activeKey !== currentKey}
      />

      <div>
        {weeks.map((week) => {
          const key = weekKey(week);
          return (
            <WeekBlock
              key={key}
              ref={setWeekRef(key)}
              week={week}
              options={options}
              collapsed={collapsed.has(key)}
              onToggle={() => toggle(key)}
            />
          );
        })}
      </div>

      {createDialog}
    </div>
  );
}
