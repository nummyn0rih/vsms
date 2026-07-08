"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { fmtPct1 } from "@/lib/format";

type Row = { cultureId: number; cultureName: string; color: string; pct: number };

// % брака по культурам (верт. бары, нейтральный янтарь). База — Σ(actual×brak%)/Σactual.
export function BrakBarChart({ data }: { data: Row[] }) {
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
        <div className="d">Брак считается по завершённым актам приёмки — их ещё нет в этом сезоне.</div>
      </div>
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#ebebeb" />
          <XAxis dataKey="cultureName" hide />
          <YAxis
            width={34}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10.5, fill: "#888888" }}
          />
          <Bar dataKey="pct" fill="#cf9a3e" radius={[2, 2, 0, 0]} maxBarSize={56} isAnimationActive={false}>
            <LabelList
              dataKey="pct"
              position="top"
              formatter={(value) => fmtPct1(Number(value))}
              style={{ fontSize: 10.5, fill: "#4d4d4d", fontWeight: 500 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="an-brak-cats">
        {data.map((d) => (
          <span key={d.cultureId} className="cat">
            <span className="chip" style={{ background: d.color }} />
            <span className="nm">{d.cultureName}</span>
          </span>
        ))}
      </div>
    </>
  );
}
