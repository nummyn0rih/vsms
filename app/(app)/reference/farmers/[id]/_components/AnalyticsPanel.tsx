import type { ReactNode } from "react";
import Link from "next/link";
import { ChartLine, FileText, LineChart } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
// Проценты выводятся ЦЕЛЫМИ (fmtInt), как ProgressCell на «Контрактах» и доля на
// «Качестве»: «11,5 %» рядом с «12 %» на соседней вкладке читается как расхождение расчёта.
import { fmtDays, fmtInt, fmtTons } from "@/lib/format";
import { pluralRu } from "@/server/shipments/format";
import {
  KPI_SCOPE,
  SEASON_SCOPE_HINT,
  type AnalyticsRemainingRow,
  type FarmerAnalytics,
  type KpiKey,
} from "@/server/farmers/analytics-agg";
import { EmptyState } from "./EmptyState";
import { FarmerWeeksChart } from "./FarmerWeeksChart";

// Вкладка «Аналитика» карточки поставщика: темп, прогноз «осталось ~N машин», ритм поставок
// и доля фермера — с переключателем периода.
//
// Граница со вкладкой «Качество»: та отвечает «какой он поставщик» (сезон целиком, без
// периода), эта — «что с ним происходит сейчас и чего ждать».
//
// ⚠ ДЕНЕГ ЗДЕСЬ НЕТ: стоимость и «к оплате» — на «Расчётах», детализация контрактных строк —
// на «Контрактах». Здесь только цифра выполнения и прогноз.
//
// ⚠ СЕЗОННЫЕ И ПЕРИОДНЫЕ ВЕЛИЧИНЫ РЯДОМ. Скоуп плитки берётся из KPI_SCOPE (ядро), а не
// вписывается в вёрстку: «Выполнение 71%» рядом с выбранной неделей иначе прочтётся как
// результат этой недели. Компонент плитки дорисовывает подпись сам — забыть её нельзя.
//
// Серверный компонент: интерактива нет, клиентские — только SettlementPeriodBar (он рядом,
// в page.tsx) и график.

const genFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC", // даты в БД — UTC-полночь, локальная зона сдвинула бы день
});

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

const tripsWord = (n: number) => pluralRu(n, "рейс", "рейса", "рейсов");

function Dash({ title }: { title?: string }) {
  return (
    <span className={title ? "cursor-help text-[#a1a1a1]" : "text-[#a1a1a1]"} title={title}>
      —
    </span>
  );
}

function CultureDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-sm"
      style={{ backgroundColor: color }}
    />
  );
}

// Плитка KPI. `scope` — не украшение: сезонная величина физически не может быть показана
// без подписи «сезон целиком». При сезонном периоде подпись гасится — она стала бы шумом,
// потому что период и сезон тождественны (SettlementPeriod.isSeason).
function Kpi({
  label,
  value,
  sub,
  scope,
  isSeasonPeriod,
  muted,
}: {
  label: string;
  value: string;
  sub: string;
  scope: KpiKey;
  isSeasonPeriod: boolean;
  muted?: boolean;
}) {
  const seasonal = KPI_SCOPE[scope] === "season" && !isSeasonPeriod;
  return (
    <div className="min-w-[150px] flex-1 rounded-lg border bg-muted/30 px-3.5 py-2.5">
      <div className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-semibold tracking-tight tabular-nums ${muted ? "text-[#a1a1a1]" : ""}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {seasonal ? SEASON_SCOPE_HINT : sub}
      </div>
    </div>
  );
}

function SeasonBadge() {
  return (
    <span className="ml-auto rounded-[5px] border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      сезон целиком
    </span>
  );
}

function Card({
  title,
  unit,
  badge,
  children,
}: {
  title: string;
  unit: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b bg-muted/20 px-4 py-2.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{unit}</span>
        {badge}
      </div>
      {children}
    </div>
  );
}

function RemainingRow({ r }: { r: AnalyticsRemainingRow }) {
  const noLine = r.lineTons == null;
  return (
    <TableRow>
      <TableCell>
        <span className="inline-flex items-center gap-2">
          <CultureDot color={r.color} />
          {r.name}
          {noLine && (
            <span className="rounded-[5px] border px-1 py-px font-mono text-[9.5px] text-muted-foreground">
              вне контракта
            </span>
          )}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {r.lineTons != null ? fmtTons(r.lineTons) : <Dash title="Строки контракта по этой культуре нет" />}
      </TableCell>
      <TableCell className="text-right tabular-nums">{fmtTons(r.acceptedKg / 1000)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {r.remainingKg != null ? fmtTons(r.remainingKg / 1000) : <Dash />}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {r.avgTripKg != null ? (
          <span title={r.avgTripSource === "norm" ? "Перевешенных рейсов нет — взята норма веса рейса" : undefined}>
            {fmtTons(r.avgTripKg / 1000)}
            {r.avgTripSource === "norm" && (
              <span className="ml-1 font-mono text-[9.5px] text-muted-foreground">норма</span>
            )}
          </span>
        ) : (
          <Dash title="Ни перевешенных рейсов, ни нормы веса рейса" />
        )}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {r.trips != null ? fmtInt(r.trips) : <Dash />}
      </TableCell>
    </TableRow>
  );
}

export function AnalyticsPanel({ data }: { data: FarmerAnalytics }) {
  const { kpi, periodMeta, remaining, weeks, rhythm, share, notes, period } = data;
  const isSeasonPeriod = period.isSeason;
  const empty = notes.periodEmpty;

  if (remaining.length === 0) {
    return (
      <EmptyState
        icon={LineChart}
        title="Аналитику считать не из чего"
        description={`В сезоне ${data.season} у поставщика нет ни строк контракта, ни принятых поставок. Строки заводятся на вкладке «Контракты».`}
      />
    );
  }

  const series = remaining
    .filter((r) => weeks.some((w) => w.byCulture.some((b) => b.cultureId === r.cultureId && b.tons > 0)))
    .map((r) => ({ cultureId: r.cultureId, name: r.name, color: r.color }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold tracking-tight">Аналитика поставок</h3>
        <span className="text-sm text-muted-foreground">
          {data.farmer.name} · сезон {data.season} · {period.label}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          сформировано {genFmt.format(new Date(`${data.generatedAt}T00:00:00Z`))}
        </span>
      </div>

      {/* Пустой период — одна честная строка вместо пяти нулей (как на «Расчётах»). */}
      {empty && (
        <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <b className="text-foreground">За выбранный период принятых поставок не было.</b>{" "}
          {notes.nearestWeekWithData ? (
            <>
              Ближайшая неделя с приёмкой —{" "}
              <Link
                href={`?tab=analytics&period=week&from=${notes.nearestWeekWithData.anchor}`}
                className="underline underline-offset-2"
              >
                {notes.nearestWeekWithData.label}
              </Link>{" "}
              ({fmtInt(notes.nearestWeekWithData.trips)}{" "}
              {tripsWord(notes.nearestWeekWithData.trips)},{" "}
              {fmtTons(notes.nearestWeekWithData.tons)} т).{" "}
            </>
          ) : (
            <>Приёмок в сезоне пока нет. </>
          )}
          Метрики периода не показаны, чтобы нули не читались как провал темпа.
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Kpi
          scope="periodAcceptedKg"
          isSeasonPeriod={isSeasonPeriod}
          label="Принято за период"
          value={empty ? "—" : `${fmtTons(kpi.periodAcceptedKg / 1000)} т`}
          sub={`${fmtInt(periodMeta.trips)} ${tripsWord(periodMeta.trips)} · ${fmtInt(periodMeta.positions)} ${pluralRu(periodMeta.positions, "позиция", "позиции", "позиций")}`}
          muted={empty}
        />
        <Kpi
          scope="tempTonsPerWeek"
          isSeasonPeriod={isSeasonPeriod}
          label="Темп"
          value={kpi.tempTonsPerWeek != null ? `${fmtTons(kpi.tempTonsPerWeek)} т/нед` : "—"}
          sub={
            periodMeta.tempRecentTonsPerWeek != null
              ? `за последние 4 недели ${fmtTons(periodMeta.tempRecentTonsPerWeek)}`
              : kpi.tempTonsPerWeek != null
                ? "по неделям с поставками"
                : "нет базы за период"
          }
          muted={kpi.tempTonsPerWeek == null}
        />
        <Kpi
          scope="executionPct"
          isSeasonPeriod={isSeasonPeriod}
          label="Выполнение"
          value={kpi.executionPct != null ? `${fmtInt(kpi.executionPct)} %` : "—"}
          sub={kpi.executionPct != null ? "по контрактам · сезон целиком" : "нет контрактных строк"}
          muted={kpi.executionPct == null}
        />
        <Kpi
          scope="remainingTrips"
          isSeasonPeriod={isSeasonPeriod}
          label="Осталось ~машин"
          value={kpi.remainingTrips != null ? `${fmtInt(kpi.remainingTrips)} маш.` : "—"}
          sub={
            kpi.remainingTrips != null
              ? "оценка консервативная — см. ниже"
              : notes.hasContracts
                ? "нет базы: ни рейсов, ни нормы"
                : "нечего вычитать: плана нет"
          }
          muted={kpi.remainingTrips == null}
        />
        <Kpi
          scope="avgTripActualKg"
          isSeasonPeriod={isSeasonPeriod}
          label="Ср. вес рейса"
          value={`${kpi.avgTripPlanKg != null ? fmtTons(kpi.avgTripPlanKg / 1000) : "—"} / ${
            kpi.avgTripActualKg != null ? fmtTons(kpi.avgTripActualKg / 1000) : "—"
          } т`}
          sub="план (норма) / факт"
          muted={kpi.avgTripPlanKg == null && kpi.avgTripActualKg == null}
        />
      </div>

      <Card
        title="Осталось ~N машин"
        unit="(объём строки − принято) / средний факт. вес рейса"
        badge={<SeasonBadge />}
      >
        {notes.hasContracts ? (
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-semibold tracking-tight tabular-nums">
                {kpi.remainingTrips != null ? `${fmtInt(kpi.remainingTrips)} маш.` : <Dash />}
              </span>
              <span className="max-w-[54ch] text-xs text-muted-foreground">
                до закрытия контрактных строк сезона. Считается по{" "}
                <b>фактическому</b> среднему весу рейса, а он занижен частично перевешенными
                машинами → <b>оценка сверху по количеству</b>, консервативная.
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Культура</TableHead>
                  <TableHead className="text-right">Строка, т</TableHead>
                  <TableHead className="text-right">Принято, т</TableHead>
                  <TableHead className="text-right">Осталось, т</TableHead>
                  <TableHead className="text-right">Ср. рейс, т</TableHead>
                  <TableHead className="text-right">~Машин</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remaining.map((r) => (
                  <RemainingRow key={r.cultureId} r={r} />
                ))}
              </TableBody>
            </Table>
            {/* ⚠ Итога по колонке «Принято» НЕТ намеренно: у строк со строкой контракта база
                контрактная, у строк без неё — всё принятое по культуре. Сумма разнородна. */}
            <ul className="flex flex-col gap-1 px-1 text-[11.5px] text-muted-foreground">
              {remaining.some((r) => r.lineTons == null) && (
                <li>
                  У культур «вне контракта» стоит «—», а не 0: объём есть, плана нет →
                  прогнозировать нечего. «Принято» у них — весь принятый объём культуры, у
                  остальных строк — принятое ПО СТРОКЕ контракта, поэтому колонка не суммируется.
                </li>
              )}
              {remaining.some((r) => r.avgTripSource === "norm") && (
                <li>
                  Где перевешенных рейсов ещё нет, база взята из нормы веса рейса — это план, а
                  не факт.
                </li>
              )}
            </ul>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              icon={FileText}
              title="Контрактов на сезон нет"
              description="Прогноз считается как «объём строки − принято»: без плана вычитать нечего. Фермер возит вне контракта — это видно по «Принято» и «Ритму»."
            >
              <Link
                href="?tab=contracts"
                className="mt-1 text-sm underline underline-offset-2"
              >
                Добавить строку на вкладке «Контракты»
              </Link>
            </EmptyState>
          </div>
        )}
      </Card>

      <Card
        title={notes.chartReady ? "Динамика приёмки по неделям" : "Приёмка по неделям"}
        unit={
          notes.chartReady
            ? "т принятого · серии — цвет культуры · ISO-недели"
            : "т принятого · для графика мало точек"
        }
        badge={
          <span className="ml-auto rounded-[5px] border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {notes.chartReady ? "≥ 4 недель — график" : "< 4 недель — таблица"}
          </span>
        }
      >
        <div className="p-4">
          {notes.chartReady ? (
            <FarmerWeeksChart weeks={weeks} series={series} />
          ) : weeks.filter((w) => w.trips > 0).length === 0 ? (
            <EmptyState
              icon={ChartLine}
              title={isSeasonPeriod ? "Приёмок ещё не было" : "Внутри этого периода графика нет"}
              description={
                isSeasonPeriod
                  ? "Динамика появится после первой принятой поставки."
                  : "Динамика строится по неделям — в узком периоде это одна точка. Переключитесь на «Месяц» или «Сезон», чтобы увидеть линию."
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Неделя</TableHead>
                    <TableHead className="text-right">Рейсов</TableHead>
                    <TableHead className="text-right">Принято, т</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeks
                    .filter((w) => w.trips > 0)
                    .map((w) => (
                      <TableRow key={`${w.isoYear}-${w.isoWeek}`}>
                        <TableCell className="font-mono">{w.label}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtInt(w.trips)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtTons(w.tons)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              <p className="text-[11.5px] text-muted-foreground">
                График появится с <b>4-й недели</b> с поставками: линия по трём точкам
                показывает шум как тренд.
              </p>
            </div>
          )}
        </div>
      </Card>

      <Card title="Ритм поставок" unit="по принятым рейсам · «он вообще возит или пропал»">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[150px] flex-1">
              <div className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                Последняя поставка
              </div>
              <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
                {rhythm.daysSinceLast != null ? (
                  `${fmtInt(rhythm.daysSinceLast)} ${pluralRu(rhythm.daysSinceLast, "день", "дня", "дней")} назад`
                ) : (
                  <Dash />
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {rhythm.lastDeliveryDate
                  ? `${dateFmt.format(new Date(`${rhythm.lastDeliveryDate}T00:00:00Z`))}${
                      rhythm.lastActNumber ? ` · акт ${rhythm.lastActNumber}` : ""
                    }`
                  : "приёмок в сезоне не было"}
              </div>
            </div>
            <div className="min-w-[150px] flex-1">
              <div className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                Типичный интервал
              </div>
              <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
                {rhythm.medianIntervalDays != null ? (
                  `${fmtDays(rhythm.medianIntervalDays)} ${pluralRu(Math.round(rhythm.medianIntervalDays), "день", "дня", "дней")}`
                ) : (
                  <Dash title="Для интервала нужно хотя бы два дня с приёмкой" />
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                медиана между днями с приёмкой · сезон
              </div>
            </div>
            <div className="min-w-[150px] flex-1">
              <div className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                Машин за период
              </div>
              <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
                {fmtInt(rhythm.tripsInPeriod)} {tripsWord(rhythm.tripsInPeriod)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {rhythm.tripsPerWeek != null
                  ? `${fmtTons(rhythm.tripsPerWeek)} рейса в неделю (с паузами)`
                  : "недель с поставками нет"}
              </div>
            </div>
          </div>

          {rhythm.intervalsDays.length > 0 && (
            <>
              <div
                className="flex h-10 items-end gap-1"
                title="Интервалы между днями с приёмкой, дни"
              >
                {rhythm.intervalsDays.map((d, k) => {
                  const max = Math.max(...rhythm.intervalsDays, rhythm.daysSinceLast ?? 0);
                  return (
                    <span
                      key={k}
                      className="w-2 rounded-[2px] bg-[#d4d4d4]"
                      style={{ height: `${max > 0 ? Math.max(12, (d / max) * 100) : 12}%` }}
                    />
                  );
                })}
                {rhythm.daysSinceLast != null && (
                  <span
                    className="w-2 rounded-[2px] bg-[#8f8f8f]"
                    style={{
                      height: `${(() => {
                        const max = Math.max(...rhythm.intervalsDays, rhythm.daysSinceLast);
                        return max > 0 ? Math.max(12, (rhythm.daysSinceLast / max) * 100) : 12;
                      })()}%`,
                    }}
                  />
                )}
              </div>
              <p className="text-[11.5px] text-muted-foreground">
                интервалы между днями с приёмкой по порядку; тёмный — текущий разрыв
                {rhythm.daysSinceLast != null && rhythm.medianIntervalDays != null
                  ? ` (${fmtInt(rhythm.daysSinceLast)} ${pluralRu(rhythm.daysSinceLast, "день", "дня", "дней")} при типичных ${fmtDays(rhythm.medianIntervalDays)})`
                  : ""}
                .
              </p>
            </>
          )}
        </div>
      </Card>

      <Card
        title="Доля фермера"
        unit="% принятого · в каждой культуре и в сезоне"
        badge={<SeasonBadge />}
      >
        <div className="flex flex-col gap-2 p-4">
          {share.byCulture.map((s) => (
            <div key={s.cultureId} className="flex items-center gap-3 text-sm">
              <span className="inline-flex min-w-[9rem] items-center gap-2">
                <CultureDot color={s.color} />
                {s.name}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.min(100, s.pctOfCulture)}%`, backgroundColor: s.color }}
                />
              </span>
              <span className="min-w-[7.5rem] text-right tabular-nums">
                {fmtInt(s.pctOfCulture)}%{" "}
                <span className="text-xs text-muted-foreground">
                  / {fmtInt(s.suppliersCount)} пост.
                </span>
              </span>
            </div>
          ))}
          <div className="mt-1 flex items-center gap-3 border-t pt-3 text-sm">
            <span className="min-w-[9rem] font-medium">Весь сезон</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-[#0070f3]"
                style={{ width: `${Math.min(100, share.seasonPct ?? 0)}%` }}
              />
            </span>
            <span className="min-w-[7.5rem] text-right tabular-nums">
              {share.seasonPct != null ? `${fmtInt(share.seasonPct)}%` : <Dash />}{" "}
              <span className="text-xs text-muted-foreground">
                / {fmtTons(share.ownSeasonKg / 1000)} из {fmtTons(share.seasonTotalKg / 1000)} т
              </span>
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
