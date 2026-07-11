"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Filter, PackageOpen, SearchX } from "lucide-react";

import {
  filterFeedWeeks,
  weekSummary,
  daySummary,
  type Feed,
  type FeedShipment,
  type FeedWeek,
} from "@/server/shipments/feed";
import type { ShipmentOptions } from "@/server/shipments/schema";
import { formatTareTotals } from "@/server/shipments/format";
import {
  formatWeekParam,
  isoWeekRange,
  isoWeek as isoWeekOf,
  seasonWeekBounds,
  compareIsoWeek,
  currentSeasonWeek,
} from "@/server/shipments/workdays";
import { weekKey, formatWeekRange, writeUrlParam } from "./week-format";
import type { Week } from "./ShipmentsFeed";
import { CultureChip, formatTons } from "./FeedChips";
import { MobileMachineCard } from "./MobileMachineCard";
import { MobileFilterSheet } from "./MobileFilterSheet";
import { MobileSummaryView } from "./MobileSummaryView";
import { usePlanWeek } from "@/app/(app)/planner/_components/usePlanWeek";

type Status = FeedShipment["status"];
type View = "lenta" | "summary";

const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
// Короткий диапазон недели («8–13 июня») для шапки вида «Сводка» — своя неделя
// (не связана с days из FeedWeek), считаем напрямую из isoWeekRange.
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "UTC" });
function isoWeekRangeLabel(isoYear: number, isoWeek: number): string {
  const { start, end } = isoWeekRange(isoYear, isoWeek);
  return `${dayFmt.format(start)}–${dayMonthFmt.format(end)}`;
}

function EmptyBlock({
  title,
  text,
  onReset,
}: {
  title: string;
  text: string;
  onReset?: () => void;
}) {
  return (
    <div className="m-empty">
      <div className="ec-ic">{onReset ? <SearchX /> : <PackageOpen />}</div>
      <div className="et">{title}</div>
      <div className="ed">{text}</div>
      {onReset && (
        <button type="button" className="btn btn-sm" onClick={onReset} style={{ marginTop: 14 }}>
          Сбросить фильтры
        </button>
      )}
    </div>
  );
}

function ViewSegment({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="mseg">
      <button
        type="button"
        className={view === "lenta" ? "active" : ""}
        onClick={() => onChange("lenta")}
      >
        Лента
      </button>
      <button
        type="button"
        className={view === "summary" ? "active" : ""}
        onClick={() => onChange("summary")}
      >
        Сводка
      </button>
    </div>
  );
}

// Мобильная карточная лента (md:hidden) — та же серверная выборка (getFeed), те же
// чистые хелперы (weekSummary/daySummary/filterFeedWeeks — feed.ts), что десктопная
// ShipmentsFeed. Read-only: без создания/правки/статусных действий. Сегмент
// «Лента | Сводка» — вид в ?view (writeUrlParam, общий с десктопом); Сводка грузит
// getPlanWeek тем же usePlanWeek-хуком, что десктопная ShipmentsFeed. Неделя ленты
// навигируется тапами по W##-бару и пишется в ?week, без scrollspy — проще
// desktop-механики, т.к. список короче и обычно не требует авто-детекта на скролле.
// Неделя Сводки — отдельный стейт (не привязан к данным ленты), зеркалит десктопную
// ветку «Сводка» в ShipmentsFeed.tsx (summaryStepWeek/summaryGoToday).
export function MobileShipmentsFeed({
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

  const [view, setView] = useState<View>(initialView);
  function onViewChange(v: View) {
    setView(v);
    writeUrlParam("view", v);
  }

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
  const summaryBounds = seasonWeekBounds(summaryWeek.seasonYear);
  const summaryAtFirst = compareIsoWeek(summaryWeek, summaryBounds.first) <= 0;
  const summaryAtLast = compareIsoWeek(summaryWeek, summaryBounds.last) >= 0;

  const [supplierSel, setSupplierSel] = useState<Set<number>>(new Set());
  const [cultureSel, setCultureSel] = useState<Set<number>>(new Set());
  const [statusSel, setStatusSel] = useState<Set<Status>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);

  const anyFilterActive = supplierSel.size > 0 || cultureSel.size > 0 || statusSel.size > 0;
  const filterCount = supplierSel.size + cultureSel.size + statusSel.size;

  function toggleNum(setSet: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function resetAll() {
    setSupplierSel(new Set());
    setCultureSel(new Set());
    setStatusSel(new Set());
  }

  const navWeeks = filterFeedWeeks(weeks, {
    search: "",
    supplierSel,
    cultureSel,
    statusSel,
    hidePlanned: false,
  });

  // Свёрнутость недель — прошлые свёрнуты, текущая/будущие развёрнуты (как десктоп).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const w of weeks) if (w.position === "past") s.add(weekKey(w));
    return s;
  });
  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Якорь «Сегодня»: текущая неделя, иначе ближайшая будущая, иначе последняя.
  const currentIndex = weeks.findIndex((w) => w.position === "current");
  const futureIndex = weeks.findIndex((w) => w.position === "future");
  const anchorIndex = currentIndex !== -1 ? currentIndex : futureIndex !== -1 ? futureIndex : weeks.length - 1;
  const currentKey = weeks.length > 0 ? weekKey(weeks[anchorIndex]) : "";

  const initialWeekKey = weekKey(initialWeek);
  const startKey = weeks.some((w) => weekKey(w) === initialWeekKey) ? initialWeekKey : currentKey;
  const [activeKey, setActiveKey] = useState(startKey);

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

  useEffect(() => {
    scrollToKey(startKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeIndex = Math.max(0, navWeeks.findIndex((w) => weekKey(w) === activeKey));
  const activeWeek = navWeeks[activeIndex];
  const activeRange = activeWeek ? formatWeekRange(activeWeek).range : "";
  const prevDisabled = activeIndex <= 0;
  const nextDisabled = activeIndex >= navWeeks.length - 1;

  function onPrevWeek() {
    if (activeIndex > 0) {
      const w = navWeeks[activeIndex - 1];
      const k = weekKey(w);
      setActiveKey(k);
      scrollToKey(k);
      writeUrlParam("week", formatWeekParam(w));
    }
  }
  function onNextWeek() {
    if (activeIndex < navWeeks.length - 1) {
      const w = navWeeks[activeIndex + 1];
      const k = weekKey(w);
      setActiveKey(k);
      scrollToKey(k);
      writeUrlParam("week", formatWeekParam(w));
    }
  }
  function onToday() {
    setActiveKey(currentKey);
    scrollToKey(currentKey);
    if (weeks[anchorIndex]) writeUrlParam("week", formatWeekParam(weeks[anchorIndex]));
  }

  return (
    <>
      <div className="mweekbar">
        <div className="mweekbar-row">
          <ViewSegment view={view} onChange={onViewChange} />
        </div>

        {view === "summary" ? (
          <div className="mweekbar-row">
            <div className="mweeknav">
              <button
                type="button"
                title="Предыдущая неделя"
                onClick={() => summaryStepWeek(-1)}
                disabled={summaryAtFirst}
              >
                <ChevronLeft />
              </button>
              <div className="wlab">
                <span className="wm">W{summaryWeek.isoWeek}</span>{" "}
                {isoWeekRangeLabel(summaryWeek.isoYear, summaryWeek.isoWeek)}
              </div>
              <button
                type="button"
                title="Следующая неделя"
                onClick={() => summaryStepWeek(1)}
                disabled={summaryAtLast}
              >
                <ChevronRight />
              </button>
            </div>
            <button type="button" className="today-btn" onClick={summaryGoToday}>
              Сегодня
            </button>
          </div>
        ) : (
          <div className="mweekbar-row">
            <div className="mweeknav">
              <button type="button" title="Предыдущая неделя" onClick={onPrevWeek} disabled={prevDisabled}>
                <ChevronLeft />
              </button>
              <div className="wlab">
                <span className="wm">W{activeWeek?.isoWeek ?? ""}</span> {activeRange}
              </div>
              <button type="button" title="Следующая неделя" onClick={onNextWeek} disabled={nextDisabled}>
                <ChevronRight />
              </button>
            </div>
            <button type="button" className="today-btn" onClick={onToday}>
              Сегодня
            </button>
            <button type="button" className="filter-btn" onClick={() => setSheetOpen(true)}>
              Фильтры
              {filterCount > 0 && <span className="fdot">{filterCount}</span>}
              <Filter />
            </button>
          </div>
        )}
      </div>

      {view === "summary" ? (
        <MobileSummaryView week={plan.week} loading={plan.loading} />
      ) : weeks.length === 0 ? (
        <EmptyBlock
          title="Пока нет отгрузок"
          text={`В сезоне ${feed.seasonYear} ещё не заведено ни одной отгрузки.`}
        />
      ) : anyFilterActive && navWeeks.length === 0 ? (
        <EmptyBlock
          title="Ничего не найдено по фильтрам"
          text="Под текущие фильтры нет отгрузок."
          onReset={resetAll}
        />
      ) : (
        navWeeks.map((week: FeedWeek) => {
          const key = weekKey(week);
          const isCollapsed = collapsed.has(key);
          const summary = weekSummary(week);
          const { range: rangeLabel } = formatWeekRange(week);

          return (
            <div key={key} ref={setWeekRef(key)}>
              <button
                type="button"
                className={`mweek-head${isCollapsed ? " collapsed" : ""}`}
                onClick={() => toggleCollapse(key)}
              >
                <div className="mweek-top">
                  <span className="mweek-num">W{week.isoWeek}</span>
                  <span className="mweek-title">Неделя {week.isoWeek}</span>
                  <span className="mweek-tot">
                    <b>{summary.machineCount}</b> машин · <b>{formatTons(summary.totalKg)}&nbsp;т</b>
                  </span>
                </div>
                {!isCollapsed && rangeLabel && (
                  <div className="mchips">
                    {summary.cultures.map((c) => (
                      <CultureChip key={c.cultureId} culture={c} />
                    ))}
                  </div>
                )}
              </button>

              {!isCollapsed &&
                week.days.map((day) => {
                  const dsum = daySummary(day);
                  const dateLabel = dayMonthFmt.format(new Date(`${day.date}T00:00:00Z`));
                  const weekday = day.weekdayName.charAt(0).toUpperCase() + day.weekdayName.slice(1);
                  const hasTare = dsum.tare.boxes > 0 || dsum.tare.barrels > 0;

                  if (day.shipments.length === 0) {
                    return (
                      <div key={day.date} className="mday-empty">
                        <span className="dow">
                          {weekday}, {dateLabel}
                        </span>{" "}
                        — нет отгрузок
                      </div>
                    );
                  }

                  return (
                    <div key={day.date}>
                      <div className="mday-head">
                        <span className="mday-date">
                          <span className="dow">{weekday},</span> {dateLabel}
                        </span>
                        {hasTare && (
                          <span className="mday-tara">
                            тара: <b>{formatTareTotals(dsum.tare.boxes, dsum.tare.barrels)}</b>
                          </span>
                        )}
                      </div>
                      <div className="mcards">
                        {day.shipments.map((s) => (
                          <MobileMachineCard key={s.id} shipment={s} />
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })
      )}

      <MobileFilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        weeks={weeks}
        options={options}
        supplierSel={supplierSel}
        cultureSel={cultureSel}
        statusSel={statusSel}
        onToggleSupplier={(id) => toggleNum(setSupplierSel, id)}
        onToggleCulture={(id) => toggleNum(setCultureSel, id)}
        onToggleStatus={(status) =>
          setStatusSel((prev) => {
            const next = new Set(prev);
            if (next.has(status)) next.delete(status);
            else next.add(status);
            return next;
          })
        }
        onReset={resetAll}
      />
    </>
  );
}
