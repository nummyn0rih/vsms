"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fmtTons } from "@/lib/format";
import type { AnalyticsWeek } from "@/server/farmers/analytics-agg";

// Динамика приёмки фермера по ISO-неделям в разрезе культур (вкладка «Аналитика»).
// НЕЗАВИСИМЫЕ линии, а не стек: вопрос экрана — «как идёт каждая культура», а не «сколько
// всего»; итог по неделе и так есть в тултипе.
//
// Порог показа (недель с поставками ≥ 4) считает ядро — сюда компонент попадает уже готовым
// к рисованию; при меньшем числе точек панель рисует таблицу.
// Тема осей и тултипа — общая с QualityBrakChart, вторую не заводим.
//
// Динамические ключи серий (c12, c7…) живут ТОЛЬКО здесь: доменному типу AnalyticsWeek
// знать о форме строки Recharts незачем.

type Series = { cultureId: number; name: string; color: string };

const keyOf = (cultureId: number) => `c${cultureId}`;

export function FarmerWeeksChart({
  weeks,
  series,
  height = 220,
}: {
  weeks: AnalyticsWeek[];
  series: Series[];
  height?: number;
}) {
  const nameByKey = new Map(series.map((s) => [keyOf(s.cultureId), s.name]));
  const rows = weeks.map((w) => {
    const row: Record<string, number | string> = { label: w.label };
    for (const b of w.byCulture) row[keyOf(b.cultureId)] = b.tons;
    return row;
  });

  return (
    <div className="fq-chart">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#ebebeb" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "#a1a1a1", strokeOpacity: 0.55 }}
            tickMargin={8}
            tick={{ fontSize: 10.5, fill: "#888888" }}
            interval="preserveStartEnd"
          />
          <YAxis
            width={34}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10.5, fill: "#888888" }}
          />
          <Tooltip
            cursor={{ stroke: "#a1a1a1", strokeOpacity: 0.4 }}
            formatter={(value, key) => [
              `${fmtTons(Number(value))} т`,
              nameByKey.get(String(key)) ?? String(key),
            ]}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #ebebeb",
              fontSize: 12,
              boxShadow: "0 8px 16px -4px #0000000f",
            }}
          />
          {series.map((s) => (
            <Line
              key={s.cultureId}
              type="linear"
              dataKey={keyOf(s.cultureId)}
              stroke={s.color}
              strokeWidth={1.9}
              dot={false}
              activeDot={{ r: 3.5, fill: "#ffffff", stroke: s.color, strokeWidth: 1.8 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {/* Легенда — своя разметка, а не <Legend>: та ставит подписи в ряд по центру и
          ломает сетку карточки (тот же приём в QualityBrakChart). */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        {series.map((s) => (
          <span key={s.cultureId} className="inline-flex items-center gap-2">
            <span
              className="inline-block h-0.5 w-5 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
