import { getPlanWeek } from "@/server/plan/board";
import { parseWeekParam } from "@/server/shipments/workdays";
import {
  EPS,
  planDayTotals,
  planHeadlineEffective,
  rowWeekTotal,
  weekGrandTotal,
} from "@/app/(app)/planner/_components/plan-totals";
import { fmtTons } from "@/lib/format";
import { PrintSheet } from "../_components/PrintSheet";

// Печатный лист «План недели» (print-2, A4 landscape). Read-only, источник — getPlanWeek
// (те же величины, что десктоп PlanView; итоги — из plan-totals, не дублируем). Ячейка =
// «факт / цель» по дням (BR-22); week-mode — спан (BR-23); без прогресс-баров.

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
function shortWeekday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return WEEKDAY_SHORT[(d.getUTCDay() + 6) % 7];
}
function dayMonth(dateStr: string): string {
  return dayMonthFmt.format(new Date(`${dateStr}T00:00:00Z`)).replace(".", "");
}

// Ячейка «факт / цель» (порт DayCaption из PlanView): цель есть → «эфф / цель»;
// нет цели, но есть факт → «эфф»; иначе «—».
function DayCell({ eff, target }: { eff: number; target: number | null }) {
  if (target != null) {
    return (
      <>
        <span className={eff <= EPS ? "dim" : undefined}>{fmtTons(eff)}</span>{" "}
        <span className="dim">/ {fmtTons(target)}</span>
      </>
    );
  }
  if (eff > EPS) return <>{fmtTons(eff)}</>;
  return <span className="dim">—</span>;
}

export default async function PrintPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const wk = parseWeekParam(sp.week);
  const week = await getPlanWeek({
    seasonYear: wk.seasonYear,
    isoYear: wk.isoYear,
    isoWeek: wk.isoWeek,
  });

  const days = week.days;
  const wkNum = `W${String(week.isoWeek).padStart(2, "0")}`;
  const period = `${wkNum} · ${dayMonth(week.startDate)} – ${dayMonth(week.endDate)}`;

  const dayTotals = planDayTotals(week);
  const grandTarget = weekGrandTotal(week);
  const weekEffective = week.weekTotalProgress.effectiveTons;
  const headlineEffective = planHeadlineEffective(week);
  const headlinePct = grandTarget > EPS ? Math.round((headlineEffective / grandTarget) * 100) : null;
  const shortfall = grandTarget - headlineEffective;

  return (
    <PrintSheet
      title="План недели"
      subtitle="Недельные цели по культурам · в ячейке дня «факт / цель», т"
      season={`Сезон ${week.seasonYear}`}
      period={period}
      periodLabel="Неделя"
      landscape
      filters={<>Прогресс = Σ эффективного веса / цель · <b>факт перевески, иначе план</b></>}
      footTotal={
        grandTarget > EPS ? (
          <>
            <b>Итого недели:</b> набрано <span className="num">{fmtTons(headlineEffective)} т</span> из
            цели <span className="num">{fmtTons(grandTarget)} т</span> · выполнение{" "}
            <span className="num">{headlinePct}%</span>
            {shortfall > EPS && (
              <>
                {" "}· недобор <span className="num">{fmtTons(shortfall)} т</span>
              </>
            )}
          </>
        ) : (
          <>
            <b>Итого недели:</b> план не задан
          </>
        )
      }
      footPage={`План · ${wkNum} · лист 1/1`}
    >
      <table className="dt">
        <colgroup>
          <col style={{ width: "20%" }} />
          {days.map((d) => (
            <col key={d.date} />
          ))}
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "8%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>
              Культура{" "}
              <span style={{ textTransform: "none", letterSpacing: "-0.01em" }}>(факт / цель)</span>
            </th>
            {days.map((d) => (
              <th key={d.date} className="r">
                {shortWeekday(d.date)}
                <br />
                {dayMonth(d.date)}
              </th>
            ))}
            <th className="r">Цель</th>
            <th className="r">Факт</th>
            <th className="r">%</th>
            <th className="r">Δ</th>
          </tr>
        </thead>
        <tbody>
          {week.rows.length === 0 && (
            <tr className="empty">
              <td colSpan={days.length + 5}>нет целей и отгрузок за выбранную неделю</td>
            </tr>
          )}
          {week.rows.map((r) => {
            const isWeek = r.mode === "week";
            const target = rowWeekTotal(r);
            const fact = r.weekProgress.effectiveTons;
            const hasTarget = target > EPS;
            const pct = hasTarget ? Math.round((fact / target) * 100) : null;
            const delta = fact - target;

            return (
              <tr key={r.cultureId}>
                <td>
                  <span className="cultname">
                    <span className="chip" style={{ background: r.color }} />
                    {r.cultureName}
                    {isWeek && <span className="wk-badge">неделя</span>}
                  </span>
                </td>

                {isWeek ? (
                  <td className="c wkspan" colSpan={days.length}>
                    цель задана на неделю одним итогом
                  </td>
                ) : (
                  days.map((d) => (
                    <td key={d.date} className="r num">
                      <DayCell
                        eff={r.dayProgress[d.date]?.effectiveTons ?? 0}
                        target={r.dayTargets[d.date] ?? null}
                      />
                    </td>
                  ))
                )}

                <td className="r num">{hasTarget ? fmtTons(target) : <span className="dim">—</span>}</td>
                <td className="r num">{fmtTons(fact)}</td>
                <td className="r pct">{pct != null ? `${pct}%` : "—"}</td>
                <td className={`r delta${hasTarget ? (delta >= 0 ? " pos" : " neg") : ""}`}>
                  {hasTarget
                    ? `${delta >= 0 ? "+" : "−"}${fmtTons(Math.abs(delta))}`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
        {week.rows.length > 0 && (
          <tfoot>
            <tr>
              <td className="lead">
                Итого по дням <span className="dim" style={{ fontWeight: 400 }}>· day-mode</span>
              </td>
              {days.map((d, i) => {
                const eff = week.dayTotalsProgress[i]?.effectiveTons ?? 0;
                const goal = dayTotals[i];
                return (
                  <td key={d.date} className="r num">
                    {goal > EPS ? (
                      <>
                        {fmtTons(eff)}{" "}
                        <span className="dim" style={{ fontWeight: 400 }}>/ {fmtTons(goal)}</span>
                      </>
                    ) : eff > EPS ? (
                      fmtTons(eff)
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                );
              })}
              <td className="r num">{fmtTons(grandTarget)}</td>
              <td className="r num">{fmtTons(weekEffective)}</td>
              <td className="r" />
              <td className="r" />
            </tr>
          </tfoot>
        )}
      </table>
    </PrintSheet>
  );
}
