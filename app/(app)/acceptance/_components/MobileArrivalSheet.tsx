"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";

import { markArrived } from "@/server/acceptance/actions";
import { arrivalDateDefault } from "@/server/acceptance/accepted";

const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
function fmtDate(iso: string): string {
  return dayMonthFmt.format(new Date(`${iso}T00:00:00Z`));
}

// Bottom-sheet выбора даты прибытия (BR-24б, мобиле). Тот же смарт-дефолт/вызов
// markArrived, что десктопная MarkArrivedButton (AcceptanceActions.tsx) — общий
// хелпер arrivalDateDefault, без дублирования расчёта.
export function MobileArrivalSheet({
  open,
  onClose,
  shipmentId,
  code,
  arrivalDate,
}: {
  open: boolean;
  onClose: () => void;
  shipmentId: number;
  code: string;
  arrivalDate?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { today, planned, defaultChoice } = arrivalDateDefault(arrivalDate ?? null);
  const [choice, setChoice] = useState<"planned" | "today">(defaultChoice);

  if (!open) return null;

  async function confirm() {
    const chosen = choice === "planned" && planned ? planned : today;
    setBusy(true);
    const res = await markArrived({ shipmentId, arrivalDate: chosen });
    setBusy(false);
    if (res.ok) {
      toast.success(`Машина №${code} прибыла`);
      onClose();
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="md:hidden">
      <div className="ov-scrim" onClick={() => !busy && onClose()} />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <span className="sheet-title">Дата прибытия · №{code}</span>
        </div>

        <div className="sheet-body flex flex-col gap-2">
          {planned != null && (
            <button
              type="button"
              onClick={() => setChoice("planned")}
              disabled={busy}
              className={`flex h-14 items-center justify-between rounded-xl border px-4 text-left text-[15px] font-medium tracking-tight ${
                choice === "planned"
                  ? "border-[#171717] bg-[#f5f5f5] text-[#171717]"
                  : "border-[#ebebeb] bg-white text-[#4d4d4d]"
              }`}
            >
              Дата из отгрузки: {fmtDate(planned)}
              {choice === "planned" && <Check className="size-4 shrink-0" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setChoice("today")}
            disabled={busy}
            className={`flex h-14 items-center justify-between rounded-xl border px-4 text-left text-[15px] font-medium tracking-tight ${
              choice === "today"
                ? "border-[#171717] bg-[#f5f5f5] text-[#171717]"
                : "border-[#ebebeb] bg-white text-[#4d4d4d]"
            }`}
          >
            Сегодня: {fmtDate(today)}
            {choice === "today" && <Check className="size-4 shrink-0" />}
          </button>
        </div>

        <div className="sheet-foot">
          <button type="button" className="abtn ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="abtn" onClick={confirm} disabled={busy}>
            Отметить прибытие
          </button>
        </div>
      </div>
    </div>
  );
}
