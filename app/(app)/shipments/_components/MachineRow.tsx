"use client";

import type { FeedShipment } from "@/server/shipments/feed";
import type { ShipmentOptions } from "@/server/shipments/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { StatusBadge, STATUS_STYLE } from "./shipment-status";
import {
  EditShipmentButton,
  SendShipmentButton,
  RevertShipmentButton,
  DeleteShipmentButton,
  formatWeight,
} from "./shipment-actions";
import { DriverModal } from "./DriverModal";

const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const dayFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  timeZone: "UTC",
});

function monthOf(s: string): number {
  return new Date(`${s}T00:00:00Z`).getUTCMonth();
}

// «{отправление} → {прибытие}»: полные месяцы; если месяц совпадает — у отправления
// только день, у прибытия «день месяц». Акцент (weight 600) на прибытии (DESIGN §2).
function TripDates({
  departure,
  arrival,
}: {
  departure: string | null;
  arrival: string | null;
}) {
  if (!departure && !arrival) return <span className="text-muted-foreground">—</span>;

  const arrEl = arrival ? (
    <span className="font-semibold tabular-nums">
      {dayMonthFmt.format(new Date(`${arrival}T00:00:00Z`))}
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

  if (!departure) return arrEl;

  const sameMonth = arrival != null && monthOf(departure) === monthOf(arrival);
  const depFmt = sameMonth ? dayFmt : dayMonthFmt;
  const depEl = (
    <span className="tabular-nums">
      {depFmt.format(new Date(`${departure}T00:00:00Z`))}
    </span>
  );

  if (!arrival) return depEl;

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {depEl}
      <span className="text-muted-foreground">→</span>
      {arrEl}
    </span>
  );
}

// № акта по статусу. Реальный номер появится на этапе C (приёмка); сейчас —
// плейсхолдер по статусу.
function ActCell({ status }: { status: FeedShipment["status"] }) {
  if (status === "accepted") {
    return (
      <span className="rounded border px-1.5 py-0.5 font-mono text-xs text-foreground">
        принят
      </span>
    );
  }
  const text = status === "planned" ? "— не отправлена" : "— приёмка";
  return <span className="text-xs text-muted-foreground">{text}</span>;
}

export function MachineRow({
  shipment,
  options,
}: {
  shipment: FeedShipment;
  options: ShipmentOptions;
}) {
  const zoneBg = STATUS_STYLE[shipment.status].zone;
  const canRevert = shipment.status === "sent";
  const isPlanned = shipment.status === "planned";

  return (
    <div className="flex overflow-hidden rounded-lg border border-[#ebebeb] bg-card shadow-[0_1px_1px_#00000005,0_2px_2px_#0000000a]">
      {/* Левая зона: фон по статусу, фикс. ширина под «30 сентября → 2 октября». */}
      <div
        className="flex w-[330px] shrink-0 flex-col gap-2 border-r border-[#ebebeb] p-3"
        style={{ backgroundColor: zoneBg }}
      >
        {/* Строка 1: статус · даты · группа иконок-действий по статусу (admin). */}
        <div className="flex items-center gap-2">
          <StatusBadge status={shipment.status} />
          <span className="text-[13px] tracking-tight">
            <TripDates
              departure={shipment.departureDate}
              arrival={shipment.arrivalDate}
            />
          </span>
          <RoleGate allow={["admin"]}>
            <div className="ml-auto flex items-center gap-0.5">
              <EditShipmentButton id={shipment.id} options={options} />
              {isPlanned && (
                <>
                  <DeleteShipmentButton id={shipment.id} code={shipment.code} />
                  <SendShipmentButton id={shipment.id} code={shipment.code} />
                </>
              )}
              {canRevert && (
                <RevertShipmentButton id={shipment.id} code={shipment.code} />
              )}
            </div>
          </RoleGate>
        </div>

        {/* Строка 2: только водитель. */}
        {shipment.driverName ? (
          <DriverModal
            driverName={shipment.driverName}
            transportCompanyName={shipment.transportCompanyName}
            phone={shipment.driverPhone}
            info={shipment.driverInfo}
          />
        ) : (
          <span className="text-[13px] italic text-muted-foreground">
            водитель не назначен
          </span>
        )}

        {/* Строка 3: комментарий под пунктирным разделителем. */}
        {shipment.comment && (
          <p className="border-t border-dashed border-[#a1a1a166] pt-1.5 text-xs leading-tight text-muted-foreground">
            {shipment.comment}
          </p>
        )}
      </div>

      {/* Правая зона: строки позиций делят высоту поровну. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {shipment.items.map((it) => (
          <div
            key={it.id}
            className="grid flex-1 items-center gap-3 border-t border-[#ebebeb] px-4 py-2 first:border-t-0"
            style={{
              gridTemplateColumns:
                "minmax(150px,1.4fr) 110px minmax(160px,1.5fr) 150px minmax(110px,0.9fr)",
              backgroundColor: `color-mix(in srgb, ${it.color} 9%, #fff)`,
            }}
          >
            <span className="flex items-center gap-2 truncate text-sm">
              <span
                className="inline-block size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: it.color }}
              />
              <span className="truncate">{it.cultureName}</span>
            </span>
            <span className="text-sm tabular-nums">
              {formatWeight(it.plannedKg)}{" "}
              <span className="text-muted-foreground">кг</span>
            </span>
            <span className="truncate text-sm">{it.farmerName}</span>
            <span className="text-sm text-muted-foreground">
              {it.tareUnits != null && it.packagingTypeName ? (
                <>
                  {it.packagingTypeName} ·{" "}
                  <span className="tabular-nums text-foreground">{it.tareUnits}</span> шт
                </>
              ) : it.tareMissingNorm ? (
                <span title="Нет нормы тары">?</span>
              ) : (
                ""
              )}
            </span>
            <ActCell status={shipment.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
