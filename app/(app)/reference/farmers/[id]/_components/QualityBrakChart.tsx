"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fmtPct1 } from "@/lib/format";

type Row = { label: string; pct: number };

// Динамика брака фермера по ISO-неделям (вкладка «Качество»). ЛИНИЯ, а не бары, как на
// профиле культуры: там сравниваются недели между собой, здесь важен ТРЕНД одного
// поставщика и его отношение к собственному среднему за сезон (пунктир).
//
// Порог показа (недель с актами ≥ 4) считает ядро — сюда компонент попадает уже готовым
// к рисованию; при меньшем числе точек панель рисует таблицу недель.
// Тема осей и тултипа — общая с графиками аналитики, вторую не заводим.
export function QualityBrakChart({
  data,
  avgPct,
  height = 200,
}: {
  data: Row[];
  avgPct: number | null;
  height?: number;
}) {
  return (
    <div className="fq-chart">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
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
            formatter={(value) => [`${fmtPct1(Number(value))}%`, "брак"]}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #ebebeb",
              fontSize: 12,
              boxShadow: "0 8px 16px -4px #0000000f",
            }}
          />
          {avgPct != null && (
            <ReferenceLine
              y={avgPct}
              stroke="#a1a1a1"
              strokeWidth={1.25}
              strokeDasharray="4 4"
              strokeOpacity={0.7}
            />
          )}
          <Line
            type="linear"
            dataKey="pct"
            stroke="#cf9a3e"
            strokeWidth={2}
            dot={{ r: 3, fill: "#ffffff", stroke: "#cf9a3e", strokeWidth: 1.6 }}
            activeDot={{ r: 4, fill: "#ffffff", stroke: "#cf9a3e", strokeWidth: 1.8 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {/* Легенда — своя разметка, а не <Legend>: та ставит подписи в ряд по центру и
          ломает сетку карточки (тот же приём в графиках аналитики). */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-0.5 w-5 rounded-sm bg-[#cf9a3e]" />
          брак фермера по неделе
        </span>
        {avgPct != null && (
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-5 border-t-2 border-dashed border-[#a1a1a1]" />
            средний за сезон ({fmtPct1(avgPct)}%)
          </span>
        )}
      </div>
    </div>
  );
}
