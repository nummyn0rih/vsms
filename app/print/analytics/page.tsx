import { getSeasonAnalytics } from "@/server/analytics/dashboard";
import { currentSeasonWeek } from "@/server/shipments/workdays";
import { fmtTons, fmtPct1 } from "@/lib/format";
import { AcceptanceAreaChart } from "@/app/(app)/analytics/_components/AcceptanceAreaChart";
import { BrakBarChart } from "@/app/(app)/analytics/_components/BrakBarChart";
import { TripsBarChart } from "@/app/(app)/analytics/_components/TripsBarChart";
import { PrintSheet } from "../_components/PrintSheet";

// Печатный лист «Аналитика сезона» (print-3, A4 portrait, с графиками). Read-only,
// источник — getSeasonAnalytics (те же величины, что десктоп-дашборд). KPI-полоса + сетка
// 2×2: CSS-бары «Выполнение по культурам» + 3 Recharts-графика дашборда (переиспользуются,
// не дублируются). Деньги не выводятся. Сезон — из ?season= (дефолт текущий).
export default async function PrintAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.season) ? sp.season[0] : sp.season;
  const parsed = raw ? Number(raw) : NaN;
  const season = Number.isInteger(parsed) ? parsed : currentSeasonWeek().seasonYear;

  const data = await getSeasonAnalytics({ season });
  const { kpi } = data;

  const weeks = data.acceptanceByWeek;
  const period = weeks.length
    ? `сезон ${season} · ${weeks[0].label}–${weeks[weeks.length - 1].label}`
    : `сезон ${season}`;

  return (
    <PrintSheet
      title="Аналитика сезона"
      subtitle="Сводный дашборд · агрегаты считаются на лету (не хранятся)"
      season={`Сезон ${season}`}
      period={period}
      periodLabel="Период"
      filters={
        <>
          Серии культур — <b>Culture.color</b> · недели и ТК — графит · брак — по культурам
        </>
      }
      footTotal={
        <>
          <b>Итого сезона:</b> принято <span className="num">{fmtTons(kpi.acceptedTons)} т</span> из{" "}
          <span className="num">{fmtTons(kpi.targetTons)} т</span> · выполнение{" "}
          <span className="num">
            {kpi.completionPct == null ? "—" : `${Math.round(kpi.completionPct)}%`}
          </span>{" "}
          · средний брак{" "}
          <span className="num">{kpi.avgBrakPct == null ? "—" : `${fmtPct1(kpi.avgBrakPct)}%`}</span>{" "}
          · рейсов <span className="num">{kpi.tripsTotal}</span>
        </>
      }
      footPage={`Аналитика · сезон ${season} · лист 1/1`}
    >
      <div className="an-print">
        {/* KPI-полоса (5 плиток) — копия дашборда, без денег */}
        <div className="an-kpis">
          <div className="an-kpi">
            <div className="k">Принято</div>
            <div className="v">
              <span>{fmtTons(kpi.acceptedTons)}</span>
              <span className="u">т</span>
            </div>
            <div className="sub">
              из <b>{fmtTons(kpi.targetTons)}&nbsp;т</b> плана
            </div>
          </div>

          <div className={`an-kpi${kpi.completionPct == null ? " muted" : ""}`}>
            <div className="k">Выполнение сезона</div>
            <div className="v">
              <span>{kpi.completionPct == null ? "—" : Math.round(kpi.completionPct)}</span>
              {kpi.completionPct != null && <span className="u">%</span>}
            </div>
            <div className="sub">принято / план по контрактам</div>
          </div>

          <div className={`an-kpi${kpi.avgBrakPct == null ? " muted" : ""}`}>
            <div className="k">Средний брак</div>
            <div className="v">
              <span>{kpi.avgBrakPct == null ? "—" : fmtPct1(kpi.avgBrakPct)}</span>
              {kpi.avgBrakPct != null && <span className="u">%</span>}
            </div>
            <div className="sub">
              {kpi.avgBrakPct == null ? "нет завершённых актов" : "взвешенный по весу"}
            </div>
          </div>

          <div className="an-kpi">
            <div className="k">Рейсов ТК</div>
            <div className="v">
              <span>{kpi.tripsTotal}</span>
            </div>
            <div className="sub">
              <b>{kpi.tripsVeg}</b> овощных · <b>{kpi.tripsMaterial}</b> материальных
            </div>
          </div>

          <div className={`an-kpi${kpi.remainingMachines == null ? " muted" : ""}`}>
            <div className="k">Осталось</div>
            <div className="v">
              <span>{kpi.remainingMachines == null ? "—" : `~${kpi.remainingMachines}`}</span>
              {kpi.remainingMachines != null && <span className="u">машин</span>}
            </div>
            <div className="sub">
              {kpi.remainingMachines != null && kpi.remainingTons != null
                ? `${fmtTons(kpi.remainingTons)} т недобора · ${[
                    kpi.avgActualTripWeightT != null
                      ? `факт ≈${fmtTons(kpi.avgActualTripWeightT)}`
                      : null,
                    kpi.plannedTripWeightT != null
                      ? `план ≈${fmtTons(kpi.plannedTripWeightT)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")} т/рейс`
                : kpi.avgActualTripWeightT == null && kpi.plannedTripWeightT == null
                  ? "нет норм рейса"
                  : "план сезона закрыт"}
            </div>
          </div>
        </div>

        {/* Сетка 2×2 графиков */}
        <div className="an-charts">
          {/* 1 · Выполнение по культурам — CSS-бары (копия дашборда) */}
          <div className="an-card">
            <div className="an-card-head">
              <div className="an-card-title">Выполнение по культурам</div>
              <div className="an-card-unit">принято / план · т · % справа</div>
            </div>
            <div className="an-card-body">
              {data.completionByCulture.length === 0 ? (
                <div className="an-empty">
                  <div className="t">Данных пока нет</div>
                  <div className="d">Нет контрактов сезона или приёмок по ним.</div>
                </div>
              ) : (
                <div className="an-cbars">
                  {data.completionByCulture.map((c) => (
                    <div className="an-cbar" key={c.cultureId}>
                      <span className="an-cbar-name">
                        <span className="chip" style={{ background: c.color }} />
                        <span className="nm">{c.cultureName}</span>
                      </span>
                      <div className="an-cbar-mid">
                        <div className="an-cbar-track">
                          <span
                            className="an-cbar-fill"
                            style={{ width: `${Math.min(100, c.pct)}%`, background: c.color }}
                          />
                        </div>
                        <div className="an-cbar-cap">
                          <b>{fmtTons(c.acceptedTons)}</b> / {fmtTons(c.targetTons)} т
                        </div>
                      </div>
                      <span className="an-cbar-pct">{Math.round(c.pct)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 2 · Динамика приёмки по неделям */}
          <div className="an-card">
            <div className="an-card-head">
              <div className="an-card-title">Динамика приёмки по неделям</div>
              <div className="an-card-unit">суммарно · т эффективного веса · ISO-недели</div>
            </div>
            <div className="an-card-body">
              <AcceptanceAreaChart data={weeks.map((w) => ({ label: w.label, tons: w.tons }))} />
            </div>
          </div>

          {/* 3 · % брака по культурам */}
          <div className="an-card">
            <div className="an-card-head">
              <div className="an-card-title">% брака по культурам</div>
              <div className="an-card-unit">брак / принято · % · по культурам</div>
            </div>
            <div className="an-card-body">
              <BrakBarChart data={data.brakByCulture} />
            </div>
          </div>

          {/* 4 · Рейсы ТК */}
          <div className="an-card">
            <div className="an-card-head">
              <div className="an-card-title">Рейсы транспортных компаний</div>
              <div className="an-card-unit">число рейсов · овощные и материальные раздельно (BR-14)</div>
            </div>
            <div className="an-card-body">
              <TripsBarChart data={data.tripsByTc} />
            </div>
          </div>
        </div>
      </div>
    </PrintSheet>
  );
}
