"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  filterFeedWeeks,
  feedOptionCounts,
  type Feed,
  type FeedShipment,
  type FeedWeek,
} from "@/server/shipments/feed";
import type { ShipmentOptions } from "@/server/shipments/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import {
  isoWeekRange,
  formatWeekParam,
  isoWeek as isoWeekOf,
  seasonWeekBounds,
  compareIsoWeek,
  currentSeasonWeek,
} from "@/server/shipments/workdays";
import { WeekBlock } from "./WeekBlock";
import { ShipmentFormDialog } from "./ShipmentFormDialog";
import { FeedToolbar } from "@/components/shell/FeedToolbar";
import { downloadXlsx, type XlsxRow } from "@/lib/xlsx-export";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { FilterCombo } from "@/components/filters/FilterCombo";
import { weekKey, formatWeekRange, writeUrlParam } from "./week-format";
import { SummaryView } from "./SummaryView";
import { usePlanWeek } from "@/app/(app)/planner/_components/usePlanWeek";

export type Week = { seasonYear: number; isoYear: number; isoWeek: number };
type View = "lenta" | "summary";

// Виды /shipments (B5-nav): Лента (быв. Таблица) + Сводка (быв. Heatmap,
// плейсхолдер). План/Доска переехали на /planner.
const VIEWS = [
  { key: "lenta", label: "Лента" },
  { key: "summary", label: "Сводка" },
];

// Диапазон недели для метки тулбара (ISO Пн–Вс): «8 июня – 14 июня».
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
function weekRangeSub(isoYear: number, week: number): string {
  const { start, end } = isoWeekRange(isoYear, week);
  return `${dayMonthFmt.format(start)} – ${dayMonthFmt.format(end)}`;
}

type Status = FeedShipment["status"];

// Фикс-набор статусов для фильтра (порядок жизненного цикла, RU-метки).
const STATUS_OPTIONS: ReadonlyArray<readonly [Status, string]> = [
  ["planned", "Плановая"],
  ["sent", "Отправлена"],
  ["arrived", "Прибыла"],
  ["accepted", "Принята"],
];
const STATUS_LABEL = new Map<Status, string>(STATUS_OPTIONS);

// Иконки кнопок фильтров (stroke-пути, вербатим из toolbar-states.html).
const supplierIcon = (
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>
);
const cultureIcon = <path d="M11 2 4 6v6c0 5 3 7.5 7 9 4-1.5 7-4 7-9V6z" />;

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

// Имена выбранных опций для подсказки «Пусто после фильтра».
function selectedNames(
  opts: { id: number; name: string }[],
  sel: Set<number>,
): string {
  return opts
    .filter((o) => sel.has(o.id))
    .map((o) => o.name)
    .join(", ");
}

export function ShipmentsFeed({
  feed,
  options,
  initialWeek,
  initialView,
}: {
  feed: Feed;
  options: ShipmentOptions;
  initialWeek: Week;
  initialView: View;
}) {
  const weeks = feed.weeks;

  // Вид (Лента/Сводка) — из URL (?view). replaceState не ре-рендерит сервер, поэтому
  // держим локальный стейт, засеянный сервером, и пишем URL при переключении.
  const [view, setView] = useState<View>(initialView);
  function onViewChange(v: string) {
    if (v !== "lenta" && v !== "summary") return;
    setView(v);
    writeUrlParam("view", v);
  }

  // --- Вид «Сводка»: своя неделя (локальный стейт, засеян URL) + лоадер getPlanWeek
  // (тот же источник, что у вида «План»). Навигация недели пишет ?week (replaceState)
  // и рефетчит данные через хук — как PlannerShell. ---
  const [summaryWeek, setSummaryWeek] = useState<Week>(initialWeek);
  const plan = usePlanWeek({ ...summaryWeek, enabled: view === "summary" });

  function summaryStepWeek(delta: number) {
    setSummaryWeek((p) => {
      const { start } = isoWeekRange(p.isoYear, p.isoWeek);
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + delta * 7);
      const w = isoWeekOf(d);
      const b = seasonWeekBounds(p.seasonYear);
      if (compareIsoWeek(w, b.first) < 0 || compareIsoWeek(w, b.last) > 0) return p;
      const next = { seasonYear: p.seasonYear, isoYear: w.isoYear, isoWeek: w.isoWeek };
      writeUrlParam("week", formatWeekParam(next));
      return next;
    });
  }
  function summaryGoToday() {
    const c = currentSeasonWeek();
    const next = { seasonYear: c.seasonYear, isoYear: c.isoYear, isoWeek: c.isoWeek };
    setSummaryWeek(next);
    writeUrlParam("week", formatWeekParam(next));
  }
  const summaryToday = currentSeasonWeek();
  const summaryIsCurrent =
    summaryWeek.isoYear === summaryToday.isoYear &&
    summaryWeek.isoWeek === summaryToday.isoWeek;
  const summaryBounds = seasonWeekBounds(summaryWeek.seasonYear);
  const summaryAtFirst = compareIsoWeek(summaryWeek, summaryBounds.first) <= 0;
  const summaryAtLast = compareIsoWeek(summaryWeek, summaryBounds.last) >= 0;

  // --- Состояние фильтров (React state, без localStorage) ---
  const [search, setSearch] = useState("");
  const [supplierSel, setSupplierSel] = useState<Set<number>>(new Set());
  const [cultureSel, setCultureSel] = useState<Set<number>>(new Set());
  const [statusSel, setStatusSel] = useState<Set<Status>>(new Set());
  const [hidePlanned, setHidePlanned] = useState(false);

  const anyFilterActive =
    search.trim() !== "" ||
    supplierSel.size > 0 ||
    cultureSel.size > 0 ||
    statusSel.size > 0 ||
    hidePlanned;

  const resetAll = useCallback(() => {
    setSearch("");
    setSupplierSel(new Set());
    setCultureSel(new Set());
    setStatusSel(new Set());
    setHidePlanned(false);
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

  // Видимые недели: фильтрация — клиентская, поверх загруженного дерева (feed.ts,
  // делит с мобильным фидом).
  const visibleWeeks = useMemo<FeedWeek[]>(
    () =>
      filterFeedWeeks(weeks, { search, supplierSel, cultureSel, statusSel, hidePlanned }),
    [weeks, search, supplierSel, cultureSel, statusSel, hidePlanned],
  );

  // Счётчики опций (.ct) — feed.ts, делит с мобильным фидом.
  const counts = useMemo(() => feedOptionCounts(weeks), [weeks]);

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

  // Создание отгрузки: диалог в controlled-режиме.
  const [createOpen, setCreateOpen] = useState(false);

  // Якорь «Сегодня»: текущая неделя, иначе ближайшая будущая, иначе последняя.
  const currentIndex = weeks.findIndex((w) => w.position === "current");
  const futureIndex = weeks.findIndex((w) => w.position === "future");
  const anchorIndex =
    currentIndex !== -1 ? currentIndex : futureIndex !== -1 ? futureIndex : weeks.length - 1;
  const currentKey = weeks.length > 0 ? weekKey(weeks[anchorIndex]) : "";

  // Стартовая неделя из URL (?week): скроллим к ней, если она есть в дереве сезона,
  // иначе к «Сегодня» (anchor). Неделя в URL глобальна — делится с /planner.
  const initialWeekKey = weekKey(initialWeek);
  const startKey =
    weeks.some((w) => weekKey(w) === initialWeekKey) ? initialWeekKey : currentKey;

  // Активная (просматриваемая) неделя — для метки тулбара. Обновляется scrollspy.
  const [activeKey, setActiveKey] = useState<string>(startKey);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const weekEls = useRef<Map<string, HTMLElement>>(new Map());

  // Текущий рендеримый (отфильтрованный) набор недель — для scrollspy в обработчике
  // скролла (синхронизируем через effect, без чтения ref во время рендера).
  const renderWeeksRef = useRef<FeedWeek[]>(visibleWeeks);
  useEffect(() => {
    renderWeeksRef.current = visibleWeeks;
  }, [visibleWeeks]);

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
        const list = renderWeeksRef.current;
        if (list.length === 0) return;
        const h = toolbar?.offsetHeight ?? 0;
        const containerTop = scroller ? scroller.getBoundingClientRect().top : 0;
        const line = containerTop + h + 4;
        let active = weekKey(list[0]);
        for (const w of list) {
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

    // Авто-скролл к стартовой неделе из URL (или к «Сегодня») при первом рендере.
    scrollToKey(startKey);

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

  // Три фильтра-комбобокса. Опции — справочники (active) + счётчики по дереву.
  const supplierCombo = (
    <FilterCombo
      kind="icon"
      label="Поставщик"
      icon={supplierIcon}
      options={options.farmers.map((f) => ({
        id: f.id,
        name: f.name,
        count: counts.farmer.get(f.id) ?? 0,
      }))}
      selected={supplierSel}
      onToggle={(id) => toggleNum(setSupplierSel, id as number)}
      onClear={() => setSupplierSel(new Set())}
      searchable
      searchPlaceholder="Найти поставщика…"
    />
  );
  const cultureCombo = (
    <FilterCombo
      kind="icon"
      label="Сырьё"
      icon={cultureIcon}
      options={options.cultures.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        count: counts.culture.get(c.id) ?? 0,
      }))}
      selected={cultureSel}
      onToggle={(id) => toggleNum(setCultureSel, id as number)}
      onClear={() => setCultureSel(new Set())}
      searchable
      searchPlaceholder="Найти культуру…"
    />
  );
  const statusCombo = (
    <FilterCombo
      kind="status"
      label="Статус"
      options={STATUS_OPTIONS.map(([id, name]) => ({
        id,
        name,
        count: counts.status.get(id) ?? 0,
      }))}
      selected={statusSel}
      onToggle={(id) =>
        setStatusSel((prev) => {
          const next = new Set(prev);
          const s = id as Status;
          if (next.has(s)) next.delete(s);
          else next.add(s);
          return next;
        })
      }
      onClear={() => setStatusSel(new Set())}
    />
  );

  // Пропсы тулбара, общие для всех веток (фильтры/поиск/тумблер/сброс).
  const filterProps = {
    search,
    onSearch: setSearch,
    onClearSearch: () => setSearch(""),
    supplierCombo,
    cultureCombo,
    statusCombo,
    hidePlanned,
    onToggleHidePlanned: () => setHidePlanned((v) => !v),
    showReset: anyFilterActive,
    onReset: resetAll,
  };

  // Общие пропсы видов в переключателе тулбара (Лента/Сводка).
  const viewProps = {
    views: VIEWS,
    viewMode: view,
    onViewChange,
  };

  // Вид «Сводка» (heatmap недели): данные — getPlanWeek по ?week (тот же источник,
  // что вид «План»). Неделя глобальна в URL, навигация рефетчит через usePlanWeek.
  if (view === "summary") {
    // «Печать» → landscape-лист /print/summary с текущей неделей (print-2).
    const summaryPrintSlot = (
      <a
        href={`/print/summary?week=${formatWeekParam(summaryWeek)}`}
        target="_blank"
        rel="noopener"
        className="btn btn-sm"
      >
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
    );
    return (
      <div ref={rootRef}>
        <FeedToolbar
          ref={toolbarRef}
          createSlot={createButton}
          weekLabel={`Неделя ${summaryWeek.isoWeek}`}
          weekSub={weekRangeSub(summaryWeek.isoYear, summaryWeek.isoWeek)}
          onPrevWeek={() => summaryStepWeek(-1)}
          onNextWeek={() => summaryStepWeek(1)}
          onToday={summaryGoToday}
          prevDisabled={summaryAtFirst}
          nextDisabled={summaryAtLast}
          todayActive={!summaryIsCurrent}
          showFilters={false}
          printSlot={summaryPrintSlot}
          {...viewProps}
        />
        <SummaryView week={plan.week} loading={plan.loading} />
        {createDialog}
      </div>
    );
  }

  // Пустой сезон — нет ни одной отгрузки (A6). Тулбар-фильтры тут роли не играют.
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
          showFilters
          {...viewProps}
          {...filterProps}
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

  // Навигация/метка недели — по отфильтрованному набору.
  const navWeeks = visibleWeeks;
  const activeIndex = Math.max(
    0,
    navWeeks.findIndex((w) => weekKey(w) === activeKey),
  );
  const activeWeek = navWeeks[activeIndex];
  const activeRange = activeWeek ? formatWeekRange(activeWeek).range : "";

  // «Печать» → print-роут с активными фильтрами (лента держит их в React-state, не в
  // URL, поэтому сериализуем сюда). Парсер — print/shipments/page. Режим/недели — в extra.
  const buildPrintHref = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (supplierSel.size) p.set("sup", [...supplierSel].join(","));
    if (cultureSel.size) p.set("cult", [...cultureSel].join(","));
    if (statusSel.size) p.set("st", [...statusSel].join(","));
    if (hidePlanned) p.set("hp", "1");
    if (search.trim()) p.set("q", search.trim());
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/print/shipments?${p.toString()}`;
  };

  // Раскрытые (не свёрнутые) недели — для режима печати «Раскрытые недели» и тумблера.
  const expandedWeeks = navWeeks.filter((w) => !collapsed.has(weekKey(w)));
  const weekHref = buildPrintHref({
    mode: "week",
    ...(activeWeek ? { week: formatWeekParam(activeWeek) } : {}),
  });
  const expandedHref = buildPrintHref({
    mode: "expanded",
    weeks: expandedWeeks.map(formatWeekParam).join(","),
  });
  const allHref = buildPrintHref({ mode: "all" });

  const printSlot = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="btn btn-sm">
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
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={weekHref} target="_blank" rel="noopener">
            Текущая неделя
          </a>
        </DropdownMenuItem>
        {expandedWeeks.length === 0 ? (
          <DropdownMenuItem disabled>Раскрытые недели</DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <a href={expandedHref} target="_blank" rel="noopener">
              Раскрытые недели
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href={allHref} target="_blank" rel="noopener">
            Вся лента (по фильтрам)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Тумблер «Развернуть/Свернуть все»: работает по видимым (отфильтрованным) неделям.
  const allExpanded = navWeeks.length > 0 && expandedWeeks.length === navWeeks.length;
  const toggleAll = () =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const w of navWeeks) {
        if (allExpanded) next.add(weekKey(w));
        else next.delete(weekKey(w));
      }
      return next;
    });
  const expandSlot = (
    <button type="button" className="btn btn-sm" onClick={toggleAll}>
      {allExpanded ? "Свернуть все" : "Развернуть все"}
    </button>
  );

  // Экспорт Excel: все недели по текущим фильтрам (visibleWeeks), строка = позиция.
  // Плоско — поля машины повторяются в каждой позиции. Числа — числами.
  const XLSX_COLUMNS = [
    "Неделя",
    "Дата прибытия",
    "№ машины",
    "Водитель",
    "Перевозчик",
    "Статус",
    "Культура",
    "Поставщик",
    "Тип тары",
    "Кол-во тары",
    "План кг",
    "Факт кг",
    "Принято кг",
  ];
  const exportXlsx = () => {
    const rows: XlsxRow[] = [];
    for (const w of visibleWeeks) {
      const weekLabel = `W${String(w.isoWeek).padStart(2, "0")}`;
      for (const day of w.days) {
        for (const m of day.shipments) {
          for (const it of m.items) {
            rows.push({
              "Неделя": weekLabel,
              "Дата прибытия": day.date,
              "№ машины": m.code,
              "Водитель": m.driverName ?? "",
              "Перевозчик": m.transportCompanyName ?? "",
              "Статус": STATUS_LABEL.get(m.status) ?? m.status,
              "Культура": it.cultureName,
              "Поставщик": it.farmerName,
              "Тип тары": it.packagingTypeName ?? "",
              "Кол-во тары": it.tareUnits,
              "План кг": it.plannedKg,
              "Факт кг": it.actualKg,
              "Принято кг": it.acceptedKg,
            });
          }
        }
      }
    }
    downloadXlsx({
      rows,
      columns: XLSX_COLUMNS,
      sheetName: "Отгрузки",
      fileName: `vsms-отгрузки-${feed.seasonYear}.xlsx`,
    });
  };
  const exportSlot = (
    <button type="button" className="btn btn-sm" onClick={exportXlsx}>
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
  );

  const toolbar = (
    <FeedToolbar
      ref={toolbarRef}
      createSlot={createButton}
      weekLabel={activeWeek ? `Неделя ${activeWeek.isoWeek}` : ""}
      weekSub={activeRange}
      onPrevWeek={() => {
        if (activeIndex > 0) {
          const w = navWeeks[activeIndex - 1];
          scrollToKey(weekKey(w));
          writeUrlParam("week", formatWeekParam(w)); // неделя глобальна — делится с /planner
        }
      }}
      onNextWeek={() => {
        if (activeIndex < navWeeks.length - 1) {
          const w = navWeeks[activeIndex + 1];
          scrollToKey(weekKey(w));
          writeUrlParam("week", formatWeekParam(w));
        }
      }}
      onToday={() => {
        scrollToKey(currentKey);
        if (weeks[anchorIndex]) writeUrlParam("week", formatWeekParam(weeks[anchorIndex]));
      }}
      prevDisabled={activeIndex <= 0}
      nextDisabled={activeIndex >= navWeeks.length - 1}
      todayActive={activeKey !== currentKey}
      showFilters
      printSlot={printSlot}
      expandSlot={expandSlot}
      exportSlot={exportSlot}
      {...viewProps}
      {...filterProps}
    />
  );

  // Пусто после фильтра (B7): данные в сезоне есть, но под фильтры не попало ничего.
  if (anyFilterActive && navWeeks.length === 0) {
    const parts: string[] = [];
    if (supplierSel.size)
      parts.push(`Поставщик · ${selectedNames(options.farmers, supplierSel)}`);
    if (cultureSel.size)
      parts.push(`Сырьё · ${selectedNames(options.cultures, cultureSel)}`);
    if (statusSel.size)
      parts.push(
        `Статус · ${[...statusSel].map((s) => STATUS_LABEL.get(s)).join(", ")}`,
      );
    if (hidePlanned) parts.push("без плановых");
    if (search.trim()) parts.push(`поиск «${search.trim()}»`);

    return (
      <div ref={rootRef}>
        {toolbar}
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
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="13.5" y1="8.5" x2="8.5" y2="13.5" />
                <line x1="8.5" y1="8.5" x2="13.5" y2="13.5" />
              </svg>
            </div>
            <h3>Ничего не найдено по фильтрам</h3>
            <p>Под текущие фильтры ({parts.join("; ")}) нет отгрузок.</p>
            <div className="actions">
              <button type="button" className="btn" onClick={resetAll}>
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
                Сбросить фильтры
              </button>
            </div>
          </div>
        </div>
        {createDialog}
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      {toolbar}

      <div>
        {navWeeks.map((week) => {
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
