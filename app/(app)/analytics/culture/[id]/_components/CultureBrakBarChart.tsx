"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fmtPct1 } from "@/lib/format";

type Row = { label: string; pct: number };

// % брака культуры по ISO-неделям (нейтральный янтарь). База — Σ(actual×brak%)/Σactual.
export function CultureBrakBarChart({ data }: { data: Row[] }) {
  if (data.length === 0) {
    return (
      <div className="an-empty">
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <rect x="7" y="12" width="3" height="6" />
            <rect x="14" y="8" width="3" height="10" />
          </svg>
        </div>
        <div className="t">Данных пока нет</div>
        <div className="d">
          Брак считается по завершённым актам приёмки — по этой культуре их ещё нет в сезоне.
        </div>
      </div>
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#ebebeb" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "#ebebeb" }}
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
            cursor={{ fill: "#17171708" }}
            formatter={(value) => [`${fmtPct1(Number(value))}%`, "брак"]}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #ebebeb",
              fontSize: 12,
              boxShadow: "0 8px 16px -4px #0000000f",
            }}
          />
          <Bar
            dataKey="pct"
            fill="#cf9a3e"
            radius={[2, 2, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
      <div className="an-legend">
        <span>
          <span className="sw" style={{ background: "#cf9a3e" }} />
          брак по неделе прибытия
        </span>
      </div>
    </>
  );
}
