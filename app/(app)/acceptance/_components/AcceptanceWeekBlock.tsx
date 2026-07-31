"use client";

import { ChevronRight } from "lucide-react";

import { formatWeekSpan } from "@/app/(app)/shipments/_components/week-format";
import type { WeekGroup } from "@/server/acceptance/board-weeks";
import { pluralRu } from "@/server/shipments/format";

// Блок недели на доске приёмки. Вёрстка шапки — по WeekBlock ленты, но БЕЗ класса
// week-head: он sticky по --toolbar-h, а тулбар /acceptance не sticky и переменную не
// задаёт (шапка липла бы к нулю вьюпорта). Тот же выбор сделан в MaterialWeekBlock.
// week=null → корзина «Без даты прибытия» (arrivalDate по типу nullable).
// Список карточек приходит children — разметка карточек одна на оба вида доски.
export function AcceptanceWeekBlock({
  week,
  cultures,
  count,
  collapsed,
  onToggle,
  children,
}: {
  week: Pick<WeekGroup<unknown>, "isoWeek" | "startDate" | "endDate"> | null;
  cultures: { cultureId: number; name: string; color: string }[];
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 first:mt-0">
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
          {week ? `W${week.isoWeek}` : "—"}
        </span>
        <span className="text-[15px] tracking-tight whitespace-nowrap">
          {week ? (
            <>
              <span className="font-semibold text-[#171717]">Неделя {week.isoWeek}</span>
              <span className="font-normal text-muted-foreground">
                {" · "}
                <span className="tabular-nums">
                  {formatWeekSpan(week.startDate, week.endDate)}
                </span>
              </span>
            </>
          ) : (
            <span className="font-semibold text-[#171717]">Без даты прибытия</span>
          )}
        </span>

        {/* Чипы культур недели — без тоннажа: в зонах 1/2 вес плановый/фактический,
            в зоне 3 принятый, единая цифра в шапке врала бы. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {cultures.map((c) => (
            <span
              key={c.cultureId}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#ebebeb] bg-card px-2 py-0.5 text-xs text-foreground/80"
            >
              <span
                className="inline-block size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: c.color }}
              />
              {c.name}
            </span>
          ))}
        </div>

        <span className="ml-auto text-[13px] whitespace-nowrap text-muted-foreground">
          <b className="font-medium tabular-nums text-[#171717]">{count}</b>{" "}
          {pluralRu(count, "машина", "машины", "машин")}
        </span>
      </button>

      {!collapsed && <div className="py-1.5 pl-7">{children}</div>}
    </div>
  );
}
