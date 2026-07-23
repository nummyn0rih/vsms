import Link from "next/link";

import { getSeasonAnalytics } from "@/server/analytics/dashboard";
import { currentSeasonWeek } from "@/server/shipments/workdays";
import { fmtTons, fmtPct1 } from "@/lib/format";

import { SeasonSelector } from "./_components/SeasonSelector";
import { AcceptanceAreaChart } from "./_components/AcceptanceAreaChart";
import { BrakBarChart } from "./_components/BrakBarChart";
import { TripsBarChart } from "./_components/TripsBarChart";

// Дашборд сезона — read-only. Сезон из ?season= (дефолт текущий). Агрегаты на лету.
export default async function AnalyticsPage({
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

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <div className="an-stage">
        {/* page head */}
        <div className="an-phead">
          <div style={{ minWidth: 0 }}>
            <div className="an-title">Аналитика</div>
            <div className="an-sub">
              <span className="ro">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Только просмотр
              </span>
              <span className="sep" />
              <span>дашборд сезона · агрегаты на лету</span>
            </div>
          </div>
          <div className="spacer" />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SeasonSelector season={season} seasons={data.seasons} />
            <a
              href={`/print/analytics?season=${season}`}
              target="_blank"
              rel="noopener"
              className="btn btn-sm"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              Печать
            </a>
          </div>
        </div>

        {/* KPI strip */}
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
            <div className="sub">{kpi.avgBrakPct == null ? "нет завершённых актов" : "взвешенный по весу"}</div>
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

        {/* chart grid 2×2 */}
        <div className="an-charts">
          {/* 1 · Выполнение по культурам */}
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
                    // клик по культуре → профиль культуры (drill-down), сезон переносим
                    <Link
                      className="an-cbar"
                      key={c.cultureId}
                      href={`/analytics/culture/${c.cultureId}?season=${season}`}
                    >
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
                    </Link>
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
              <AcceptanceAreaChart
                data={data.acceptanceByWeek.map((w) => ({ label: w.label, tons: w.tons }))}
              />
            </div>
          </div>

          {/* 3 · % брака по культурам */}
          <div className="an-card">
            <div className="an-card-head">
              <div className="an-card-title">% брака по культурам</div>
              <div className="an-card-unit">брак / принято · % · нейтральный янтарь</div>
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
    </div>
  );
}
