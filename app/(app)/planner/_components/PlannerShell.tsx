"use client";

import { useEffect, useState } from "react";

import type { ShipmentOptions } from "@/server/shipments/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { useNavCollapse } from "@/components/layout/sidebar-collapse";
import { FeedToolbar } from "@/components/shell/FeedToolbar";
import { ShipmentFormDialog } from "@/app/(app)/shipments/_components/ShipmentFormDialog";
import {
  isoWeek as isoWeekOf,
  isoWeekRange,
  currentSeasonWeek,
  seasonWeekBounds,
  compareIsoWeek,
  formatWeekParam,
} from "@/server/shipments/workdays";
import { PlanView } from "./PlanView";
import { BoardView } from "./BoardView";
import { ScopeCombo } from "./ScopeCombo";
import { usePlanWeek } from "./usePlanWeek";
import { useBoardWeek } from "./useBoardWeek";
import { rowWeekTotal, planDayTotals, weekGrandTotal, EPS } from "./plan-totals";
import { downloadXlsx, type XlsxRow, t1, dayLabel } from "@/lib/xlsx-export";

type Week = { seasonYear: number; isoYear: number; isoWeek: number };
type View = "plan" | "board";

// Метка диапазона недели для тулбара (ISO Пн–Вс): «8 июня – 14 июня».
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
function planWeekSub(isoYear: number, week: number): string {
  const { start, end } = isoWeekRange(isoYear, week);
  return `${dayMonthFmt.format(start)} – ${dayMonthFmt.format(end)}`;
}

// Запись параметра в URL без ре-рендера серверного компонента (B5-nav): неделя/вид
// живут в URL, чтобы делиться с /shipments и переживать перезагрузку. Остальные
// параметры сохраняются.
function writeUrlParam(key: string, value: string) {
  const sp = new URLSearchParams(window.location.search);
  sp.set(key, value);
  window.history.replaceState(null, "", `?${sp.toString()}`);
}

const VIEWS = [
  { key: "board", label: "Доска" },
  { key: "plan", label: "План" },
];

export function PlannerShell({
  initialWeek,
  initialView,
  options,
}: {
  initialWeek: Week;
  initialView: View;
  options: ShipmentOptions;
}) {
  const [week, setWeek] = useState<Week>(initialWeek);
  const [view, setView] = useState<View>(initialView);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // Лоадеры читают ОДНУ неделю; enabled — фетчим только активный вид.
  const plan = usePlanWeek({ ...week, enabled: view === "plan" });
  const board = useBoardWeek({ ...week, enabled: view === "board" });

  // Доске нужна ширина — сворачиваем сайдбар на вид «Доска», разворачиваем вне его
  // (и при уходе со страницы). Ручной тоггл пользователя на доске уважается до
  // следующей смены вида/маршрута (логика в NavCollapseProvider).
  const { setAuto } = useNavCollapse();
  useEffect(() => {
    setAuto(view === "board");
    return () => setAuto(false);
  }, [view, setAuto]);

  function changeView(v: string) {
    if (v !== "plan" && v !== "board") return;
    setView(v);
    writeUrlParam("view", v);
  }

  function stepWeek(delta: number) {
    setWeek((p) => {
      const { start } = isoWeekRange(p.isoYear, p.isoWeek);
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + delta * 7);
      const w = isoWeekOf(d);
      // Не уходим за границы сезона (BR-17) — на краю остаёмся на месте.
      const b = seasonWeekBounds(p.seasonYear);
      if (compareIsoWeek(w, b.first) < 0 || compareIsoWeek(w, b.last) > 0) return p;
      const next = { seasonYear: p.seasonYear, isoYear: w.isoYear, isoWeek: w.isoWeek };
      writeUrlParam("week", formatWeekParam(next));
      return next;
    });
  }
  function goToday() {
    const c = currentSeasonWeek();
    const next = { seasonYear: c.seasonYear, isoYear: c.isoYear, isoWeek: c.isoWeek };
    setWeek(next);
    writeUrlParam("week", formatWeekParam(next));
  }

  const today = currentSeasonWeek();
  const isCurrent = week.isoYear === today.isoYear && week.isoWeek === today.isoWeek;
  const bounds = seasonWeekBounds(week.seasonYear);
  const atFirst = compareIsoWeek(week, bounds.first) <= 0;
  const atLast = compareIsoWeek(week, bounds.last) >= 0;

  const createButton = (
    <RoleGate allow={["admin"]}>
      <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
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

  // «Печать» → landscape-лист /print/plan с текущей неделей (print-2). Только вид «План».
  const printSlot =
    view === "plan" ? (
      <a
        href={`/print/plan?week=${formatWeekParam(week)}`}
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
    ) : null;

  // Экспорт Excel Плана: строка = культура, по каждому рабочему дню пара «факт/цель»,
  // затем Цель/Факт/%/Δ + итоговая строка. Тот же источник, что таблица и /print/plan.
  const pw = plan.week;
  const exportSlot =
    view === "plan" && pw ? (
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          const columns = [
            "Культура",
            ...pw.days.flatMap((d) => [`${dayLabel(d.date)} факт`, `${dayLabel(d.date)} цель`]),
            "Цель",
            "Факт",
            "%",
            "Δ",
          ];
          const rows: XlsxRow[] = [];
          for (const r of pw.rows) {
            const target = rowWeekTotal(r);
            const fact = r.weekProgress.effectiveTons;
            const hasTarget = target > EPS;
            const row: XlsxRow = { "Культура": r.cultureName };
            for (const d of pw.days) {
              const eff = r.dayProgress[d.date]?.effectiveTons ?? 0;
              const tgt = r.dayTargets[d.date];
              row[`${dayLabel(d.date)} факт`] = eff > EPS ? t1(eff) : null;
              row[`${dayLabel(d.date)} цель`] = tgt != null ? t1(tgt) : null;
            }
            row["Цель"] = hasTarget ? t1(target) : null;
            row["Факт"] = t1(fact);
            row["%"] = hasTarget ? Math.round((fact / target) * 100) : null;
            row["Δ"] = hasTarget ? t1(fact - target) : null;
            rows.push(row);
          }
          const dayTotals = planDayTotals(pw);
          const total: XlsxRow = { "Культура": "Итого" };
          for (let i = 0; i < pw.days.length; i++) {
            total[`${dayLabel(pw.days[i].date)} факт`] = t1(pw.dayTotalsProgress[i]?.effectiveTons ?? 0);
            total[`${dayLabel(pw.days[i].date)} цель`] = t1(dayTotals[i] ?? 0);
          }
          total["Цель"] = t1(weekGrandTotal(pw));
          total["Факт"] = t1(pw.weekTotalProgress.effectiveTons);
          total["%"] = null;
          total["Δ"] = null;
          rows.push(total);
          downloadXlsx({
            rows,
            columns,
            sheetName: "План",
            fileName: `vsms-план-${pw.seasonYear}-W${String(pw.isoWeek).padStart(2, "0")}.xlsx`,
          });
        }}
      >
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
    ) : null;

  return (
    <div>
      <FeedToolbar
        createSlot={createButton}
        weekLabel={`Неделя ${week.isoWeek}`}
        weekSub={planWeekSub(week.isoYear, week.isoWeek)}
        onPrevWeek={() => stepWeek(-1)}
        onNextWeek={() => stepWeek(1)}
        onToday={goToday}
        prevDisabled={atFirst}
        nextDisabled={atLast}
        todayActive={!isCurrent}
        viewMode={view}
        onViewChange={changeView}
        views={VIEWS}
        showFilters={false}
        printSlot={printSlot}
        exportSlot={exportSlot}
        scopeSlot={
          view === "plan" && plan.week ? (
            <ScopeCombo
              seasonYear={week.seasonYear}
              isoYear={week.isoYear}
              isoWeek={week.isoWeek}
              items={plan.week.scopePicker}
              count={plan.week.rows.length}
              open={scopeOpen}
              setOpen={setScopeOpen}
              reload={plan.reload}
            />
          ) : null
        }
      />

      {view === "board" ? (
        <BoardView
          week={board.week}
          loading={board.loading}
          options={options}
          reload={board.reload}
          onOpenPlan={() => changeView("plan")}
        />
      ) : (
        <PlanView
          seasonYear={week.seasonYear}
          isoYear={week.isoYear}
          isoWeek={week.isoWeek}
          week={plan.week}
          setWeek={plan.setWeek}
          loading={plan.loading}
          version={plan.version}
          reload={plan.reload}
          onOpenScope={() => setScopeOpen(true)}
        />
      )}

      {createDialog}
    </div>
  );
}
