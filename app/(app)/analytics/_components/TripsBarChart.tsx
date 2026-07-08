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

type Row = { tcName: string; veg: number; material: number };

// Рейсы ТК: сгруппированные бары veg/material раздельно (BR-14), графитовая шкала.
export function TripsBarChart({ data }: { data: Row[] }) {
  if (data.length === 0) {
    return (
      <div className="an-empty">
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 17h4V5H2v12h3" />
            <path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1" />
            <circle cx="7.5" cy="17.5" r="2.5" />
            <circle cx="17.5" cy="17.5" r="2.5" />
          </svg>
        </div>
        <div className="t">Данных пока нет</div>
        <div className="d">Рейсы появятся с первыми прибывшими машинами сезона.</div>
      </div>
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="32%">
          <CartesianGrid vertical={false} stroke="#ebebeb" />
          <XAxis
            dataKey="tcName"
            interval={0}
            tickLine={false}
            axisLine={{ stroke: "#a1a1a1", strokeOpacity: 0.55 }}
            tick={{ fontSize: 10.5, fill: "#888888" }}
          />
          <YAxis
            width={34}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10.5, fill: "#888888" }}
          />
          <Tooltip
            cursor={{ fill: "#00000006" }}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #ebebeb",
              fontSize: 12,
              boxShadow: "0 8px 16px -4px #0000000f",
            }}
          />
          <Bar dataKey="veg" name="овощные" fill="#2f2f2f" radius={[2, 2, 0, 0]} maxBarSize={34} isAnimationActive={false} />
          <Bar dataKey="material" name="материальные" fill="#bdbdbd" radius={[2, 2, 0, 0]} maxBarSize={34} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <div className="an-legend">
        <span>
          <span className="sw" style={{ background: "#2f2f2f" }} />
          овощные рейсы
        </span>
        <span>
          <span className="sw" style={{ background: "#bdbdbd" }} />
          материальные рейсы
        </span>
      </div>
    </>
  );
}
