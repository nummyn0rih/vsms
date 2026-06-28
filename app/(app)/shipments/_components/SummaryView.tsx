"use client";

import type { PlanWeek, PlanRow } from "@/server/plan/schema";
import { fmtTons } from "@/lib/format";

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
// Короткая дата для шапки дня: «29.06».
const dayNumFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

function shortWeekday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return WEEKDAY_SHORT[(d.getUTCDay() + 6) % 7];
}
function dayMonth(dateStr: string): string {
  return dayMonthFmt.format(new Date(`${dateStr}T00:00:00Z`));
}
function dayNum(dateStr: string): string {
  return dayNumFmt.format(new Date(`${dateStr}T00:00:00Z`));
}

const EPS = 0.0005;

// План культуры для итогов: недельная цель или Σ дневных целей (0 → нет цели).
function rowPlan(r: PlanRow): number {
  if (r.weekTarget != null) return r.weekTarget;
  return Object.values(r.dayTargets).reduce((s, v) => s + v, 0);
}

// Заливка ячейки по строке (BR-22): интенсивность ∝ значение / макс. ячейка строки.
// opacity% = 18 + 82·value/rowMax (минимальный видимый порог 18%), нулевая → без фона.
// Текст белый при насыщенной заливке (порог по читаемости, как в прототипе).
const WHITE_TEXT_OPACITY = 58;
function cellFill(value: number, rowMax: number, color: string): { bg?: string; white: boolean } {
  if (value <= EPS || rowMax <= 0) return { white: false };
  const opacity = Math.round(18 + 82 * (value / rowMax));
  return {
    bg: `color-mix(in srgb, ${color} ${opacity}%, transparent)`,
    white: opacity >= WHITE_TEXT_OPACITY,
  };
}

export function SummaryView({
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

  const days = week.days;

  // Headline (BR-22): Σ эффективного / Σ целей — только культуры, у которых есть план.
  let headlinePlan = 0;
  let headlineFact = 0;
  for (const r of week.rows) {
    const plan = rowPlan(r);
    if (plan > EPS) {
      headlinePlan += plan;
      headlineFact += r.weekProgress.effectiveTons;
    }
  }
  const headlinePct =
    headlinePlan > EPS ? Math.round((headlineFact / headlinePlan) * 100) : null;

  return (
    <div className="summary-view">
      <div className="ctx">
        <span className="week-num">W{week.isoWeek}</span>
        <span className="week-title">
          Неделя {week.isoWeek}{" "}
          <span className="wmeta">
            · {dayMonth(week.startDate)} – {dayMonth(week.endDate)} · сезон {week.seasonYear}
          </span>
        </span>
        <span className="head-metric">
          {headlinePct != null ? (
            <>
              Выполнение недели{" "}
              <b className="tnum">
                {fmtTons(headlineFact)} / {fmtTons(headlinePlan)} т
              </b>{" "}
              · {headlinePct}%
            </>
          ) : (
            <>План недели не задан</>
          )}
        </span>
      </div>

      {week.rows.length === 0 ? (
        <div className="feedzone">
          <div className="empty">
            <h3>На этой неделе пусто</h3>
            <p>Нет ни целей, ни отгрузок. Задайте план в планировщике или смените неделю.</p>
          </div>
        </div>
      ) : (
        <div className="hm-wrap">
          <table className="hm">
            <thead>
              <tr>
                <th className="cor">Культура</th>
                {days.map((d) => (
                  <th key={d.date}>
                    {shortWeekday(d.date)}
                    <span className="dnum">{dayNum(d.date)}</span>
                  </th>
                ))}
                <th className="tot sep">План</th>
                <th className="tot">Факт</th>
                <th className="tot">%</th>
                <th className="tot">Δ</th>
              </tr>
            </thead>
            <tbody>
              {week.rows.map((r) => {
                const isWeek = r.mode === "week";
                const plan = rowPlan(r);
                const fact = r.weekProgress.effectiveTons;
                const hasPlan = plan > EPS;
                const pct = hasPlan ? (fact / plan) * 100 : null;
                const delta = fact - plan;

                // Макс. дневная ячейка строки — база интенсивности заливки.
                const rowMax = isWeek
                  ? 0
                  : days.reduce(
                      (m, d) => Math.max(m, r.dayProgress[d.date]?.effectiveTons ?? 0),
                      0,
                    );

                return (
                  <tr key={r.cultureId}>
                    <td className="cult">
                      <span className="nm">
                        <span className="dot" style={{ background: r.color }} />
                        {r.cultureName}
                        {isWeek && <span className="wk-badge">неделя</span>}
                      </span>
                    </td>

                    {isWeek ? (
                      <td className="cell wkmode" colSpan={days.length}>
                        <span className="v">
                          цель задана на неделю · факт {fmtTons(fact)} т за неделю
                        </span>
                      </td>
                    ) : (
                      days.map((d) => {
                        const value = r.dayProgress[d.date]?.effectiveTons ?? 0;
                        const zero = value <= EPS;
                        const { bg, white } = cellFill(value, rowMax, r.color);
                        return (
                          <td
                            key={d.date}
                            className={`cell${zero ? " zero" : ""}`}
                            style={bg ? { background: bg } : undefined}
                          >
                            <span className="v" style={white ? { color: "#fff" } : undefined}>
                              {zero ? "·" : fmtTons(value)}
                            </span>
                          </td>
                        );
                      })
                    )}

                    <td className="tot plan sep">{hasPlan ? fmtTons(plan) : "—"}</td>
                    <td className="tot fact">{fmtTons(fact)}</td>
                    <td className="tot pct">
                      {pct != null ? (
                        <span className="pctbar">
                          <span className="track">
                            <span
                              className={`fill${pct > 100 ? " over" : ""}`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </span>
                          <span className="lbl">{Math.round(pct)}%</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      className={`tot delta${
                        hasPlan ? (delta >= 0 ? " pos" : " neg") : ""
                      }`}
                    >
                      {hasPlan
                        ? `${delta >= 0 ? "+" : "−"}${fmtTons(Math.abs(delta))}`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="cult">Итого по дням</td>
                {days.map((d, i) => (
                  <td key={d.date}>
                    {fmtTons(week.dayTotalsProgress[i]?.effectiveTons ?? 0)}
                  </td>
                ))}
                <td className="tot sep" />
                <td className="tot fact">{fmtTons(week.weekTotalProgress.effectiveTons)}</td>
                <td className="tot" />
                <td className="tot" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
