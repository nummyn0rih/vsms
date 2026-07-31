"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  shiftSettlementPeriod,
  type SettlementPeriod,
  type SettlementPeriodKind,
} from "@/server/farmers/settlement-period";

// Переключатель периода расчётного листа. Состояние — ТОЛЬКО в URL
// (?period=&from=&to=), без localStorage: конвенция проекта, лист должен переживать
// перезагрузку и пересылаться ссылкой.
//
// Вся арифметика периодов — в чистом settlement-period.ts (покрыт юнит-тестами);
// здесь только запись параметров. Импорт именно оттуда, а не из settlement-agg:
// тот тянет Prisma.Decimal, которому в браузерном бандле не место.

const KINDS: { kind: SettlementPeriodKind; label: string }[] = [
  { kind: "season", label: "Сезон" },
  { kind: "month", label: "Месяц" },
  { kind: "week", label: "Неделя" },
  { kind: "custom", label: "Период" },
];

export function SettlementPeriodBar({
  period,
  today,
}: {
  period: SettlementPeriod;
  today: string; // todayLocalISO() с сервера — браузер не должен считать «сегодня» сам
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [from, setFrom] = useState(period.from ?? today);
  const [to, setTo] = useState(period.to ?? today);

  function push(next: { period?: string; from?: string | null; to?: string | null }) {
    const sp = new URLSearchParams(params.toString());
    sp.set("tab", "settlement");
    if (next.period) sp.set("period", next.period);
    for (const key of ["from", "to"] as const) {
      const value = next[key];
      if (value == null) sp.delete(key);
      else sp.set(key, value);
    }
    router.replace(`${pathname}?${sp.toString()}`);
  }

  function pickKind(kind: SettlementPeriodKind) {
    // Сезон — без границ; месяц/неделя — от «сегодня» (границы посчитает сервер по
    // якорю); свой диапазон — из полей формы.
    if (kind === "season") return push({ period: "season", from: null, to: null });
    if (kind === "custom") return push({ period: "custom", from, to });
    push({ period: kind, from: today, to: null });
  }

  function shift(dir: -1 | 1) {
    const next = shiftSettlementPeriod(period, dir);
    push({ period: next.kind, from: next.from, to: null });
  }

  const canShift = period.kind === "month" || period.kind === "week";

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/20 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {KINDS.map((k) => (
            <Button
              key={k.kind}
              type="button"
              size="sm"
              variant={period.kind === k.kind ? "secondary" : "ghost"}
              onClick={() => pickKind(k.kind)}
            >
              {k.label}
            </Button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {canShift && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => shift(-1)}
              aria-label="Предыдущий период"
            >
              <ChevronLeft />
            </Button>
          )}
          <span className="min-w-[9rem] text-center text-sm font-medium">
            {period.label}
          </span>
          {canShift && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => shift(1)}
              aria-label="Следующий период"
            >
              <ChevronRight />
            </Button>
          )}
        </div>
      </div>

      {period.kind === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Календаря shadcn в проекте нет — нативный input[type=date]. */}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 rounded-lg border bg-background px-2 text-sm tabular-nums"
            aria-label="Начало периода"
          />
          <span className="text-sm text-muted-foreground">–</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 rounded-lg border bg-background px-2 text-sm tabular-nums"
            aria-label="Конец периода"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!from || !to || from > to}
            onClick={() => push({ period: "custom", from, to })}
          >
            Применить
          </Button>
          {from > to && (
            <span className="text-xs text-muted-foreground">
              начало периода позже конца
            </span>
          )}
        </div>
      )}
    </div>
  );
}
