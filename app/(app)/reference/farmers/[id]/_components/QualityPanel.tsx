"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Sprout, TriangleAlert } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtInt, fmtPct1, fmtTons } from "@/lib/format";
import type { CategoryShare } from "@/server/analytics/culture-agg";
import { farmersWord, pluralRu } from "@/server/shipments/format";
import type {
  FarmerQuality,
  QualityCulture,
  QualityVerdict,
} from "@/server/farmers/quality-agg";
import { EmptyState } from "./EmptyState";
import { QualityBrakChart } from "./QualityBrakChart";

// Вкладка «Качество» карточки поставщика: разрез «культуры внутри фермера» с бенчмарком
// против остальных поставщиков культуры, за сезон целиком.
//
// ⚠ ДЕНЕГ ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО (BR-33): оплачиваемый вес намеренно не искажает статистику
// качества, и колонка «к оплате» рядом с «% брака» стёрла бы эту границу. Деньги — на
// «Расчётах», выполнение по контрактам — на «Контрактах», список партий с логистикой и
// статусами — на «Отгрузках». Здесь только веса, проценты и категории.
//
// ⚠ Периода у вкладки НЕТ: при малом числе партий в окне бенчмарк сравнивал бы шум с
// сезонным средним. Запрос «как он вёл себя в августе» закрыт раскрытием партий с датами.
//
// Клиентский компонент только ради раскрытия строк (useState). Все числа приходят
// посчитанными с сервера — здесь ни одной формулы, только форматирование.

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC", // даты в БД — UTC-полночь, локальная зона сдвинула бы день
});

function fmtDate(d: string | null): string {
  return d ? dateFmt.format(new Date(`${d}T00:00:00Z`)) : "—";
}

const genFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

const VERDICT: Record<QualityVerdict, string> = {
  better: "лучше остальных",
  same: "≈ на уровне",
  worse: "хуже остальных",
};

function Dash({ title }: { title?: string }) {
  return (
    <span
      className={title ? "cursor-help text-[#a1a1a1]" : "text-[#a1a1a1]"}
      title={title}
    >
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

// Δ против остальных поставщиков культуры. Знак важнее величины, поэтому чип, а не число:
// «хуже» — приглушённый янтарь, «лучше» — приглушённый зелёный. АЛЯРМ-КРАСНОГО НЕТ
// сознательно: это разговорный инструмент, а не авария.
function DeltaChip({ pp }: { pp: number }) {
  const worse = pp > 0;
  const cls = worse
    ? "border-[#e6d9bd] bg-[#f7f1e4] text-[#8a6a2f]"
    : "border-[#cfe3d7] bg-[#eaf4ee] text-[#3f6b52]";
  const Icon = worse ? ChevronDown : ChevronUp;
  // Минус — типографский U+2212, чтобы в моно-колонке не путался с дефисом переноса.
  const sign = worse ? "+" : "−";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${cls}`}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {sign}
      {fmtPct1(Math.abs(pp))} п.п.
    </span>
  );
}

// Оттенки категорий — те же правила, что в мини-стеке таблицы поставщиков культуры:
// принятые категории оттенками цвета культуры (чем дальше по списку, тем светлее),
// «не в зачёт» и брак — штриховка янтарём. Новых цветов не вводим.
function shade(color: string, index: number): string {
  const mix = Math.max(30, 100 - index * 26);
  return `color-mix(in srgb, ${color} ${mix}%, #ffffff)`;
}

const BRAK_LABEL = "Брак";

function CategoryStack({ cats, color }: { cats: CategoryShare[]; color: string }) {
  if (cats.length === 0) return <Dash />;
  const title = cats.map((c) => `${c.label} ${fmtPct1(c.pct)}%`).join(" · ");
  // Порядковый номер СРЕДИ ПРИНЯТЫХ считаем до рендера: он задаёт светлоту оттенка, а
  // непринятые категории его не сдвигают (иначе штриховка «съедала» бы тон культуры).
  const accepted = cats.filter((c) => c.isAccepted).map((c) => c.label);
  const segBackground = (c: CategoryShare) => {
    if (c.isAccepted) return shade(color, accepted.indexOf(c.label));
    if (c.label === BRAK_LABEL) return "#cf9a3e";
    return "repeating-linear-gradient(45deg, #cf9a3e 0 4px, #9a6a12 4px 8px)";
  };
  return (
    <div className="flex max-w-[190px] flex-col gap-1" title={title}>
      <div className="flex h-4 overflow-hidden rounded-[3px] border bg-muted">
        {cats.map((c) => (
          <span
            key={c.label}
            className="block h-full"
            style={{ width: `${c.pct}%`, background: segBackground(c) }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-px font-mono text-[10px] leading-[13px] text-muted-foreground">
        {cats
          .filter((c) => c.pct >= 1)
          .map((c) => (
            <span key={c.label} className={c.label === BRAK_LABEL ? "text-[#9a6a12]" : ""}>
              {c.label}&nbsp;{Math.round(c.pct)}%
            </span>
          ))}
      </div>
    </div>
  );
}

// Партии культуры — переговорный лист: то, что зачитывают фермеру. Логистики, статусов и
// машин здесь нет намеренно — полный список живёт на «Отгрузках».
function BatchTable({ c }: { c: QualityCulture }) {
  const actualKg = c.batches.reduce((s, b) => s + (b.actualKg ?? 0), 0);
  const acceptedKg = c.batches.reduce((s, b) => s + (b.acceptedKg ?? 0), 0);
  return (
    <div className="flex flex-col gap-2 bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <CultureDot color={c.color} />
        <span className="text-[13px] font-medium">{c.name} · партии сезона</span>
        <span className="text-[12px] text-muted-foreground">
          {c.batches.length} {pluralRu(c.batches.length, "партия", "партии", "партий")} ·{" "}
          {fmtTons(c.acceptedKg / 1000)} т принято
          {c.brakPct != null && <> · брак {fmtPct1(c.brakPct)}%</>}
          {c.othersBrakPct != null ? (
            <> (у остальных {fmtPct1(c.othersBrakPct)}%)</>
          ) : (
            <> (сравнивать не с кем)</>
          )}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground uppercase">
          сортировка по дате ↓
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Дата</TableHead>
            <TableHead>№ акта</TableHead>
            <TableHead className="text-right">Факт, кг</TableHead>
            <TableHead className="text-right">Принято, кг</TableHead>
            <TableHead className="text-right">Принято, %</TableHead>
            <TableHead className="text-right">Брак, %</TableHead>
            <TableHead>Категории</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {c.batches.map((b) => (
            // Подложку выбросов считает ядро (порог 1,5× среднего и ≥ 4 партий), а не UI.
            <TableRow key={b.itemId} className={b.outlier ? "bg-[#f6ecd6]" : undefined}>
              <TableCell className="tabular-nums">{fmtDate(b.date)}</TableCell>
              <TableCell className="font-mono text-[11px] text-muted-foreground">
                {b.actNumber ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {b.actualKg != null ? fmtInt(b.actualKg) : <Dash />}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {b.acceptedKg != null ? fmtInt(b.acceptedKg) : <Dash />}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtPct1(b.acceptedPct)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-[#9a6a12]">
                {b.brakPct != null ? fmtPct1(b.brakPct) : <Dash />}
              </TableCell>
              <TableCell>
                <CategoryStack cats={b.categories} color={c.color} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="text-[11.5px] text-muted-foreground">
        Итого: факт <span className="font-medium tabular-nums">{fmtInt(actualKg)}</span> кг
        · принято <span className="font-medium tabular-nums">{fmtInt(acceptedKg)}</span> кг
        {c.brakPct != null && (
          <>
            {" "}
            · брак{" "}
            <span className="font-medium text-[#9a6a12] tabular-nums">
              {fmtPct1(c.brakPct)}%
            </span>
          </>
        )}
        . Полный список поставок — на вкладке «Отгрузки».
      </div>
    </div>
  );
}

function CultureRow({ c }: { c: QualityCulture }) {
  const [open, setOpen] = useState(false);
  const hasBatches = c.batches.length > 0;

  return (
    <>
      <TableRow
        className={hasBatches ? "cursor-pointer" : undefined}
        onClick={hasBatches ? () => setOpen((v) => !v) : undefined}
      >
        <TableCell>
          <div className="flex items-center gap-2">
            {hasBatches ? (
              <ChevronDown
                className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
                aria-hidden
              />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            <CultureDot color={c.color} />
            <span className="font-medium">{c.name}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {c.acceptanceType === "calibre" ? "калибр" : "по весу"}
              {/* План строки контракта — контекст для культуры без актов («начало сезона»),
                  а не выполнение: выполнение живёт на вкладке «Контракты». */}
              {!hasBatches && c.contractTons != null && (
                <> · план {fmtTons(c.contractTons)} т</>
              )}
            </span>
            {c.nonStandardPct != null && (
              <span className="font-mono text-[10px] text-muted-foreground">
                · не в зачёт {fmtPct1(c.nonStandardPct)}%
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {/* Прочерк — только когда актов нет вовсе. Партия со 100% брака даёт честный
              ноль принятого, и его надо показать числом, а не спрятать. */}
          {hasBatches ? fmtTons(c.acceptedKg / 1000) : <Dash />}
        </TableCell>
        <TableCell className="text-right font-medium text-[#9a6a12] tabular-nums">
          {c.brakPct != null ? `${fmtPct1(c.brakPct)}%` : <Dash />}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {c.othersBrakPct != null ? (
            `${fmtPct1(c.othersBrakPct)}%`
          ) : (
            <Dash title="Сравнивать не с кем: единственный поставщик культуры в сезоне" />
          )}
        </TableCell>
        <TableCell className="text-right">
          {c.deltaPp != null ? (
            <DeltaChip pp={c.deltaPp} />
          ) : (
            <Dash title="Нет базы для Δ — остальных поставщиков нет" />
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {c.rank ? (
            <>
              {c.rank.position}{" "}
              <span className="text-muted-foreground">из {c.rank.of}</span>
            </>
          ) : (
            <Dash
              title={`Мало поставщиков для сравнения: культуру возит ${c.suppliersWithBrak} ${farmersWord(c.suppliersWithBrak)}`}
            />
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {c.acceptedKg > 0 ? `${Math.round(c.sharePct)}%` : <Dash />}
        </TableCell>
        <TableCell>
          {hasBatches ? (
            <CategoryStack cats={c.categories} color={c.color} />
          ) : (
            <span className="font-mono text-[11px] text-[#a1a1a1]">нет актов</span>
          )}
        </TableCell>
      </TableRow>

      {open && hasBatches && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8} className="p-0">
            <BatchTable c={c} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function WeeksTable({ weeks }: { weeks: FarmerQuality["weeks"] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Неделя</TableHead>
            <TableHead className="text-right">Партий</TableHead>
            <TableHead className="text-right">Факт, кг</TableHead>
            <TableHead className="text-right">Принято, кг</TableHead>
            <TableHead className="text-right">Брак, %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {weeks.map((w) => (
            <TableRow key={`${w.isoYear}-${w.isoWeek}`}>
              <TableCell className="font-mono text-[12px]">{w.label}</TableCell>
              <TableCell className="text-right tabular-nums">{w.positions}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(w.actualKg)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtInt(w.acceptedKg)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-[#9a6a12]">
                {w.brakPct != null ? fmtPct1(w.brakPct) : <Dash />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  muted,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  muted?: boolean;
  accent?: string;
}) {
  return (
    <div className="min-w-[140px] flex-1 rounded-lg border bg-muted/30 px-3.5 py-2.5">
      <div className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-semibold tracking-tight tabular-nums ${muted ? "text-[#a1a1a1]" : ""}`}
        style={!muted && accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export function QualityPanel({ data }: { data: FarmerQuality }) {
  const { kpi, cultures, totals, weeks, notes } = data;
  const { verdict, basedOnCultures } = totals.benchmark;

  if (cultures.length === 0) {
    return (
      <EmptyState
        icon={Sprout}
        title="Качество считать не из чего"
        description={`В сезоне ${data.season} у поставщика нет ни строк контракта, ни принятых поставок. Строки заводятся на вкладке «Контракты».`}
      />
    );
  }

  const noActs = kpi.actsCount === 0;
  // Подпись вердикта: при единственной культуре с базой называем её — «посчитано по 1
  // культуре» звучит как ошибка округления.
  const basedOnLabel =
    basedOnCultures === 1
      ? `только ${cultures.find((c) => c.deltaPp != null)?.name ?? ""}`
      : `посчитано по ${basedOnCultures} ${pluralRu(basedOnCultures, "культуре", "культурам", "культурам")}`;

  return (
    <div className="flex flex-col gap-4">
      {/* Шапка — как на «Расчётах»: имя, сезон и дата формирования моно справа. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold tracking-tight">Качество поставок</h3>
        <span className="text-sm text-muted-foreground">
          {data.farmer.name} · сезон {data.season} · {cultures.length}{" "}
          {pluralRu(cultures.length, "культура", "культуры", "культур")}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          сформировано {genFmt.format(new Date(`${data.generatedAt}T00:00:00Z`))}
        </span>
      </div>

      {/* Ровно ТРИ плитки, всегда: только величины, осмысленные для фермера целиком.
          «Не в зачёт» сюда не выносится — у смешанного фермера это Σ по одной calibre-
          культуре из четырёх, и общей она не является. Её место — строка культуры. */}
      <div className="flex flex-wrap gap-3">
        <Kpi
          label="Принято за сезон"
          value={noActs ? "—" : `${fmtTons(kpi.acceptedKg / 1000)} т`}
          sub={noActs ? "поставок ещё не было" : "эффективный вес"}
          muted={noActs}
        />
        <Kpi
          label="Средний брак"
          value={kpi.avgBrakPct != null ? `${fmtPct1(kpi.avgBrakPct)} %` : "—"}
          sub={
            kpi.avgBrakPct != null
              ? "взвешенный по факт. весу"
              : "появится после первого акта"
          }
          muted={kpi.avgBrakPct == null}
          accent="#9a6a12"
        />
        <Kpi
          label="Партий с актом"
          value={`${fmtInt(kpi.actsCount)} шт`}
          sub={`из ${fmtInt(kpi.positionsTotal)} ${pluralRu(kpi.positionsTotal, "поставки", "поставок", "поставок")} · ${kpi.weeksWithActs} нед. с актами`}
          muted={noActs}
        />
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b bg-muted/20 px-4 py-2.5">
          <span className="text-sm font-medium">По культурам</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            сортировка по принятому · бенчмарк — остальные поставщики этой культуры
          </span>
          {cultures.some((c) => c.batches.length > 0) && (
            <span className="ml-auto rounded-[5px] border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              нажмите строку → партии
            </span>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Культура</TableHead>
              <TableHead className="text-right">Принято, т</TableHead>
              <TableHead className="text-right">Брак у него</TableHead>
              <TableHead className="text-right">Брак у остальных</TableHead>
              <TableHead className="text-right">Δ</TableHead>
              <TableHead className="text-right">Позиция по культуре</TableHead>
              <TableHead className="text-right">Доля в культуре</TableHead>
              <TableHead>Категории</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cultures.map((c) => (
              <CultureRow key={c.cultureId} c={c} />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Итого по фермеру</TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtTons(totals.acceptedKg / 1000)}
              </TableCell>
              <TableCell className="text-right text-[#9a6a12] tabular-nums">
                {totals.brakPct != null ? `${fmtPct1(totals.brakPct)}%` : <Dash />}
              </TableCell>
              {/* ⚠ ЧИСЛА «брак у остальных» в итоге НЕТ: композит по культурам с разными
                  базами выглядит сопоставимым с браком фермера, но им не является. */}
              <TableCell className="text-right">
                <Dash title="Средний брак остальных по разным культурам — величины с разными базами, складывать их в одно число нельзя" />
              </TableCell>
              <TableCell colSpan={4} className="text-left">
                {verdict ? (
                  <span className="font-mono text-[11px] font-normal text-muted-foreground">
                    {VERDICT[verdict]} · {basedOnLabel}
                  </span>
                ) : (
                  <span className="font-mono text-[11px] font-normal text-[#a1a1a1]">
                    сравнивать пока не с кем
                  </span>
                )}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {weeks.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b bg-muted/20 px-4 py-2.5">
            <span className="text-sm font-medium">
              {notes.chartReady ? "Динамика брака по неделям" : "Брак по неделям"}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {notes.chartReady
                ? `взвешенный % по всем культурам · ISO-недели · ${notes.weeksWithActs} нед. с актами`
                : `${notes.weeksWithActs} нед. с актами — для графика мало точек`}
            </span>
            <span className="ml-auto rounded-[5px] border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {notes.chartReady ? "≥ 4 недель — график" : "< 4 недель — таблица"}
            </span>
          </div>
          <div className="p-4">
            {notes.chartReady ? (
              <QualityBrakChart
                data={weeks.map((w) => ({ label: w.label, pct: w.brakPct ?? 0 }))}
                avgPct={totals.brakPct}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <WeeksTable weeks={weeks} />
                <p className="text-[11.5px] text-muted-foreground">
                  График появится с <b>4-й недели</b> с актами. У одного фермера за сезон
                  10–40 партий: линия по трём точкам показывает шум как тренд.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {noActs && (
        <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <b>Сезон только начался.</b> Строки контрактов есть, приёмок ещё не было —
          качество считать не из чего.{" "}
          {cultures.some((c) => c.othersBrakPct != null)
            ? "«Брак у остальных» показан как ориентир по культуре: с ним будет сравниваться первый же акт."
            : "У остальных поставщиков актов тоже нет, поэтому сравнивать пока не с чем."}{" "}
          Контрактные строки — на вкладке «Контракты».
        </div>
      )}

      {/* Сноски: без них прочерки и пороги читаются как сбой расчёта. */}
      <ul className="flex flex-col gap-1 px-1 text-[11.5px] text-muted-foreground">
        <li>
          <b>Позиция</b> — место по браку среди поставщиков культуры, показывается только
          при <b>M ≥ 3</b>: «2 из 2» — не рейтинг, а шум.
        </li>
        <li>
          <b>Δ</b> — разница со средним по ОСТАЛЬНЫМ поставщикам культуры (сам фермер из
          базы исключён); важен знак, а не десятые.
        </li>
        {cultures.some((c) => c.batches.length >= 4) && (
          <li>
            Партия подсвечивается, если её брак в <b>1,5 раза</b> выше среднего брака этого
            фермера по этой культуре (и партий по ней не меньше четырёх).
          </li>
        )}
        {notes.hasCalibre && (
          <li className="flex items-start gap-1.5">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Категории калибра берутся из <b>действующей схемы культуры</b>, а не из снимка
              акта: правка схемы меняет картину качества прошлых партий. Лист уходит наружу —
              уточнить будет не у кого.
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
