"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Truck, AlertCircle, RotateCcw } from "lucide-react";

import type { ActContext, ActCalibreRange } from "@/server/acceptance/schema";
import { setActualWeight } from "@/server/acceptance/actions";
import { saveAct, revertAct } from "@/server/acceptance/act";
import { formatWeight } from "@/app/(app)/shipments/_components/shipment-actions";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const M_CONTENT_CLS =
  "gap-0 overflow-hidden rounded-lg border border-[#ebebeb] bg-white p-0 sm:max-w-[520px]";

// Radix Select не допускает value="" — сентинел для «— не в зачёт» (contract_line_id=null).
const NONE = "__none__";

const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function priceLabel(line: ActContext["contractLines"][number], cultureName: string) {
  const name = line.label?.trim() || cultureName;
  return `${name} · ${Number(line.pricePerKg)} ₽/кг`;
}

// Размерный текст категории из min/max (см). Оба null — безразмерная (только label).
function rangeText(r: ActCalibreRange): string | null {
  const min = r.minCm != null ? Number(r.minCm) : null;
  const max = r.maxCm != null ? Number(r.maxCm) : null;
  if (min != null && max != null) return `${min}–${max} см`;
  if (min != null) return `>${min} см`;
  if (max != null) return `<${max} см`;
  return null;
}

export function AcceptanceActDialog({
  context,
  open,
  onOpenChange,
  openedFromSent,
  isAdmin,
}: {
  context: ActContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openedFromSent: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const isCalibre = context.acceptanceType === "calibre";

  // Вес — то же поле actual_weight_kg (setActualWeight), один источник (BR-25).
  const [savedWeight, setSavedWeight] = useState<number | null>(context.actualKg);
  const [weightStr, setWeightStr] = useState(
    context.actualKg != null ? String(context.actualKg) : "",
  );
  const [weightEditing, setWeightEditing] = useState(false);
  const [weightBusy, setWeightBusy] = useState(false);

  const [actNumber, setActNumber] = useState(context.existing?.actNumber ?? "");
  const [brakStr, setBrakStr] = useState(
    context.existing ? String(context.existing.brakPercent) : "",
  );

  // simple: одна строка контракта.
  const [lineId, setLineId] = useState<string>(
    context.existing?.contractLineId != null
      ? String(context.existing.contractLineId)
      : context.autoLineId != null
        ? String(context.autoLineId)
        : "",
  );

  // calibre: % и привязка по категориям. Дефолт: принятые → строка позиции/единственная.
  const defaultBind = useMemo(
    () =>
      context.itemLineId != null
        ? String(context.itemLineId)
        : context.autoLineId != null
          ? String(context.autoLineId)
          : "",
    [context.itemLineId, context.autoLineId],
  );
  const existingCal = useMemo(
    () => new Map(context.existing?.calibres.map((c) => [c.calibreRangeId, c]) ?? []),
    [context.existing],
  );
  const [percents, setPercents] = useState<Record<number, string>>(() => {
    const o: Record<number, string> = {};
    for (const r of context.calibreRanges) {
      const ex = existingCal.get(r.id);
      o[r.id] = ex ? String(ex.percent) : "";
    }
    return o;
  });
  const [bindings, setBindings] = useState<Record<number, string>>(() => {
    const o: Record<number, string> = {};
    for (const r of context.calibreRanges) {
      const ex = existingCal.get(r.id);
      o[r.id] =
        ex?.contractLineId != null
          ? String(ex.contractLineId)
          : r.isAccepted
            ? defaultBind || NONE
            : NONE;
    }
    return o;
  });

  const [submitting, setSubmitting] = useState(false);

  const brak = useMemo(() => {
    const n = Number(brakStr.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }, [brakStr]);

  // --- calibre агрегаты (одноступенчато, база = факт; BR-10) ---
  const pctNum = (id: number) => {
    const n = Number((percents[id] ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  // Σ размерных/безразмерных категорий (без брака — брак отдельное поле акта).
  const sumPct = useMemo(
    () => context.calibreRanges.reduce((s, r) => s + pctNum(r.id), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [percents, context.calibreRanges],
  );
  const acceptedPct = useMemo(
    () =>
      context.calibreRanges
        .filter((r) => r.isAccepted)
        .reduce((s, r) => s + pctNum(r.id), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [percents, context.calibreRanges],
  );
  const nonAcceptedKg =
    savedWeight != null ? (savedWeight * (sumPct - acceptedPct)) / 100 : null;

  // Принятый вес — производное (база = факт).
  const accepted =
    savedWeight == null
      ? null
      : isCalibre
        ? Math.round((savedWeight * acceptedPct) / 100)
        : Math.round(savedWeight * (1 - brak / 100));

  const calibreBindMissing =
    isCalibre &&
    context.calibreRanges.some((r) => {
      const b = bindings[r.id] ?? NONE;
      return r.isAccepted && (b === "" || b === NONE);
    });
  // Σ категорий + брак = 100% факта.
  const sumOk = !isCalibre || Math.abs(sumPct + brak - 100) <= 0.01;

  const blockReason =
    savedWeight == null || savedWeight <= 0
      ? "Внесите фактический вес"
      : actNumber.trim() === ""
        ? "Укажите № акта"
        : brak < 0 || brak > 100
          ? "Брак 0–100%"
          : !isCalibre && lineId === ""
            ? "Выберите строку контракта"
            : isCalibre && !sumOk
              ? "Сумма категорий и брака = 100% факта"
              : calibreBindMissing
                ? "Привяжите принятые категории к строке"
                : null;

  async function commitWeight() {
    setWeightEditing(false);
    const cleaned = weightStr.replace(/\s|кг/gi, "").replace(",", ".").trim();
    if (cleaned === "") {
      if (savedWeight == null) return;
      setWeightBusy(true);
      const res = await setActualWeight({
        shipmentItemId: context.shipmentItemId,
        actualWeightKg: null,
      });
      setWeightBusy(false);
      if (res.ok) {
        setSavedWeight(null);
        setWeightStr("");
        router.refresh();
      } else toast.error(res.error);
      return;
    }
    const num = Number(cleaned);
    if (!Number.isFinite(num) || num <= 0) {
      toast.error("Вес должен быть больше 0");
      return;
    }
    if (num === savedWeight) return;
    setWeightBusy(true);
    const res = await setActualWeight({
      shipmentItemId: context.shipmentItemId,
      actualWeightKg: num,
    });
    setWeightBusy(false);
    if (res.ok) {
      setSavedWeight(num);
      router.refresh();
    } else toast.error(res.error);
  }

  async function onSubmit() {
    if (blockReason) return;
    setSubmitting(true);
    const res = await saveAct({
      shipmentItemId: context.shipmentItemId,
      actNumber: actNumber.trim(),
      brakPercent: brak,
      ...(isCalibre
        ? {
            calibres: context.calibreRanges.map((r) => {
              const b = bindings[r.id] ?? NONE;
              return {
                calibreRangeId: r.id,
                percent: pctNum(r.id),
                contractLineId: b === "" || b === NONE ? null : Number(b),
              };
            }),
          }
        : { contractLineId: Number(lineId) }),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success("Позиция принята");
      onOpenChange(false);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  async function onRevert() {
    const res = await revertAct({ shipmentItemId: context.shipmentItemId });
    if (res.ok) {
      toast.success("Приёмка откатена");
      onOpenChange(false);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  const weightDisplay =
    weightEditing || weightBusy
      ? weightStr
      : savedWeight != null
        ? `${formatWeight(savedWeight)} кг`
        : "";

  const machineLine = [
    context.departureDate
      ? dayMonthFmt.format(new Date(`${context.departureDate}T00:00:00Z`))
      : null,
    context.driverName,
    context.transportCompanyName,
  ]
    .filter(Boolean)
    .join(" · ");

  function bindingSelect(r: ActCalibreRange) {
    const editable = r.isAccepted || isAdmin;
    if (!editable) {
      return <span className="text-[12px] text-[#888888]">не в зачёт</span>;
    }
    return (
      <Select
        value={bindings[r.id] ?? NONE}
        onValueChange={(v) => setBindings((b) => ({ ...b, [r.id]: v }))}
      >
        <SelectTrigger className="h-8 w-full text-[12.5px]">
          <SelectValue placeholder={r.isAccepted ? "выберите" : "не в зачёт"} />
        </SelectTrigger>
        <SelectContent>
          {/* Дефолт/сброс: вернуть «не в зачёт» (line=null) после случайного выбора (фикс 5). */}
          <SelectItem value={NONE}>— не в зачёт</SelectItem>
          {context.contractLines.map((l) => (
            <SelectItem key={l.id} value={String(l.id)}>
              {l.label?.trim() || context.cultureName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Поля-заготовки (одна разметка, разное расположение в calibre/simple).
  const actNumberField = (
    <Field label="№ акта (партии)" hint="обязателен">
      <input
        value={actNumber}
        onChange={(e) => setActNumber(e.target.value)}
        placeholder="не задан"
        className="h-12 w-full rounded-md border border-[#ebebeb] bg-white px-3 font-mono text-sm tracking-normal text-[#171717] outline-none placeholder:text-[#888888] focus:border-[#171717] focus:ring-1 focus:ring-[#171717]"
      />
    </Field>
  );

  const weightField = (
    <Field
      label="Фактический вес"
      tag={savedWeight != null && !weightEditing ? "из перевески" : "вводится здесь"}
    >
      <div className="flex h-12 items-center rounded-md border border-[#ebebeb] bg-white px-3 focus-within:border-[#171717] focus-within:ring-1 focus-within:ring-[#171717]">
        <input
          inputMode="decimal"
          value={weightDisplay}
          onFocus={() => {
            setWeightEditing(true);
            setWeightStr(savedWeight != null ? String(savedWeight) : "");
          }}
          onChange={(e) => setWeightStr(e.target.value)}
          onBlur={commitWeight}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="не перевешивали"
          className="w-full bg-transparent text-[18px] font-medium tabular-nums text-[#171717] outline-none placeholder:text-[15px] placeholder:font-normal placeholder:text-[#888888]"
        />
        <span className="ml-1.5 shrink-0 text-sm text-[#888888]">кг</span>
      </div>
    </Field>
  );

  const brakField = (
    <Field label="% брака">
      <div className="flex h-12 items-center justify-end rounded-md border border-[#ebebeb] bg-white px-3 focus-within:border-[#171717] focus-within:ring-1 focus-within:ring-[#171717]">
        <input
          inputMode="decimal"
          value={brakStr}
          onChange={(e) => setBrakStr(e.target.value)}
          placeholder="0"
          className="w-full bg-transparent text-right text-sm tabular-nums text-[#171717] outline-none placeholder:text-[#888888]"
        />
        <span className="ml-1 shrink-0 text-sm text-[#888888]">%</span>
      </div>
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className={M_CONTENT_CLS}>
        {/* Шапка */}
        <div className="border-b border-[#ebebeb] px-5 pb-4 pt-[18px]">
          <DialogTitle className="text-[18px] font-semibold leading-6 tracking-[-0.035em] text-[#171717]">
            Акт приёмки
          </DialogTitle>
          <div className="mt-2 flex flex-wrap items-center gap-x-[7px] gap-y-1 text-[13px] tracking-tight text-[#4d4d4d]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#171717]">
              <span
                className="inline-block size-[9px] shrink-0 rounded-[3px]"
                style={{ backgroundColor: context.cultureColor }}
              />
              {context.cultureName}
            </span>
            <span className="text-[#a1a1a1]">·</span>
            <span>{context.farmerName}</span>
            {machineLine && (
              <>
                <span className="text-[#a1a1a1]">·</span>
                <span className="inline-flex items-center gap-1.5 text-[#888888]">
                  <Truck className="size-3" />
                  {machineLine}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-[15px] overflow-y-auto px-5 pb-[18px] pt-4">
          {openedFromSent && (
            <div className="flex items-start gap-2.5 rounded-lg border border-[#cfe1ff] bg-[#eaf2ff] px-3 py-2.5 text-[12.5px] leading-[17px] tracking-tight text-[#0761d1]">
              <Truck className="mt-px size-3.5 shrink-0" />
              <span>
                Машина отмечена <b className="font-semibold">прибывшей</b> — приёмка
                с этой позиции (sent → arrived).
              </span>
            </div>
          )}

          {isCalibre ? (
            <>
              {/* № акта + фактический вес — один ряд, одинаковая ширина (BR-10) */}
              <div className="grid grid-cols-2 items-start gap-3">
                {actNumberField}
                {weightField}
              </div>

              {/* Таблица категорий схемы культуры (+ брак последней строкой) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium tracking-tight text-[#171717]">
                    Категории
                  </span>
                  <span className="text-[11.5px] text-[#888888]">% от факта</span>
                </div>
                <div className="overflow-hidden rounded-lg border border-[#ebebeb]">
                  <div className="grid grid-cols-[1fr_84px_72px_150px] items-center gap-2 border-b border-[#ebebeb] bg-[#fafafa] px-3 py-2 font-mono text-[9.5px] uppercase tracking-wide text-[#888888]">
                    <span>Категория</span>
                    <span className="text-right">кг</span>
                    <span className="text-right">%</span>
                    <span>Строка контракта</span>
                  </div>
                  {context.calibreRanges.map((r) => {
                    const rt = rangeText(r);
                    const kg =
                      savedWeight != null
                        ? Math.round((savedWeight * pctNum(r.id)) / 100)
                        : null;
                    return (
                      <div
                        key={r.id}
                        className="grid grid-cols-[1fr_84px_72px_150px] items-center gap-2 border-b border-[#ebebeb] px-3 py-2 last:border-b-0"
                      >
                        <span className="flex flex-col gap-0.5">
                          <span className="text-[13.5px] font-medium tabular-nums text-[#171717]">
                            {rt ?? r.label}
                          </span>
                          <span
                            className={`inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-px text-[10px] ${
                              r.isAccepted
                                ? "bg-[#ddfff7] text-[#1d8e75]"
                                : "bg-[#f5f5f5] text-[#4d4d4d]"
                            }`}
                          >
                            <span
                              className="inline-block size-[5px] rounded-full"
                              style={{
                                backgroundColor: r.isAccepted ? "#1d8e75" : "#a1a1a1",
                              }}
                            />
                            {r.isAccepted ? "принято" : "нестандарт"}
                          </span>
                        </span>
                        {/* кг (расчёт из точного %) — read-only, выровнен по высоте инпута (фикс 6). */}
                        <span className="flex h-8 items-center justify-end tabular-nums text-[12px] text-[#888888]">
                          {kg != null ? `${formatWeight(kg)} кг` : "—"}
                        </span>
                        <div className="flex h-8 w-full shrink-0 items-center rounded-md border border-[#ebebeb] bg-white px-2 focus-within:border-[#171717] focus-within:ring-1 focus-within:ring-[#171717]">
                          <input
                            inputMode="decimal"
                            value={percents[r.id] ?? ""}
                            onChange={(e) =>
                              setPercents((p) => ({ ...p, [r.id]: e.target.value }))
                            }
                            placeholder="0"
                            className="w-full bg-transparent text-right text-sm tabular-nums text-[#171717] outline-none placeholder:text-[#888888]"
                          />
                          <span className="ml-1 shrink-0 text-xs text-[#888888]">%</span>
                        </div>
                        {bindingSelect(r)}
                      </div>
                    );
                  })}
                  {/* Брак — поле акта, рендерится последней строкой категорий (BR-10). */}
                  <div className="grid grid-cols-[1fr_84px_72px_150px] items-center gap-2 border-b border-[#ebebeb] px-3 py-2 last:border-b-0">
                    <span className="text-[13.5px] font-medium text-[#171717]">Брак</span>
                    <span className="flex h-8 items-center justify-end tabular-nums text-[12px] text-[#888888]">
                      {savedWeight != null
                        ? `${formatWeight(Math.round((savedWeight * brak) / 100))} кг`
                        : "—"}
                    </span>
                    <div className="flex h-8 w-full shrink-0 items-center rounded-md border border-[#ebebeb] bg-white px-2 focus-within:border-[#171717] focus-within:ring-1 focus-within:ring-[#171717]">
                      <input
                        inputMode="decimal"
                        value={brakStr}
                        onChange={(e) => setBrakStr(e.target.value)}
                        placeholder="0"
                        className="w-full bg-transparent text-right text-sm tabular-nums text-[#171717] outline-none placeholder:text-[#888888]"
                      />
                      <span className="ml-1 shrink-0 text-xs text-[#888888]">%</span>
                    </div>
                    <span className="pl-2 text-[12px] text-[#888888]">— не в зачёт</span>
                  </div>
                  {/* Σ */}
                  <div className="flex items-center gap-2 border-t border-[#ebebeb] bg-[#fafafa] px-3 py-2.5">
                    <span className="text-[12.5px] font-medium tracking-tight text-[#171717]">
                      Σ
                    </span>
                    <span className="text-[11px] text-[#888888]">= 100% факта</span>
                    <span
                      className={`ml-auto inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums ${
                        sumOk ? "text-[#1d8e75]" : "text-[#c50000]"
                      }`}
                    >
                      {sumOk ? (
                        <Check className="size-3.5" />
                      ) : (
                        <AlertCircle className="size-3.5" />
                      )}
                      {(sumPct + brak).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} %
                      {!sumOk && <span className="font-normal text-[#888888]">/ 100%</span>}
                    </span>
                  </div>
                </div>
                <p className="text-[11.5px] leading-4 text-[#888888]">
                  Дефолт: принятые → строка позиции; нестандарт → без строки (не в зачёт).
                </p>
              </div>

              {/* Принятый вес */}
              <AcceptedStrip
                accepted={accepted}
                formula={
                  savedWeight != null
                    ? `${formatWeight(savedWeight)} кг × ${acceptedPct.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}% (принятые) = ${accepted != null ? formatWeight(accepted) : "—"} кг`
                    : null
                }
                note="принятые категории"
              />

              {/* Нестандарт */}
              {nonAcceptedKg != null && sumPct - acceptedPct > 0 && (
                <div className="flex items-center gap-2.5 rounded-md border border-dashed border-[#a1a1a1] bg-white px-3 py-2.5">
                  <span className="inline-flex items-center gap-2 text-[12.5px] tracking-tight text-[#4d4d4d]">
                    <span className="inline-block size-1.5 rounded-full bg-[#a1a1a1]" />
                    Нестандарт
                  </span>
                  <span className="ml-auto text-sm font-semibold tabular-nums text-[#171717]">
                    {formatWeight(Math.round(nonAcceptedKg))}
                    <span className="ml-0.5 text-[11px] font-normal text-[#888888]">кг</span>
                  </span>
                  <span className="text-[10.5px] text-[#888888]">не в зачёт</span>
                </div>
              )}
            </>
          ) : (
            <>
              {/* № акта */}
              {actNumberField}

              {/* Вес + % брака — один ряд (фикс 1) */}
              <div className="grid grid-cols-[1fr_120px] items-end gap-3">
                {weightField}
                {brakField}
              </div>

              {/* Строка контракта (simple) — отдельным полем (фикс 1) */}
              <Field label="Строка контракта">
                {context.autoLineId != null ? (
                  <div className="flex h-10 items-center gap-2 rounded-md border border-[#ebebeb] bg-[#fafafa] px-3 text-[13.5px] text-[#171717]">
                    <span
                      className="inline-block size-[9px] shrink-0 rounded-[3px]"
                      style={{ backgroundColor: context.cultureColor }}
                    />
                    <span className="truncate">
                      {priceLabel(context.contractLines[0], context.cultureName)}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide text-[#888888]">
                      авто
                    </span>
                  </div>
                ) : (
                  <Select value={lineId} onValueChange={setLineId}>
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue placeholder="выберите строку" />
                    </SelectTrigger>
                    <SelectContent>
                      {context.contractLines.map((l) => (
                        <SelectItem key={l.id} value={String(l.id)}>
                          {priceLabel(l, context.cultureName)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              {/* Принятый вес */}
              <AcceptedStrip
                accepted={accepted}
                formula={
                  savedWeight != null
                    ? `${formatWeight(savedWeight)} кг × (1 − ${(brak / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2 })}) = ${accepted != null ? formatWeight(accepted) : "—"} кг`
                    : null
                }
                note="пойдёт в выполнение контракта"
              />
            </>
          )}
        </div>

        {/* Футер */}
        <div className="flex gap-2 border-t border-[#ebebeb] px-5 pb-[18px] pt-3.5">
          <button
            onClick={() => onOpenChange(false)}
            className="h-10 flex-1 rounded-md border border-[#ebebeb] bg-white px-4 text-sm font-medium tracking-tight text-[#4d4d4d] hover:bg-[#fafafa]"
          >
            Отмена
          </button>
          <div className="group relative flex flex-1">
            <button
              onClick={onSubmit}
              disabled={blockReason != null || submitting}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-[#171717] bg-[#171717] px-4 text-sm font-medium tracking-tight text-white shadow-[0_1px_2px_#0000001f] hover:bg-[#171717]/90 disabled:cursor-not-allowed disabled:border-[#ebebeb] disabled:bg-[#f1f1f1] disabled:text-[#888888] disabled:shadow-none"
            >
              <Check className="size-[15px]" /> Принять
            </button>
            {blockReason && (
              <span className="pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#171717] px-[10px] py-2 text-xs text-white group-hover:block">
                {blockReason}
              </span>
            )}
          </div>
        </div>

        {context.isLastUnaccepted && !context.existing && (
          <div className="px-5 pb-4">
            <div className="flex items-center gap-2 whitespace-nowrap rounded-md border border-[#c7f6ea] bg-[#ddfff7] px-3 py-2 text-xs leading-4 tracking-tight text-[#1d8e75]">
              <Check className="size-3.5 shrink-0" />
              Последняя непринятая позиция — машина будет принята полностью.
            </div>
          </div>
        )}

        {isAdmin && context.existing && (
          <div className="border-t border-[#ebebeb] px-5 py-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="inline-flex items-center gap-1.5 text-xs font-medium text-[#888888] hover:text-[#c50000]">
                  <RotateCcw className="size-3.5" /> Откатить приёмку
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertCircle className="size-4 text-[#c50000]" /> Откатить приёмку
                    позиции?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Акт №{context.existing.actNumber} будет удалён. Если машина была
                    принята полностью — вернётся в «прибыла».
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onRevert}
                    className="bg-[#c50000] hover:bg-[#c50000]/90"
                  >
                    Откатить
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AcceptedStrip({
  accepted,
  formula,
  note,
}: {
  accepted: number | null;
  formula: string | null;
  note: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#c7f6ea]">
      <div className="flex items-baseline gap-3 bg-[#ddfff7] px-3.5 py-3">
        <span className="self-center font-mono text-[10px] uppercase tracking-wide text-[#1d8e75]">
          Принятый вес
        </span>
        <span className="ml-auto text-[22px] font-semibold leading-none tabular-nums tracking-tight text-[#171717]">
          {accepted != null ? formatWeight(accepted) : "—"}
          <span className="ml-0.5 text-sm font-normal text-[#4d4d4d]">кг</span>
        </span>
      </div>
      {accepted != null && (
        <div className="border-t border-[#c7f6ea] bg-white px-3.5 py-2 font-mono text-[11px] text-[#888888]">
          {formula}
          <span className="ml-1.5 not-italic text-[#1d8e75]">· {note}</span>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  tag,
  children,
}: {
  label: string;
  hint?: string;
  tag?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[7px]">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium tracking-tight text-[#171717]">
          {label}
        </span>
        {hint && (
          <span className="text-[11px] tracking-tight text-[#888888]">{hint}</span>
        )}
        {tag && (
          <span className="ml-auto rounded-full bg-[#eaf2ff] px-[7px] py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#0761d1]">
            {tag}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
