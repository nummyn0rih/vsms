"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fmtTons } from "@/lib/format";

type Point = { label: string; tons: number; planTons: number | null };

// Динамика приёмки культуры по ISO-неделям: area цветом культуры + плановый темп
// пунктиром (WeeklyPlan). Плановая линия рендерится только при hasPlan.
export function CultureAreaChart({
  data,
  color,
  cultureName,
  hasPlan,
}: {
  data: Point[];
  color: string;
  cultureName: string;
  hasPlan: boolean;
}) {
  if (data.length === 0) {
    return (
      <div className="an-empty">
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="m7 14 3-3 3 3 5-6" />
          </svg>
        </div>
        <div className="t">Данных пока нет</div>
        <div className="d">По этой культуре в сезоне ещё нет приёмок и планов на недели.</div>
      </div>
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#ebebeb" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "#a1a1a1", strokeOpacity: 0.55 }}
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
            formatter={(value, name) => [
              `${fmtTons(Number(value))} т`,
              name === "planTons" ? "план" : "приёмка",
            ]}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #ebebeb",
              fontSize: 12,
              boxShadow: "0 8px 16px -4px #0000000f",
            }}
          />
          <Area
            type="linear"
            dataKey="tons"
            stroke={color}
            strokeWidth={1.9}
            fill={color}
            fillOpacity={0.1}
            dot={{ r: 2.6, fill: "#ffffff", stroke: color, strokeWidth: 1.5 }}
            activeDot={{ r: 3.4, fill: "#ffffff", stroke: color, strokeWidth: 1.5 }}
            isAnimationActive={false}
          />
          {hasPlan && (
            <Line
              type="linear"
              dataKey="planTons"
              stroke="#a1a1a1"
              strokeWidth={1.25}
              strokeDasharray="4 4"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="an-legend">
        <span>
          <span className="sw" style={{ background: color }} />
          приёмка — {cultureName}
        </span>
        {hasPlan && (
          <span>
            <span
              className="sw"
              style={{ height: 0, borderTop: "2px dashed #a1a1a1", borderRadius: 0 }}
            />
            плановый темп (WeeklyPlan)
          </span>
        )}
      </div>
    </>
  );
}
