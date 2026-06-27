"use client";

import type { FeedItem, FeedShipment } from "@/server/shipments/feed";
import type { ShipmentOptions } from "@/server/shipments/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { StatusBadge, STATUS_STYLE } from "./shipment-status";
import {
  EditShipmentButton,
  SendShipmentButton,
  RevertShipmentButton,
  RevertToSentButton,
  RevertActButton,
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

// Тип тары в строке выводим со строчной первой буквы («Ящик» → «ящик»).
function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
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

// Статус приёмки ПО ПОЗИЦИИ (BR-13, DESIGN §2), независимо от статуса машины. Числа —
// целые (информативная зона; точные — в статистике). «К оплате» = accepted_weight.
function ActCell({
  status,
  item,
}: {
  status: FeedShipment["status"];
  item: FeedItem;
}) {
  if (status === "planned") {
    return <span className="text-xs text-muted-foreground">— не отправлена</span>;
  }
  if (item.actualKg == null) {
    return <span className="text-xs text-muted-foreground">— приёмка</span>;
  }
  return (
    <span className="whitespace-nowrap text-xs tabular-nums text-foreground">
      факт {formatWeight(Math.round(item.actualKg))}
      <span className="ml-0.5 text-muted-foreground">кг</span>
      {item.accepted && item.acceptedKg != null && (
        <>
          <span className="mx-1 text-muted-foreground">·</span>
          <span className="text-[#1d8e75]">
            к оплате {formatWeight(Math.round(item.acceptedKg))}
            <span className="ml-0.5">кг</span>
          </span>
        </>
      )}
    </span>
  );
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
  const isArrived = shipment.status === "arrived";
  const isAccepted = shipment.status === "accepted";
  // Частичные акты возможны на arrived → откат в sent блокируем, пока есть акт.
  const hasAct = shipment.items.some((i) => i.accepted);

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
                  <SendShipmentButton shipment={shipment} />
                </>
              )}
              {canRevert && <RevertShipmentButton shipment={shipment} />}
              {isArrived && (
                <RevertToSentButton shipment={shipment} blocked={hasAct} />
              )}
              {isAccepted && <RevertActButton shipment={shipment} />}
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
                "minmax(140px,1.2fr) 96px minmax(150px,1.2fr) 128px minmax(184px,1.1fr)",
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
            <span className="text-right text-sm font-medium tabular-nums">
              {formatWeight(it.plannedKg)}
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">кг</span>
            </span>
            <span className="truncate text-[13px]">{it.farmerName}</span>
            <span className="text-[13px] text-muted-foreground">
              {it.tareUnits != null && it.packagingTypeName ? (
                <>
                  {lcFirst(it.packagingTypeName)} ·{" "}
                  <span className="tabular-nums text-foreground">
                    {isPlanned ? "≈" : ""}
                    {it.tareUnits}
                  </span>{" "}
                  шт
                </>
              ) : it.tareMissingNorm ? (
                <span title="Нет нормы тары">?</span>
              ) : (
                ""
              )}
            </span>
            <ActCell status={shipment.status} item={it} />
          </div>
        ))}
      </div>
    </div>
  );
}
