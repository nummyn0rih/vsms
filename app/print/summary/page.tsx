import { getPlanWeek } from "@/server/plan/board";
import { parseWeekParam } from "@/server/shipments/workdays";
import { EPS, rowMax, rowPlan, weekHeadline } from "@/app/(app)/shipments/_components/summary-fill";
import { fmtTons } from "@/lib/format";
import { PrintSheet } from "../_components/PrintSheet";

// Печатный лист «Сводка» (print-2, A4 landscape). Read-only, источник — getPlanWeek
// (те же величины, что десктоп SummaryView; формулы — из summary-fill, не дублируем).
// Ячейка = эффективный вес дня (BR-22); максимум строки — жирным; week-mode — спан (BR-23).

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
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
  return dayMonthFmt.format(new Date(`${dateStr}T00:00:00Z`)).replace(".", "");
}
function dayNum(dateStr: string): string {
  return dayNumFmt.format(new Date(`${dateStr}T00:00:00Z`));
}

export default async function PrintSummaryPage({
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

  // Headline недели (BR-22): факт/план только по культурам с планом — как десктоп.
  const { plan: hlPlan, fact: hlFact, pct: hlPct } = weekHeadline(week);
  const shortfall = hlPlan - hlFact;

  return (
    <PrintSheet
      title="Сводка — неделя"
      subtitle="Эффективный вес по культурам и дням · факт перевески, где есть, иначе плановый"
      season={`Сезон ${week.seasonYear}`}
      period={period}
      periodLabel="Неделя"
      landscape
      filters={<>Единица — <b>тонны (эффективный вес)</b></>}
      footTotal={
        hlPct != null ? (
          <>
            <b>Итого недели:</b> факт <span className="num">{fmtTons(hlFact)} т</span> из плана{" "}
            <span className="num">{fmtTons(hlPlan)} т</span> · выполнение{" "}
            <span className="num">{hlPct}%</span>
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
      footPage={`Сводка · ${wkNum} · лист 1/1`}
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
            <th>Культура</th>
            {days.map((d) => (
              <th key={d.date} className="r">
                {shortWeekday(d.date)}
                <br />
                {dayNum(d.date)}
              </th>
            ))}
            <th className="r">План</th>
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
            const plan = rowPlan(r);
            const fact = r.weekProgress.effectiveTons;
            const hasPlan = plan > EPS;
            const pct = hasPlan ? Math.round((fact / plan) * 100) : null;
            const delta = fact - plan;
            const maxCell = rowMax(r, days);

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
                    цель задана на неделю · факт {fmtTons(fact)} т за неделю
                  </td>
                ) : (
                  days.map((d) => {
                    const value = r.dayProgress[d.date]?.effectiveTons ?? 0;
                    const zero = value <= EPS;
                    const isMax = !zero && Math.abs(value - maxCell) <= EPS;
                    return (
                      <td key={d.date} className={`r num${isMax ? " maxcell" : ""}`}>
                        {zero ? <span className="dim">—</span> : fmtTons(value)}
                      </td>
                    );
                  })
                )}

                <td className="r num">{hasPlan ? fmtTons(plan) : <span className="dim">—</span>}</td>
                <td className="r num">{fmtTons(fact)}</td>
                <td className="r pct">{pct != null ? `${pct}%` : "—"}</td>
                <td className={`r delta${hasPlan ? (delta >= 0 ? " pos" : " neg") : ""}`}>
                  {hasPlan
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
              {days.map((d, i) => (
                <td key={d.date} className="r num">
                  {fmtTons(week.dayTotalsProgress[i]?.effectiveTons ?? 0)}
                </td>
              ))}
              <td className="r" />
              <td className="r num">{fmtTons(week.weekTotalProgress.effectiveTons)}</td>
              <td className="r" />
              <td className="r" />
            </tr>
          </tfoot>
        )}
      </table>
    </PrintSheet>
  );
}
