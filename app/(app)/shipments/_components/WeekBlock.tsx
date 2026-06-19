"use client";

import { forwardRef } from "react";
import { ChevronRight } from "lucide-react";

import { type FeedWeek, weekSummary } from "@/server/shipments/feed";
import type { ShipmentOptions } from "@/server/shipments/schema";
import { DayBlock } from "./DayBlock";
import { CultureChip, formatTons } from "./FeedChips";
import { formatWeekRange } from "./week-format";

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export const WeekBlock = forwardRef<
  HTMLDivElement,
  {
    week: FeedWeek;
    options: ShipmentOptions;
    collapsed: boolean;
    onToggle: () => void;
  }
>(function WeekBlock({ week, options, collapsed, onToggle }, ref) {
  const summary = weekSummary(week);

  // Диапазон рабочих дней недели: «8–13 июня» + «(Пн–Сб)».
  const { range: rangeLabel, span: spanLabel } = formatWeekRange(week);

  return (
    <div
      ref={ref}
      className="mt-4"
      style={{ scrollMarginTop: "var(--toolbar-h, 0px)" }}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`week-head flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 select-none hover:bg-muted/50 ${
          collapsed ? "border border-[#ebebeb] bg-[#fafafa]" : ""
        }`}
      >
        <ChevronRight
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${
            collapsed ? "" : "rotate-90"
          }`}
        />
        <span className="rounded-[5px] border border-[#ebebeb] bg-[#f5f5f5] px-[7px] py-0.5 font-mono text-xs text-[#888888]">
          W{week.isoWeek}
        </span>
        <span className="text-[15px] tracking-tight whitespace-nowrap">
          <span className="font-semibold text-[#171717]">Неделя {week.isoWeek}</span>
          {rangeLabel && (
            <span className="font-normal text-muted-foreground">
              {" · "}
              <span className="tabular-nums">{rangeLabel}</span> {week.isoYear} ({spanLabel})
            </span>
          )}
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {summary.cultures.map((c) => (
            <CultureChip key={c.cultureId} culture={c} />
          ))}
        </div>

        <span className="ml-auto text-[13px] whitespace-nowrap text-muted-foreground">
          <b className="font-medium tabular-nums text-[#171717]">{summary.machineCount}</b>{" "}
          {plural(summary.machineCount, "машина", "машины", "машин")} ·{" "}
          <b className="font-medium tabular-nums text-[#171717]">{formatTons(summary.totalKg)}</b> т
        </span>
      </button>

      {!collapsed && (
        <div>
          {week.days.map((day) => (
            <DayBlock key={day.date} day={day} options={options} />
          ))}
        </div>
      )}
    </div>
  );
});
