"use client";

import { useState } from "react";
import { ChevronDown, Clock, FileText, TriangleAlert } from "lucide-react";

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
import type {
  FarmerSettlement,
  SettlementBatch,
  SettlementLine,
} from "@/server/farmers/settlement-agg";
import { periodColumnSuffix } from "@/server/farmers/settlement-period";
import { EmptyState } from "./EmptyState";
import { ProgressCell } from "./ProgressCell";

// Расчётный лист по фермеру. Лист показывает НАЧИСЛЕНО, а не долг: сущности платежей
// и авансов в системе нет, поэтому колонок «оплачено»/«остаток» здесь быть не может.
//
// ⚠ ДВЕ БАЗЫ ВЕСА (DOMAIN §1, BR-33) отражены в названиях колонок:
//   «Зачтено» — принятый вес, идущий в объём строки контракта (тонны выполнения);
//   «К оплате» — оплачиваемый вес = зачтено + доплата по корректировке расчёта (деньги).
// ⚠ ДВА СКОУПА: деньги и веса — за выбранный период, «Заявлено» и «Выполнение» — всегда
//   за сезон (volume_tons строки задан на сезон), это подписано в заголовках колонок.
//
// Клиентский компонент только ради раскрытия строк (useState). Все числа приходят
// посчитанными с сервера — здесь ни одной формулы, только форматирование.

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC", // даты в БД — UTC-полночь, локальная зона сдвинула бы день
});

function fmtDate(d: string | null): string {
  return d ? dateFmt.format(new Date(`${d}T00:00:00Z`)) : "—";
}

// Проценты акта хранятся как Decimal(5,2): 97 → «97», 97.5 → «97,5».
function fmtPercent(n: number): string {
  return String(n).replace(".", ",");
}

function CultureDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-sm"
      style={{ backgroundColor: color }}
    />
  );
}

// Чип корректировки расчёта (BR-33) — тот же вид, что в приёмке (AcceptedMachine).
function SettlementChip({ percent }: { percent: number }) {
  return (
    <span className="whitespace-nowrap rounded-[5px] border border-[#ebebeb] bg-white px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-[#4d4d4d] uppercase">
      корректировка {fmtPercent(percent)} %
    </span>
  );
}

function BatchRow({ b, showSurcharge }: { b: SettlementBatch; showSurcharge: boolean }) {
  const { position: p } = b;
  return (
    <div className="px-4 py-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]">
        <span className="font-medium tabular-nums">{fmtDate(b.date)}</span>
        {b.actNumber && (
          <span className="font-mono text-[11px] text-muted-foreground">
            акт {b.actNumber}
          </span>
        )}
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <CultureDot color={b.color} />
          {b.cultureName}
        </span>

        <span className="ml-auto tabular-nums text-muted-foreground">
          зачтено{" "}
          <span className="font-medium text-foreground">{fmtInt(b.countedKg)}</span> кг
        </span>
        {showSurcharge && (
          <span className="tabular-nums text-muted-foreground">
            доплата{" "}
            <span className="font-medium text-foreground">
              {b.surchargeKg > 0 ? `+${fmtInt(b.surchargeKg)}` : "0"}
            </span>{" "}
            кг
          </span>
        )}
        {/* Зелёный акцент — всегда на числе, по которому платят (как в приёмке). */}
        <span className="font-semibold tabular-nums text-[#1d8e75]">
          к оплате {fmtInt(b.paidKg)} кг
        </span>
        <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
          {fmtInt(b.costRub)} ₽
        </span>
        {b.settlementPercent != null && <SettlementChip percent={b.settlementPercent} />}
      </div>

      {/* Разбор факта партии — объясняет фермеру цепочку «привёз → приняли → платим».
          ⚠ Это величины ПОЗИЦИИ ЦЕЛИКОМ: при linesCount > 1 они повторяются в каждой
          строке контракта, поэтому по колонкам не суммируются. */}
      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
        <span className="tabular-nums">
          факт {p.actualKg != null ? `${fmtInt(p.actualKg)} кг` : "—"}
        </span>
        {p.acceptedKg != null && (
          <>
            {" → "}
            <span className="tabular-nums">
              принято по акту {fmtInt(p.acceptedKg)} кг ({fmtPct1(p.acceptedPercent)} %)
            </span>
          </>
        )}
        {p.nonStandardPercent > 0 && (
          <span className="tabular-nums"> · нестандарт {fmtPct1(p.nonStandardPercent)} %</span>
        )}
        {p.brakPercent != null && p.brakPercent > 0 && (
          <span className="tabular-nums"> · брак {fmtPct1(p.brakPercent)} %</span>
        )}
        {p.linesCount > 1 && (
          <span> · партия делится на {p.linesCount} строки контракта</span>
        )}
      </div>
    </div>
  );
}

function LineRows({
  line,
  columns,
  showSurcharge,
}: {
  line: SettlementLine;
  columns: number;
  showSurcharge: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasBatches = line.batches.length > 0;
  const idle = line.countedKg === 0;

  return (
    <>
      <TableRow
        className={hasBatches ? "cursor-pointer" : undefined}
        onClick={hasBatches ? () => setOpen((v) => !v) : undefined}
      >
        <TableCell>
          <span className={`flex items-center gap-2 ${idle ? "text-muted-foreground" : ""}`}>
            {hasBatches ? (
              <ChevronDown
                className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                  open ? "" : "-rotate-90"
                }`}
                aria-hidden
              />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            <CultureDot color={line.color} />
            {line.cultureName}
            {line.label && (
              <span className="text-xs text-muted-foreground">{line.label}</span>
            )}
            {line.pricePerKg === 0 && (
              <span className="rounded-[5px] border px-1 py-px font-mono text-[9.5px] text-muted-foreground uppercase">
                цена не задана
              </span>
            )}
            {hasBatches && (
              <span className="text-xs text-muted-foreground">
                · {line.batches.length}
              </span>
            )}
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums">{line.pricePerKg}</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {fmtTons(line.season.targetKg / 1000)}
        </TableCell>
        <TableCell className={`text-right tabular-nums ${idle ? "text-muted-foreground" : ""}`}>
          {fmtTons(line.countedKg / 1000)}
        </TableCell>
        {showSurcharge && (
          <TableCell className="text-right tabular-nums">
            {line.surchargeKg > 0 ? fmtInt(line.surchargeKg) : "—"}
          </TableCell>
        )}
        <TableCell className={`text-right tabular-nums ${idle ? "text-muted-foreground" : ""}`}>
          {fmtTons(line.paidKg / 1000)}
        </TableCell>
        <TableCell
          className={`text-right font-medium tabular-nums ${idle ? "font-normal text-muted-foreground" : ""}`}
        >
          {fmtInt(line.costRub)}
        </TableCell>
        <TableCell className="w-40">
          <ProgressCell pct={line.season.pct} />
        </TableCell>
      </TableRow>

      {open && hasBatches && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={columns} className="bg-muted/30 p-0">
            <div className="flex flex-col divide-y divide-border">
              {line.batches.map((b) => (
                <BatchRow key={b.itemId} b={b} showSurcharge={showSurcharge} />
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

const UNPAID_REASON: Record<string, string> = {
  no_line: "нет строки контракта",
  foreign_line: "строка другого контракта или сезона",
  no_weight: "нет перевески",
};

const PENDING_STATUS: Record<string, string> = {
  planned: "запланирована",
  sent: "в пути",
  arrived: "прибыла, не принята",
  // Аномалия данных: отгрузка принята, а акта у позиции нет — считать по ней нечего.
  accepted: "принята, но акта нет",
};

// Ожидающих приёмки бывает много (весь будущий план сезона), поэтому по умолчанию
// блок свёрнут: на листе важен счётчик «эти машины в расчёт не вошли», а список —
// по требованию.
function PendingBlock({ pending }: { pending: FarmerSettlement["pending"] }) {
  const [open, setOpen] = useState(false);
  const plannedKg = pending.reduce((s, p) => s + p.plannedKg, 0);

  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 bg-muted/30 px-4 py-2.5 text-left hover:bg-muted/50"
      >
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
            open ? "" : "-rotate-90"
          }`}
          aria-hidden
        />
        <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">Ожидают приёмки</span>
        <span className="text-[12.5px] text-muted-foreground">
          {pending.length} поз. · план {fmtTons(plannedKg / 1000)} т — акта приёмки ещё
          нет, в расчёт не входят
        </span>
      </button>
      {open && (
        <div className="flex flex-col divide-y divide-border border-t">
          {pending.map((p) => (
            <div
              key={p.itemId}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2 text-[13px]"
            >
              <span className="font-medium tabular-nums">{fmtDate(p.date)}</span>
              <span className="flex items-center gap-1.5">
                <CultureDot color={p.color} />
                {p.cultureName}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {PENDING_STATUS[p.status]}
              </span>
              <span className="ml-auto tabular-nums text-muted-foreground">
                план {fmtInt(p.plannedKg)} кг
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettlementPanel({ data }: { data: FarmerSettlement }) {
  const { lines, totals, unpaid, unpaidTotals, pending, notes, period } = data;
  const showSurcharge = notes.hasSurcharge;
  const columns = showSurcharge ? 8 : 7;
  const suffix = periodColumnSuffix(period);
  // Ожидающие приёмки в расчёт не входят, поэтому на «пустоту периода» они не влияют:
  // строки с нулями без объяснения читались бы как сбой расчёта.
  const nothingInPeriod = totals.countedKg === 0 && unpaid.length === 0;

  if (lines.length === 0 && unpaid.length === 0 && pending.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Нечего рассчитывать"
        description={`У поставщика нет строк контракта в сезоне ${data.season}. Контракты заводятся в разделе «Контракты».`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold tracking-tight">Расчётный лист</h3>
        <span className="text-sm text-muted-foreground">
          {data.farmer.name}
          {/* При period=сезон подпись периода и так «Сезон N» — второй раз не повторяем. */}
          {!period.isSeason && ` · сезон ${data.season}`} · {period.label}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          сформирован {fmtDate(data.generatedAt)}
        </span>
      </div>

      {nothingInPeriod && (
        <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          За выбранный период принятых поставок нет
          {pending.length > 0 && ` (${pending.length} поз. ещё ждут приёмки)`}. Ниже —
          заявленные объёмы и выполнение за сезон.
        </div>
      )}

      {lines.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Культура · строка</TableHead>
                <TableHead className="text-right">Цена, ₽/кг</TableHead>
                <TableHead className="text-right">
                  Заявлено, т
                  <span className="block text-[10px] font-normal">за сезон</span>
                </TableHead>
                <TableHead className="text-right">
                  Зачтено, т
                  {suffix && <span className="block text-[10px] font-normal">{suffix}</span>}
                </TableHead>
                {showSurcharge && (
                  <TableHead className="text-right">
                    Доплата, кг
                    {suffix && <span className="block text-[10px] font-normal">{suffix}</span>}
                  </TableHead>
                )}
                <TableHead className="text-right">
                  К оплате, т
                  {suffix && <span className="block text-[10px] font-normal">{suffix}</span>}
                </TableHead>
                <TableHead className="text-right">
                  Сумма, ₽
                  {suffix && <span className="block text-[10px] font-normal">{suffix}</span>}
                </TableHead>
                <TableHead className="w-40">
                  Выполнение
                  <span className="block text-[10px] font-normal">за сезон</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <LineRows
                  key={l.lineId}
                  line={l}
                  columns={columns}
                  showSurcharge={showSurcharge}
                />
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Итого</TableCell>
                <TableCell />
                <TableCell className="text-right font-medium tabular-nums">
                  {fmtTons(totals.season.targetKg / 1000)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {fmtTons(totals.countedKg / 1000)}
                </TableCell>
                {showSurcharge && (
                  <TableCell className="text-right font-medium tabular-nums">
                    {totals.surchargeKg > 0 ? fmtInt(totals.surchargeKg) : "—"}
                  </TableCell>
                )}
                <TableCell className="text-right font-medium tabular-nums">
                  {fmtTons(totals.paidKg / 1000)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmtInt(totals.costRub)}
                </TableCell>
                <TableCell>
                  <ProgressCell pct={totals.season.pct} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      {unpaid.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[#ffefcf]">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#ffefcf] bg-[#fff6e3] px-4 py-2.5 text-[#ab570a]">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            <span className="text-sm font-medium">Без привязки к контракту</span>
            <span className="text-[12.5px]">
              {unpaidTotals.positions} поз. · {fmtInt(unpaidTotals.unpaidKg)} кг не
              оплачивается — нет строки, по которой считать цену
            </span>
          </div>
          <div className="flex flex-col divide-y divide-border">
            {unpaid.map((u) => (
              <div
                key={`${u.itemId}-${u.reason}-${u.foreignLineId ?? 0}`}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2 text-[13px]"
              >
                <span className="font-medium tabular-nums">{fmtDate(u.date)}</span>
                {u.actNumber && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    акт {u.actNumber}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <CultureDot color={u.color} />
                  {u.cultureName}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {UNPAID_REASON[u.reason]}
                  {u.foreignLineId != null && ` (#${u.foreignLineId})`}
                  {u.partial && " · часть партии оплачена выше"}
                </span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  факт {u.actualKg != null ? `${fmtInt(u.actualKg)} кг` : "—"}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  принято по акту{" "}
                  {u.acceptedKg != null ? `${fmtInt(u.acceptedKg)} кг` : "—"}
                </span>
                <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                  {fmtInt(u.unpaidKg)} кг
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 && <PendingBlock pending={pending} />}

      {/* Сноски: без них расхождения с соседними экранами читаются как ошибка расчёта. */}
      <ul className="flex flex-col gap-1 px-1 text-[11.5px] text-muted-foreground">
        {lines.length > 0 && (
          <li>
            «Зачтено» — вес, засчитанный в объём строки контракта; это то же число, что
            «Принято» на вкладке «Контракты». «Заявлено» и «Выполнение» — всегда за
            сезон, объём строки контракта задан на сезон.
          </li>
        )}
        {showSurcharge && (
          <li>
            Доплата по корректировке расчёта (договорённость «платим N % от факта») идёт
            только в деньги: в тонны выполнения контракта она не входит.
          </li>
        )}
        {notes.splitBatchCount > 0 && (
          <li>
            {notes.splitBatchCount} парт. разложены по нескольким строкам контракта —
            факт и «принято по акту» в разборе относятся ко всей партии и по строкам не
            складываются.
          </li>
        )}
        {notes.undatedCount > 0 && !period.isSeason && (
          <li>
            {notes.undatedCount} поз. без даты прибытия и отправления — в сезон они
            входят, но ни в один узкий период не попадают.
          </li>
        )}
        {notes.hasZeroPrice && (
          <li>У части строк не задана цена — вес зачтён, сумма по ним нулевая.</li>
        )}
        <li>
          Лист показывает начислено. Платежей и авансов в системе нет, поэтому «оплачено»
          и «остаток долга» здесь не считаются. Итоги берутся от точных значений, а не от
          округлённых строк.
        </li>
      </ul>
    </div>
  );
}
