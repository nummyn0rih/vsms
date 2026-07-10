"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, Phone, RotateCcw, User } from "lucide-react";

import type { AcceptedMachine as Machine } from "@/server/acceptance/schema";
import { revertAct } from "@/server/acceptance/act";
import { normalizePhone } from "@/lib/validators";
import { TripDates } from "@/app/(app)/shipments/_components/MachineRow";
import { formatWeight } from "@/app/(app)/shipments/_components/shipment-actions";
import { STATUS_STYLE } from "@/app/(app)/shipments/_components/shipment-status";

function kg(n: number): string {
  return formatWeight(Math.round(n));
}

// Кнопка отката акта позиции (admin). Тот же вызов, что десктопный RollbackButton
// (AcceptedMachine.tsx) — revertAct → router.refresh().
function RollbackButton({ shipmentItemId }: { shipmentItemId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    const res = await revertAct({ shipmentItemId });
    setBusy(false);
    if (res.ok) {
      toast.success("Акт откатан · машина вернулась на приёмку");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mt-2 flex h-11 w-full items-center justify-center gap-1.5 rounded-md border border-[#ebebeb] bg-white text-[13px] font-medium tracking-tight text-[#4d4d4d] disabled:opacity-60"
    >
      <RotateCcw className="size-3.5" /> Откатить акт
    </button>
  );
}

function Position({ pos, isAdmin }: { pos: Machine["positions"][number]; isAdmin: boolean }) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-[#ebebeb]"
      style={{ backgroundColor: `color-mix(in srgb, ${pos.color} 9%, #fff)` }}
    >
      <div className="flex items-start gap-3 px-3.5 pb-2 pt-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-2 text-[14.5px] font-semibold tracking-tight text-[#171717]">
            <span className="inline-block size-[10px] shrink-0 rounded-[3px]" style={{ backgroundColor: pos.color }} />
            {pos.cultureName}
          </span>
          <span className="pl-[18px] text-[12.5px] text-muted-foreground">{pos.farmerName}</span>
        </div>
        {pos.actNumber && (
          <span className="ml-auto whitespace-nowrap rounded-[5px] border border-[#ebebeb] bg-white px-1.5 py-1 font-mono text-xs text-[#171717]">
            № {pos.actNumber}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 pt-0.5 text-[13px] tracking-tight">
        <span className="text-muted-foreground">факт <b className="font-medium tabular-nums text-[#171717]">{kg(pos.actualKg)}</b> кг</span>
        <span className="text-[#a1a1a1]">·</span>
        <span className="text-muted-foreground">брак <b className="font-medium tabular-nums text-[#171717]">{pos.brakPercent}</b> %</span>
        <span className="text-[#a1a1a1]">·</span>
        <span className="font-semibold tabular-nums text-[#1d8e75]">к оплате {kg(pos.acceptedKg)} кг</span>
      </div>

      {pos.calibres.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3.5 pb-0.5 pt-2.5">
          {pos.calibres.map((c, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-[11.5px] ${
                c.isAccepted ? "border-[#ebebeb]" : "border-dashed border-[#a1a1a1]"
              }`}
            >
              <span className="font-medium tabular-nums text-[#171717]">{c.label}</span>
              <span className="tabular-nums text-[#4d4d4d]">{c.percent}%</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2 border-t border-[#ebebeb] bg-white px-3.5 py-2.5">
        <div className="min-w-0 flex-1 text-[12.5px] tracking-tight text-muted-foreground">
          {pos.lineLabel ? (
            <span className="truncate font-medium text-[#171717]">{pos.lineLabel}</span>
          ) : (
            <span className="italic">строка не привязана</span>
          )}
        </div>
        <span className="text-base font-semibold tabular-nums tracking-tight text-[#171717]">
          {kg(pos.costRub)}<span className="ml-0.5 text-xs font-normal text-[#4d4d4d]">₽</span>
        </span>
      </div>

      {isAdmin && (
        <div className="border-t border-[#ebebeb] bg-white px-3.5 py-2.5">
          <RollbackButton shipmentItemId={pos.id} />
        </div>
      )}
    </div>
  );
}

// Мобильная карточка зоны 3 «Принято» — свёрнутый аккордеон (та же логика, что
// десктопная AcceptedMachine.tsx), позиции read-only + откат акта (admin).
export function MobileAcceptedCard({ machine, isAdmin }: { machine: Machine; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <article className="acard">
      <div
        className="acard-head"
        style={{ backgroundColor: STATUS_STYLE.accepted.zone, cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="acard-top">
          <span
            className="badge"
            style={{ background: STATUS_STYLE.accepted.bg, color: STATUS_STYLE.accepted.color }}
          >
            <span className="dot" style={{ background: STATUS_STYLE.accepted.dot }} />
            Принята
          </span>
          <span className="acard-dates">
            <TripDates departure={machine.departureDate} arrival={machine.arrivalDate} />
          </span>
        </div>

        <div className="acard-drv">
          {machine.driverName ? (
            <span className="di">
              <User />
              {machine.driverName}
              {machine.transportCompanyName && <span className="tk"> · {machine.transportCompanyName}</span>}
            </span>
          ) : (
            <span className="di" style={{ color: "var(--mute)", fontStyle: "italic" }}>
              водитель не назначен
            </span>
          )}
          {machine.driverPhone && (
            <a
              className="call-mini"
              href={`tel:${normalizePhone(machine.driverPhone)}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Phone />
            </a>
          )}
        </div>

        <span className="acard-progress">
          <Check className="size-3.5" style={{ color: STATUS_STYLE.accepted.color }} />
          принято <span className="pn">{machine.acceptedCount}&#8202;/&#8202;{machine.total}</span>
          <span style={{ marginLeft: "auto", fontWeight: 600, color: "#171717" }}>
            {kg(machine.machineSumRub)} ₽
          </span>
          <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </div>

      {open && (
        <div className="flex flex-col gap-2.5 border-t border-[#ebebeb] bg-[#fafafa] p-3">
          {machine.positions.map((pos) => (
            <Position key={pos.id} pos={pos} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </article>
  );
}
