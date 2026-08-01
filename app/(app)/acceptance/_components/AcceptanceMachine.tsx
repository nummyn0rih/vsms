"use client";

import type { AcceptanceMachine as Machine } from "@/server/acceptance/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { useRole } from "@/components/auth/RoleProvider";
import {
  StatusBadge,
  STATUS_STYLE,
} from "@/app/(app)/shipments/_components/shipment-status";
import { formatWeight } from "@/app/(app)/shipments/_components/shipment-actions";
import { DriverModal } from "@/app/(app)/shipments/_components/DriverModal";
import { LEFT_ZONE_CLS } from "./card-layout";
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

export function AcceptanceMachine({
  machine,
  onOpenAct,
  pendingId,
}: {
  machine: Machine;
  onOpenAct: (
    itemId: number,
    machineId: number,
    machineStatus: "sent" | "arrived",
  ) => void;
  pendingId: number | null;
}) {
  const role = useRole();
  const canEdit = role === "operator" || role === "admin";
  const zoneBg = STATUS_STYLE[machine.status].zone;
  const isSent = machine.status === "sent";

  return (
    <div className="flex overflow-hidden rounded-lg border border-[#ebebeb] bg-card shadow-[0_1px_1px_#00000005,0_2px_2px_#0000000a]">
      {/* Левая зона: статус · даты · довешенность · водитель · действие. */}
      <div
        className={`flex ${LEFT_ZONE_CLS} flex-col gap-2 border-r border-[#ebebeb] p-3`}
        style={{ backgroundColor: zoneBg }}
      >
        {/* Заголовок НЕ переносится (без flex-wrap): иначе пара чипов уезжала на вторую
            строку целиком и висела там. Сжимается блок чипов — см. ниже. */}
        <div className="flex items-start gap-x-2">
          <StatusBadge status={machine.status} />
          <span className="shrink-0 text-[13px] leading-[22px] tracking-tight">
            <TripDates
              departure={machine.departureDate}
              arrival={machine.arrivalDate}
            />
          </span>
          {/* Бейджи «взвешено»/«принято» — у ПРАВОГО края. Собственный flex-wrap плюс
              min-w-0: не хватает места на пару в ряд → чипы складываются СТОЛБИКОМ,
              выровненные по правому краю, а не уезжают вдвоём на вторую строку.
              При одном чипе строка одна — высота карточки не меняется. */}
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
            <span className="whitespace-nowrap rounded border border-[#0000000f] bg-white/60 px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
              взвешено · {machine.weighed}/{machine.total}
            </span>
            {machine.acceptedCount > 0 && (
              <span className="inline-flex whitespace-nowrap items-center rounded-md bg-[#c7f6ea] px-1.5 py-0.5 text-xs font-medium tabular-nums text-[#1d8e75]">
                принято · {machine.acceptedCount}/{machine.total}
              </span>
            )}
          </div>
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
              <MarkArrivedButton
                shipmentId={machine.id}
                code={machine.code}
                arrivalDate={machine.arrivalDate}
              />
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
              // Последняя колонка — кнопка «Акт»: с № акта внутри ей нужно больше 110px,
              // иначе длинный номер упирается в край карточки.
              gridTemplateColumns:
                "minmax(150px,1.4fr) minmax(160px,1.5fr) 120px 130px 148px",
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
                locked={it.accepted}
              />
            </span>
            <span className="flex min-w-0 items-center justify-end">
              <ActButton
                shipmentItemId={it.id}
                machineId={machine.id}
                machineStatus={machine.status}
                accepted={it.accepted}
                actNumber={it.actNumber}
                canEdit={canEdit}
                pending={pendingId === it.id}
                onOpenAct={onOpenAct}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
