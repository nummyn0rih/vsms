"use client";

import { ChevronRight } from "lucide-react";

import { type MaterialWeek, weekTotalsByType } from "@/server/materials/feed";
import type { MaterialOptions } from "@/server/materials/schema";
import { pluralRu } from "@/server/shipments/format";
import { MaterialTareIcon } from "./MaterialTareIcon";
import { MaterialTripCard } from "./MaterialTripCard";

const nf = new Intl.NumberFormat("ru-RU");
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "UTC" });
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const tripsWord = (n: number) => pluralRu(n, "рейс", "рейса", "рейсов");

// «22–28 июня 2026» (если месяц совпадает — день–день месяц).
function weekRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const left =
    s.getUTCMonth() === e.getUTCMonth() ? dayFmt.format(s) : dayMonthFmt.format(s);
  return `${left}–${dayMonthFmt.format(e)} ${e.getUTCFullYear()}`;
}

export function MaterialWeekBlock({
  week,
  options,
  collapsed,
  onToggle,
}: {
  week: MaterialWeek;
  options: MaterialOptions;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const totals = weekTotalsByType(week.trips);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 select-none hover:bg-muted/50 ${
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
          <span className="font-normal text-muted-foreground">
            {" · "}
            <span className="tabular-nums">{weekRange(week.startDate, week.endDate)}</span>
          </span>
        </span>

        {/* Чипы тары — динамически по встреченным типам (иконка по kind). */}
        <div className="flex flex-wrap items-center gap-1.5">
          {totals.map((t) => (
            <span
              key={t.packagingTypeId}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#ebebeb] bg-white px-2 py-0.5 text-xs tracking-tight text-[#4d4d4d]"
            >
              <MaterialTareIcon kind={t.kind} className="size-3 shrink-0 text-muted-foreground" />
              {t.name}{" "}
              <b className="font-semibold tabular-nums text-[#171717]">{nf.format(t.qty)} шт</b>
            </span>
          ))}
        </div>

        <span className="ml-auto text-[13px] whitespace-nowrap text-muted-foreground">
          <b className="font-medium tabular-nums text-[#171717]">{week.trips.length}</b>{" "}
          {tripsWord(week.trips.length)}
        </span>
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-2.5 py-1.5 pl-7">
          {week.trips.map((trip) => (
            <MaterialTripCard key={trip.id} trip={trip} options={options} />
          ))}
        </div>
      )}
    </div>
  );
}
