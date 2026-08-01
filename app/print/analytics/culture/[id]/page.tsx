import { notFound } from "next/navigation";

import { getCultureAnalytics } from "@/server/analytics/culture";
import { currentSeasonWeek } from "@/server/shipments/workdays";
import { fmtInt, fmtPct1, fmtTons } from "@/lib/format";
import { CultureAreaChart } from "@/app/(app)/analytics/culture/[id]/_components/CultureAreaChart";
import { CultureBrakBarChart } from "@/app/(app)/analytics/culture/[id]/_components/CultureBrakBarChart";
import { SupplierTable } from "@/app/(app)/analytics/culture/[id]/_components/SupplierTable";
import { CalibreStack } from "@/app/(app)/analytics/culture/[id]/_components/CalibreStack";
import { PrintSheet } from "../../../_components/PrintSheet";

// Печатный лист «Профиль культуры» (A4 portrait, с графиками) — печатная копия экрана
// /analytics/culture/[id]. Read-only, источник — ТОТ ЖЕ getCultureAnalytics, что у экрана:
// второй выборки и второй агрегации не заводим, поэтому числа сходятся тождественно.
// Компоненты графиков/таблиц переиспользуются с экрана, но без drill-down ссылок.
// Культура — в пути, сезон — в ?season= (дефолт текущий). PDF — «Сохранить как PDF»
// браузера, PDF-библиотек в проекте нет.
// Высота графиков на листе: экранные 200px не дают уместить весь профиль в одну
// страницу A4 (шапка + KPI + два графика + таблица поставщиков + стек калибра).
const PRINT_CHART_H = 150;

export default async function PrintCultureAnalyticsPage({
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

  const data = await getCultureAnalytics({ season, cultureId });
  if (!data) notFound();

  const { culture, kpi } = data;
  const isCalibre = culture.acceptanceType === "calibre";

  const weeks = data.acceptanceByWeek;
  const period = weeks.length
    ? `сезон ${season} · ${weeks[0].label}–${weeks[weeks.length - 1].label}`
    : `сезон ${season}`;

  // Без «лист 1/1»: число строк таблицы поставщиков переменное, и у культуры с десятком
  // фермеров лист законно уходит на вторую страницу (прецедент — лист «Отгрузки»).
  const footPage = `Профиль культуры · ${culture.name} · сезон ${season} · поставщиков: ${data.bySupplier.length}`;

  return (
    <PrintSheet
      title={`Профиль культуры · ${culture.name}`}
      subtitle="Недели · поставщики · категории — агрегаты считаются на лету"
      season={`Сезон ${season}`}
      period={period}
      periodLabel="Период"
      filters={
        <>
          Приёмка — {isCalibre ? "по калибру" : "по весу"} · серии —{" "}
          <b>Culture.color</b> · брак — янтарь · категории — размерным порядком
        </>
      }
      footTotal={
        <>
          <b>Итого по культуре:</b> принято{" "}
          <span className="num">{fmtTons(kpi.acceptedTons)} т</span> из{" "}
          <span className="num">{fmtTons(kpi.targetTons)} т</span> · выполнение{" "}
          <span className="num">
            {kpi.completionPct == null ? "—" : `${Math.round(kpi.completionPct)}%`}
          </span>{" "}
          · к оплате <span className="num">{fmtTons(kpi.paidTons)} т</span> · средний брак{" "}
          <span className="num">
            {kpi.avgBrakPct == null ? "—" : `${fmtPct1(kpi.avgBrakPct)}%`}
          </span>
        </>
      }
      footPage={footPage}
    >
      <div className="an-print an-culture">
        {/* KPI-полоса (5 плиток) — копия экрана профиля культуры */}
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
            <div className="v">
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
            <div className="v">
              <span>{kpi.seasonSharePct == null ? "—" : Math.round(kpi.seasonSharePct)}</span>
              {kpi.seasonSharePct != null && <span className="u">%</span>}
            </div>
            <div className="sub">
              {kpi.seasonSharePct == null
                ? "в сезоне ничего не принято"
                : "от всего принятого за сезон"}
            </div>
          </div>
        </div>

        {/* Динамика и брак по неделям — два графика в ряд */}
        <div className="an-charts">
          <div className="an-card">
            <div className="an-card-head">
              <div className="an-card-title">Динамика приёмки по неделям</div>
              <div className="an-card-unit">
                т · ISO-недели · факт по перевеске и принятый
                {data.hasPlanLine ? " · план пунктиром" : ""}
              </div>
            </div>
            <div className="an-card-body">
              <CultureAreaChart
                data={weeks.map((w) => ({
                  label: w.label,
                  tons: w.tons,
                  actualTons: w.actualTons,
                  planTons: w.planTons,
                }))}
                color={culture.color}
                cultureName={culture.name}
                hasPlan={data.hasPlanLine}
                height={PRINT_CHART_H}
              />
            </div>
          </div>

          <div className="an-card">
            <div className="an-card-head">
              <div className="an-card-title">% брака по неделям</div>
              <div className="an-card-unit">брак / принято · % · по неделе прибытия</div>
            </div>
            <div className="an-card-body">
              <CultureBrakBarChart data={data.brakByWeek} height={PRINT_CHART_H} />
            </div>
          </div>
        </div>

        {/* По поставщикам — полная ширина листа */}
        <div className="an-charts wide" style={{ paddingTop: 0 }}>
          <div className="an-card">
            <div className="an-card-head">
              <div className="an-card-title">По поставщикам</div>
              <div className="an-card-unit">
                кто даёт объём и кто — брак · сортировка по принятому
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

        {/* Калибр — только для calibre-культур (у simple блока нет и на экране) */}
        {data.calibre != null && (
          <div className="an-charts wide" style={{ paddingTop: 0 }}>
            <div className="an-card">
              <div className="an-card-head">
                <div className="an-card-title">Калибр — доли категорий за сезон</div>
                <div className="an-card-unit">
                  % факт. веса по категориям · из категорий акта (BR-10)
                </div>
              </div>
              <div className="an-card-body">
                <CalibreStack data={data.calibre} color={culture.color} />
              </div>
            </div>
          </div>
        )}
      </div>
    </PrintSheet>
  );
}
