import Link from "next/link";
import { notFound } from "next/navigation";

import { getCultureAnalytics } from "@/server/analytics/culture";
import { parseSupplierIds } from "@/server/analytics/culture-agg";
import { currentSeasonWeek } from "@/server/shipments/workdays";
import { fmtInt, fmtPct1, fmtTons } from "@/lib/format";

import { SeasonSelector } from "../../_components/SeasonSelector";
import { CultureSelector } from "./_components/CultureSelector";
import { SupplierFilter } from "./_components/SupplierFilter";
import { CultureAreaChart } from "./_components/CultureAreaChart";
import { CultureBrakBarChart } from "./_components/CultureBrakBarChart";
import { SupplierTable } from "./_components/SupplierTable";
import { CalibreStack } from "./_components/CalibreStack";

// Профиль культуры за сезон — read-only drill-down из дашборда. Культура в пути,
// сезон в ?season= (дефолт текущий), фильтр поставщиков в ?suppliers=1,2,3 (пусто = все).
// Агрегаты на лету, ничего не хранится. Фильтр режет НАБОР ПОЗИЦИЙ на входе агрегации
// (server/analytics/culture.ts), поэтому все блоки экрана сходятся между собой сами.
export default async function CultureAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const cultureId = Number(id);
  if (!Number.isInteger(cultureId)) notFound();

  const sp = await searchParams;
  const raw = Array.isArray(sp.season) ? sp.season[0] : sp.season;
  const parsed = raw ? Number(raw) : NaN;
  const season = Number.isInteger(parsed) ? parsed : currentSeasonWeek().seasonYear;

  const supplierIds = parseSupplierIds(sp.suppliers);

  const data = await getCultureAnalytics({ season, cultureId, supplierIds });
  if (!data) notFound();

  const { culture, kpi } = data;
  const isCalibre = culture.acceptanceType === "calibre";
  const filtered = data.supplierFilter.active;
  // Печать наследует фильтр: лист = копия того, что на экране (там же печатаются имена).
  const printHref =
    `/print/analytics/culture/${culture.id}?season=${season}` +
    (filtered ? `&suppliers=${data.supplierFilter.ids.join(",")}` : "");
  // Выбраны поставщики, у которых по этой культуре в сезоне нет принятых позиций
  // (например, ссылка из другого сезона): пустых графиков и нулевых таблиц не рисуем.
  const emptyByFilter = filtered && kpi.positionsCount === 0;

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <div className="an-stage">
        {/* page head */}
        <div className="an-phead" style={{ flexDirection: "column", gap: 0 }}>
          <div className="an-crumb">
            <Link href={`/analytics?season=${season}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              Аналитика
            </Link>
            <span className="sep">/</span>
            <span className="cur">{culture.name}</span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 18,
              flexWrap: "wrap",
              width: "100%",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="an-ptitle">
                <span className="an-cchip" style={{ background: culture.color }} />
                {culture.name}
              </div>
              <div className="an-sub">
                <span className="ro">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Только просмотр
                </span>
                <span className="sep" />
                <span>
                  Сезон <b style={{ color: "var(--body)" }}>{season}</b>
                </span>
                <span className="sep" />
                <span className="an-pill">
                  {isCalibre ? "приёмка по калибру" : "приёмка по весу"}
                </span>
              </div>
            </div>
            <div className="spacer" style={{ flex: 1 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <SupplierFilter
                options={data.supplierOptions}
                selected={data.supplierFilter.ids}
              />
              <CultureSelector
                cultureId={culture.id}
                season={season}
                cultures={data.cultures}
              />
              <SeasonSelector season={season} seasons={data.seasons} />
              {/* Печать — bare-роут /print/*, PDF даёт браузерное «Сохранить как PDF».
                  Эталон разметки — кнопка на дашборде аналитики. */}
              <a
                href={printHref}
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
        </div>

        {emptyByFilter ? (
          <div className="an-charts wide">
            <div className="an-card">
              <div className="an-card-body">
                <div className="an-empty">
                  <div className="ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <line x1="17" y1="8" x2="23" y2="14" />
                      <line x1="23" y1="8" x2="17" y2="14" />
                    </svg>
                  </div>
                  <div className="t">По выбранным поставщикам данных нет</div>
                  <div className="d">
                    В сезоне {season} у них нет принятых позиций по культуре «{culture.name}».
                  </div>
                  <Link className="btn btn-sm" href={`/analytics/culture/${culture.id}?season=${season}`}>
                    Сбросить фильтр
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
          {/* KPI strip */}
          <div className="an-kpis">
            <div className="an-kpi">
              <div className="k">Принято</div>
              <div className="v">
                <span>{fmtTons(kpi.acceptedTons)}</span>
                <span className="u">т</span>
              </div>
              <div className="sub">
                из <b>{fmtTons(kpi.targetTons)}&nbsp;т</b> плана · по актам приёмки
              </div>
            </div>

            <div className={`an-kpi${kpi.completionPct == null ? " muted" : ""}`}>
              <div className="k">Выполнение</div>
              <div className="v">
                <span>{kpi.completionPct == null ? "—" : Math.round(kpi.completionPct)}</span>
                {kpi.completionPct != null && <span className="u">%</span>}
              </div>
              <div className="sub">
                {kpi.completionPct == null
                  ? "нет строк контракта по культуре"
                  : "принято / план по контрактам"}
              </div>
            </div>

            <div className={`an-kpi${kpi.avgBrakPct == null ? " muted" : ""}`}>
              <div className="k">Средний брак</div>
              <div className="v" style={kpi.avgBrakPct != null ? { color: "var(--an-brak-deep)" } : undefined}>
                <span>{kpi.avgBrakPct == null ? "—" : fmtPct1(kpi.avgBrakPct)}</span>
                {kpi.avgBrakPct != null && <span className="u">%</span>}
              </div>
              <div className="sub">
                {kpi.avgBrakPct == null ? "нет завершённых актов" : "взвешенный по факт. весу"}
              </div>
            </div>

            <div className={`an-kpi${kpi.positionsCount === 0 ? " muted" : ""}`}>
              <div className="k">Поставок</div>
              <div className="v">
                <span>{kpi.positionsCount === 0 ? "—" : fmtInt(kpi.positionsCount)}</span>
                {kpi.positionsCount > 0 && <span className="u">поз.</span>}
              </div>
              <div className="sub">
                <b>{kpi.tripsCount}</b> рейсов · <b>{kpi.farmersCount}</b> фермеров
              </div>
            </div>

            <div className={`an-kpi${kpi.seasonSharePct == null ? " muted" : ""}`}>
              <div className="k">Доля в сезоне</div>
              <div className="v" style={kpi.seasonSharePct != null ? { color: culture.color } : undefined}>
                <span>
                  {kpi.seasonSharePct == null ? "—" : Math.round(kpi.seasonSharePct)}
                </span>
                {kpi.seasonSharePct != null && <span className="u">%</span>}
              </div>
              <div className="sub">
                {kpi.seasonSharePct == null
                  ? "в сезоне ничего не принято"
                  : filtered
                    ? "выбранных — от всего принятого за сезон"
                    : "от всего принятого за сезон"}
              </div>
            </div>
          </div>

          {/* charts row 1 */}
          <div className="an-charts">
            <div className="an-card">
              <div className="an-card-head">
                <div className="an-card-title">Динамика приёмки по неделям</div>
                <div className="an-card-unit">
                  т · ISO-недели · факт по перевеске и принятый
                  {data.hasPlanLine
                    ? data.planCultureWide
                      ? " · план — по культуре целиком"
                      : " · план пунктиром"
                    : ""}
                </div>
              </div>
              <div className="an-card-body">
                <CultureAreaChart
                  data={data.acceptanceByWeek.map((w) => ({
                    label: w.label,
                    tons: w.tons,
                    actualTons: w.actualTons,
                    planTons: w.planTons,
                  }))}
                  color={culture.color}
                  cultureName={culture.name}
                  hasPlan={data.hasPlanLine}
                  planCultureWide={data.planCultureWide}
                />
              </div>
            </div>

            <div className="an-card">
              <div className="an-card-head">
                <div className="an-card-title">% брака по неделям</div>
                <div className="an-card-unit">
                  брак / принято · % · нейтральный янтарь
                  {filtered ? " · по выбранным поставщикам" : ""}
                </div>
              </div>
              <div className="an-card-body">
                <CultureBrakBarChart data={data.brakByWeek} />
              </div>
            </div>
          </div>

          {/* suppliers */}
          <div className="an-charts wide" style={{ paddingTop: 0 }}>
            <div className="an-card">
              <div className="an-card-head">
                <div className="an-card-title">По поставщикам</div>
                <div className="an-card-unit">
                  кто даёт объём и кто — брак · сортировка по принятому
                  {filtered ? " · доля — от выбранных" : ""}
                </div>
              </div>
              <div className="an-card-body">
                <SupplierTable
                  rows={data.bySupplier}
                  color={culture.color}
                  totalTargetTons={kpi.targetTons}
                  totalTons={kpi.acceptedTons}
                  totalPaidTons={kpi.paidTons}
                  totalCompletionPct={kpi.completionPct}
                  totalCategoryPct={data.categoryPctTotal}
                />
              </div>
            </div>
          </div>

          {/* calibre — только для calibre-культур */}
          {data.calibre != null && (
            <div className="an-charts wide" style={{ paddingTop: 0 }}>
              <div className="an-card">
                <div className="an-card-head">
                  <div className="an-card-title">Калибр — доли категорий за сезон</div>
                  <div className="an-card-unit">
                    % факт. веса по категориям · из категорий акта (BR-10)
                    {filtered ? " · по выбранным поставщикам" : ""}
                  </div>
                </div>
                <div className="an-card-body">
                  <CalibreStack data={data.calibre} color={culture.color} />
                </div>
              </div>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}
