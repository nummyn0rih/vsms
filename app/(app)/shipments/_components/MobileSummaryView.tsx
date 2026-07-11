"use client";

import { Clock, LayoutGrid } from "lucide-react";

import type { PlanWeek } from "@/server/plan/schema";
import { fmtTons } from "@/lib/format";
import { EPS, cellFill, rowMax, rowPlan, weekBarGeometry, weekHeadline } from "./summary-fill";

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function shortWeekday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return WEEKDAY_SHORT[(d.getUTCDay() + 6) % 7];
}

// Мобильная Сводка (md:hidden) — карточный heatmap по культурам, тот же getPlanWeek
// и та же чистая логика интенсивности/итогов (summary-fill.ts), что десктопная
// SummaryView. Read-only: только навигация недели/сегмента (владеет MobileShipmentsFeed).
export function MobileSummaryView({
  week,
  loading,
}: {
  week: PlanWeek | null;
  loading: boolean;
}) {
  if (loading && !week) {
    return (
      <div className="feedzone" style={{ padding: 40, color: "var(--mute)" }}>
        Загрузка сводки…
      </div>
    );
  }
  if (!week) {
    return (
      <div className="feedzone">
        <div className="empty">
          <h3>Не удалось загрузить сводку</h3>
          <p>Проверьте подключение и попробуйте сменить неделю.</p>
        </div>
      </div>
    );
  }

  if (week.rows.length === 0) {
    return (
      <div className="m-empty">
        <div className="ec-ic">
          <LayoutGrid />
        </div>
        <div className="et">На этой неделе пусто</div>
        <div className="ed">Нет ни целей, ни отгрузок на неделе {week.isoWeek}.</div>
        <div className="ea">Смените неделю или задайте план на десктопе.</div>
      </div>
    );
  }

  const days = week.days;
  const { plan, fact, pct } = weekHeadline(week);
  const { actualPct, planPct, overPct, tickLeft, hasPlan } = weekBarGeometry(week);

  return (
    <>
      <div className="scards">
        {week.rows.map((r) => {
          const isWeek = r.mode === "week";
          const rPlan = rowPlan(r);
          const rFact = r.weekProgress.effectiveTons;
          const rHasPlan = rPlan > EPS;
          const rPct = rHasPlan ? Math.round((rFact / rPlan) * 100) : null;

          const maxCell = rowMax(r, days);

          return (
            <div key={r.cultureId} className="scard">
              <div className="scard-top">
                <span className="scard-cult">
                  <span className="chip" style={{ background: r.color }} />
                  {r.cultureName}
                  {isWeek && <span className="wk-badge">неделя</span>}
                </span>
                <span className="scard-tot">
                  <span className="fact tnum">{fmtTons(rFact)} т</span>
                  {rPct != null && (
                    <span className={`pct tnum${rPct > 100 ? " over" : ""}`}>{rPct}%</span>
                  )}
                </span>
              </div>

              {isWeek ? (
                <div className="scard-wk">
                  <Clock />
                  Цель задана на неделю · факт <b>{fmtTons(rFact)} т</b> за неделю (без дневной
                  разбивки)
                </div>
              ) : (
                <div
                  className="hstrip"
                  style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}
                >
                  {days.map((d) => {
                    const value = r.dayProgress[d.date]?.effectiveTons ?? 0;
                    const zero = value <= EPS;
                    const { bg, white } = cellFill(value, maxCell, r.color);
                    return (
                      <div
                        key={d.date}
                        className={`hcell${zero ? " zero" : " filled"}`}
                        style={bg ? { background: bg } : undefined}
                      >
                        <span className="hd" style={white ? { color: "#fff" } : undefined}>
                          {shortWeekday(d.date)}
                        </span>
                        <span className="hv" style={white ? { color: "#fff" } : undefined}>
                          {zero ? "·" : fmtTons(value)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="wtotal">
        <div className="wtotal-row">
          <span className="wtotal-lab">Набрано за неделю</span>
          <span className="wtotal-fig tnum">
            {fmtTons(fact)} т
            {hasPlan && <span className="goal">/ {fmtTons(plan)} т</span>}
            {pct != null && <span className="pctv">{pct}%</span>}
          </span>
        </div>
        <div className="pbar">
          {actualPct > 0 && (
            <div
              className={`bf actual${!hasPlan || planPct + overPct <= 0 ? " endcap" : ""}`}
              style={{ left: "0%", width: `${actualPct}%` }}
            />
          )}
          {planPct > 0 && (
            <div
              className={`bf plan${overPct <= 0 ? " endcap" : ""}`}
              style={{ left: `${actualPct}%`, width: `${planPct}%` }}
            />
          )}
          {overPct > 0 && (
            <div
              className="bf over endcap"
              style={{ left: `${actualPct + planPct}%`, width: `${overPct}%` }}
            />
          )}
          {tickLeft != null && <div className="btick" style={{ left: `${tickLeft}%` }} />}
        </div>
      </div>
    </>
  );
}
