"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fmtTons } from "@/lib/format";

type Point = { label: string; tons: number };

// Динамика приёмки по ISO-неделям (area + линия, графит). Read-only.
export function AcceptanceAreaChart({ data }: { data: Point[] }) {
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
        <div className="d">Приёмки только начались — динамика появится с первыми актами.</div>
      </div>
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
            formatter={(value) => [`${fmtTons(Number(value))} т`, "приёмка"]}
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
            stroke="#2f2f2f"
            strokeWidth={1.75}
            fill="#171717"
            fillOpacity={0.06}
            dot={{ r: 2.6, fill: "#ffffff", stroke: "#2f2f2f", strokeWidth: 1.5 }}
            activeDot={{ r: 3.4, fill: "#ffffff", stroke: "#2f2f2f", strokeWidth: 1.5 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="an-legend">
        <span>
          <span className="sw" style={{ background: "#2f2f2f" }} />
          приёмка, суммарно по всем культурам
        </span>
      </div>
    </>
  );
}
