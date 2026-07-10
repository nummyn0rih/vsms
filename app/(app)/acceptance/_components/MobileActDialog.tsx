"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, Check, AlertCircle, RotateCcw } from "lucide-react";

import type { ActContext, ActCalibreRange } from "@/server/acceptance/schema";
import { setActualWeight } from "@/server/acceptance/actions";
import { saveAct, revertAct } from "@/server/acceptance/act";
import { formatWeight } from "@/app/(app)/shipments/_components/shipment-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

// Radix Select не допускает value="" — сентинел для «— не в зачёт».
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

function rangeText(r: ActCalibreRange): string | null {
  const min = r.minCm != null ? Number(r.minCm) : null;
  const max = r.maxCm != null ? Number(r.maxCm) : null;
  if (min != null && max != null) return `${min}–${max} см`;
  if (min != null) return `>${min} см`;
  if (max != null) return `<${max} см`;
  return null;
}

// Мобильный (полноэкранный) вариант AcceptanceActDialog.tsx. Дублирует derived-state/
// handlers-блок 1:1 (те же server actions setActualWeight/saveAct/revertAct, та же
// валидация BR-7/8/9/10/13/25) — отличается только разметкой (.actsheet, fixed inset-0).
// Дата прибытия — READ-ONLY (см. план mobile-2): saveAct её не принимает, правка —
// только через отдельный переход «Отметить прибытие» (BR-24).
export function MobileActDialog({
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

  const [lineId, setLineId] = useState<string>(
    context.existing?.contractLineId != null
      ? String(context.existing.contractLineId)
      : context.autoLineId != null
        ? String(context.autoLineId)
        : "",
  );

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

  const pctNum = (id: number) => {
    const n = Number((percents[id] ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
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

  if (!open) return null;

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
        <SelectTrigger className="h-11 w-full text-[13px]">
          <SelectValue placeholder={r.isAccepted ? "выберите" : "не в зачёт"} />
        </SelectTrigger>
        <SelectContent>
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

  return (
    <div className="actsheet">
      <div className="actsheet-bar">
        <button type="button" className="icon-btn" onClick={() => onOpenChange(false)}>
          <X />
        </button>
        <span className="title">Акт приёмки</span>
      </div>

      <div className="actsheet-body">
        <div className="act-cult">
          <span className="sq" style={{ backgroundColor: context.cultureColor }} />
          {context.cultureName}
        </div>
        <div className="act-sub">
          {context.farmerName}
          {machineLine ? ` · ${machineLine}` : ""}
        </div>

        {openedFromSent && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-[#cfe1ff] bg-[#eaf2ff] px-3 py-2.5 text-[12.5px] leading-[17px] tracking-tight text-[#0761d1]">
            Машина отмечена <b className="font-semibold">прибывшей</b> — приёмка с этой
            позиции (sent → arrived).
          </div>
        )}

        <div className="act-block">
          <div className="act-block-lab">Перевеска</div>
          <div className="act-field">
            <div className="act-field-lab">№ акта</div>
            <div className="act-input">
              <input
                value={actNumber}
                onChange={(e) => setActNumber(e.target.value)}
                placeholder="не задан"
              />
            </div>
          </div>
          <div className="act-field">
            <div className="act-field-lab">Факт. вес</div>
            <div className="act-input">
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
              />
              <span className="u">кг</span>
            </div>
          </div>
          {!isCalibre && (
            <div className="act-field">
              <div className="act-field-lab">Брак, %</div>
              <div className="act-input">
                <input
                  inputMode="decimal"
                  value={brakStr}
                  onChange={(e) => setBrakStr(e.target.value)}
                  placeholder="0"
                />
                <span className="u">%</span>
              </div>
            </div>
          )}
        </div>

        {isCalibre ? (
          <div className="act-block">
            <div className="act-block-lab">Категории (% от факта)</div>
            <div className="flex flex-col gap-2.5">
              {context.calibreRanges.map((r) => {
                const rt = rangeText(r);
                const kg =
                  savedWeight != null
                    ? Math.round((savedWeight * pctNum(r.id)) / 100)
                    : null;
                return (
                  <div
                    key={r.id}
                    className="rounded-lg border border-[#ebebeb] p-3"
                  >
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <span className="text-[13.5px] font-medium tabular-nums text-[#171717]">
                        {rt ?? r.label}
                      </span>
                      <span className="text-[12px] tabular-nums text-[#888888]">
                        {kg != null ? `${formatWeight(kg)} кг` : "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="act-input h-11 flex-1">
                        <input
                          inputMode="decimal"
                          value={percents[r.id] ?? ""}
                          onChange={(e) =>
                            setPercents((p) => ({ ...p, [r.id]: e.target.value }))
                          }
                          placeholder="0"
                        />
                        <span className="u">%</span>
                      </div>
                      <div className="flex-[1.4]">{bindingSelect(r)}</div>
                    </div>
                  </div>
                );
              })}
              <div className="rounded-lg border border-[#ebebeb] p-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-medium text-[#171717]">Брак</span>
                  <span className="text-[12px] tabular-nums text-[#888888]">
                    {savedWeight != null
                      ? `${formatWeight(Math.round((savedWeight * brak) / 100))} кг`
                      : "—"}
                  </span>
                </div>
                <div className="act-input h-11">
                  <input
                    inputMode="decimal"
                    value={brakStr}
                    onChange={(e) => setBrakStr(e.target.value)}
                    placeholder="0"
                  />
                  <span className="u">%</span>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-[#fafafa] px-3 py-2.5">
                <span className="text-[12.5px] font-medium text-[#171717]">Σ</span>
                <span className="text-[11px] text-[#888888]">= 100% факта</span>
                <span
                  className={`ml-auto inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums ${
                    sumOk ? "text-[#1d8e75]" : "text-[#c50000]"
                  }`}
                >
                  {sumOk ? <Check className="size-3.5" /> : <AlertCircle className="size-3.5" />}
                  {(sumPct + brak).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%
                </span>
              </div>
            </div>

            {nonAcceptedKg != null && sumPct - acceptedPct > 0 && (
              <div className="mt-2.5 flex items-center gap-2.5 rounded-md border border-dashed border-[#a1a1a1] px-3 py-2.5">
                <span className="text-[12.5px] text-[#4d4d4d]">Нестандарт</span>
                <span className="ml-auto text-sm font-semibold tabular-nums text-[#171717]">
                  {formatWeight(Math.round(nonAcceptedKg))} кг
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="act-block">
            <div className="act-block-lab">Строка контракта</div>
            {context.autoLineId != null ? (
              <div className="act-input readonly">
                <span className="truncate">
                  {priceLabel(context.contractLines[0], context.cultureName)}
                </span>
                <span className="u">авто</span>
              </div>
            ) : (
              <Select value={lineId} onValueChange={setLineId}>
                <SelectTrigger className="h-[52px] w-full text-[15px]">
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
          </div>
        )}

        <div className="act-block">
          <div className="act-block-lab">Дата прибытия</div>
          <div className="act-input readonly">
            <span>
              {context.arrivalDate
                ? dayMonthFmt.format(new Date(`${context.arrivalDate}T00:00:00Z`))
                : "не указана"}
            </span>
          </div>
        </div>

        <div className="act-block">
          <div className="act-block-lab">Принятый вес</div>
          <div className="act-line total">
            <span className="k">К оплате пойдёт</span>
            <span className="v">
              {accepted != null ? `${formatWeight(accepted)} кг` : "—"}
            </span>
          </div>
        </div>

        {context.isLastUnaccepted && !context.existing && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-[#c7f6ea] bg-[#ddfff7] px-3 py-2 text-xs leading-4 tracking-tight text-[#1d8e75]">
            <Check className="size-3.5 shrink-0" />
            Последняя непринятая позиция — машина будет принята полностью.
          </div>
        )}

        {isAdmin && context.existing && (
          <div className="mt-4 border-t border-[#ebebeb] pt-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="inline-flex items-center gap-1.5 text-xs font-medium text-[#888888]">
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
      </div>

      <div className="actsheet-foot">
        <button type="button" className="abtn ghost" onClick={() => onOpenChange(false)}>
          Отмена
        </button>
        <button
          type="button"
          className="abtn"
          onClick={onSubmit}
          disabled={blockReason != null || submitting}
        >
          <Check className="size-[17px]" /> Принять позицию
        </button>
      </div>
    </div>
  );
}
