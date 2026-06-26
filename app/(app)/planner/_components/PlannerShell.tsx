"use client";

import { useState } from "react";

import type { ShipmentOptions } from "@/server/shipments/schema";
import { RoleGate } from "@/components/auth/RoleGate";
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
  { key: "plan", label: "План" },
  { key: "board", label: "Доска" },
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
