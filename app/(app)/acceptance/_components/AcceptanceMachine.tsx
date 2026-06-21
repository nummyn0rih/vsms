"use client";

import { useSession } from "next-auth/react";

import type { AcceptanceMachine as Machine } from "@/server/acceptance/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import {
  StatusBadge,
  STATUS_STYLE,
} from "@/app/(app)/shipments/_components/shipment-status";
import { formatWeight } from "@/app/(app)/shipments/_components/shipment-actions";
import { DriverModal } from "@/app/(app)/shipments/_components/DriverModal";
import { WeightInput } from "./WeightInput";
import { MarkArrivedButton } from "./AcceptanceActions";
import { ActButton } from "./ActButton";

const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "UTC" });

function monthOf(s: string): number {
  return new Date(`${s}T00:00:00Z`).getUTCMonth();
}

// «{отправление} → {прибытие}» (как в ленте, DESIGN §2): акцент на прибытии.
function TripDates({
  departure,
  arrival,
}: {
  departure: string | null;
  arrival: string | null;
}) {
  if (!departure && !arrival)
    return <span className="text-muted-foreground">—</span>;

  const arrEl = arrival ? (
    <span className="font-semibold tabular-nums text-foreground">
      {dayMonthFmt.format(new Date(`${arrival}T00:00:00Z`))}
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

  if (!departure) return arrEl;

  const sameMonth = arrival != null && monthOf(departure) === monthOf(arrival);
  const depFmt = sameMonth ? dayFmt : dayMonthFmt;
  const depEl = (
    <span className="tabular-nums text-muted-foreground">
      {depFmt.format(new Date(`${departure}T00:00:00Z`))}
    </span>
  );
  if (!arrival) return depEl;

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {depEl}
      <span className="text-[#a1a1a1]">→</span>
      {arrEl}
    </span>
  );
}

export function AcceptanceMachine({ machine }: { machine: Machine }) {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canEdit = role === "operator" || role === "admin";
  const isAdmin = role === "admin";
  const zoneBg = STATUS_STYLE[machine.status].zone;
  const isSent = machine.status === "sent";
  // «Частично принята» — производное (BR-13): ≥1 акт, но не все. Хранимый статус — arrived.
  const isPartial =
    machine.acceptedCount > 0 && machine.acceptedCount < machine.total;

  return (
    <div className="flex overflow-hidden rounded-lg border border-[#ebebeb] bg-card shadow-[0_1px_1px_#00000005,0_2px_2px_#0000000a]">
      {/* Левая зона: статус · даты · довешенность · водитель · действие. */}
      <div
        className="flex w-[330px] shrink-0 flex-col gap-2 border-r border-[#ebebeb] p-3"
        style={{ backgroundColor: zoneBg }}
      >
        <div className="flex items-center gap-2">
          <StatusBadge status={machine.status} />
          <span className="text-[13px] tracking-tight">
            <TripDates
              departure={machine.departureDate}
              arrival={machine.arrivalDate}
            />
          </span>
          {isPartial && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-[#ffefcf] px-1.5 py-0.5 text-xs font-medium tabular-nums text-[#ab570a]">
              Частично принята · {machine.acceptedCount}/{machine.total}
            </span>
          )}
          <span
            className={`${isPartial ? "" : "ml-auto"} rounded border border-[#0000000f] bg-white/60 px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground`}
          >
            {machine.weighed}/{machine.total} взвешено
          </span>
        </div>

        {machine.driverName ? (
          <DriverModal
            driverName={machine.driverName}
            transportCompanyName={machine.transportCompanyName}
            phone={machine.driverPhone}
            info={machine.driverInfo}
          />
        ) : (
          <span className="text-[13px] italic text-muted-foreground">
            водитель не назначен
          </span>
        )}

        {machine.comment && (
          <p className="border-t border-dashed border-[#a1a1a166] pt-1.5 text-xs leading-tight text-muted-foreground">
            {machine.comment}
          </p>
        )}

        {/* Действие машины: только «Отметить прибытие» у sent. Приёмка позиционная
            (BR-13/26) — «Акт» живёт в строке позиции, не на машине. */}
        {isSent && (
          <RoleGate allow={["operator", "admin"]}>
            <div className="mt-auto flex items-center gap-2 pt-1">
              <MarkArrivedButton shipmentId={machine.id} code={machine.code} />
            </div>
          </RoleGate>
        )}
      </div>

      {/* Правая зона: строки позиций делят высоту поровну. «Акт» — на позиции у
          arrived+ (зона 2). */}
      <div className="flex min-w-0 flex-1 flex-col">
        {machine.items.map((it) => (
          <div
            key={it.id}
            className="grid flex-1 items-center gap-3 border-t border-[#ebebeb] px-4 py-2 first:border-t-0"
            style={{
              gridTemplateColumns:
                "minmax(150px,1.4fr) minmax(160px,1.5fr) 120px 130px 70px",
              backgroundColor: `color-mix(in srgb, ${it.color} 9%, #fff)`,
            }}
          >
            <span className="flex items-center gap-2 truncate text-sm font-medium">
              <span
                className="inline-block size-[9px] shrink-0 rounded-[2px]"
                style={{ backgroundColor: it.color }}
              />
              <span className="truncate">{it.cultureName}</span>
            </span>
            <span className="truncate text-[13px]">{it.farmerName}</span>
            <span className="text-right text-sm tabular-nums text-muted-foreground">
              {formatWeight(it.plannedKg)}
              <span className="ml-0.5 text-xs">кг</span>
            </span>
            <span className="flex items-center justify-end">
              <WeightInput
                shipmentItemId={it.id}
                savedValue={it.actualKg}
                disabled={!canEdit}
              />
            </span>
            <span className="flex justify-end">
              <ActButton
                shipmentItemId={it.id}
                machineId={machine.id}
                machineStatus={machine.status}
                accepted={it.accepted}
                actNumber={it.actNumber}
                canEdit={canEdit}
                isAdmin={isAdmin}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
