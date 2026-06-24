"use client";

import { FlaskConical } from "lucide-react";

import type { MaterialTrip } from "@/server/materials/feed";
import { totalsByType, ingredientTotals } from "@/server/materials/feed";
import type { MaterialOptions } from "@/server/materials/schema";
import { INGREDIENT_UNIT_LABELS } from "@/server/ingredients/schema";
import { positionsWord } from "@/server/shipments/format";
import { RoleGate } from "@/components/auth/RoleGate";
import { DriverModal } from "@/app/(app)/shipments/_components/DriverModal";
import { StatusBadge, STATUS_STYLE } from "./material-status";
import { MaterialTareIcon } from "./MaterialTareIcon";
import {
  EditMaterialButton,
  DeleteMaterialButton,
  SendMaterialButton,
  ArriveMaterialButton,
  RevertToPlannedButton,
  RevertToSentButton,
} from "./material-actions";

const nf = new Intl.NumberFormat("ru-RU");
// Ингредиенты — Decimal (kg/l), нужны дробные знаки; тара — целое (nf).
const nfDec = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "UTC" });

function monthOf(s: string): number {
  return new Date(`${s}T00:00:00Z`).getUTCMonth();
}

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// «{отправление} → {прибытие}»: если месяц совпадает — у отправления только день.
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
  const depEl = (
    <span className="tabular-nums text-muted-foreground">
      {(sameMonth ? dayFmt : dayMonthFmt).format(new Date(`${departure}T00:00:00Z`))}
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

export function MaterialTripCard({
  trip,
  options,
}: {
  trip: MaterialTrip;
  options: MaterialOptions;
}) {
  const zoneBg = STATUS_STYLE[trip.status].zone;
  const isPlanned = trip.status === "planned";
  const isSent = trip.status === "sent";
  const isArrived = trip.status === "arrived";
  const totals = totalsByType(trip.items);
  const ingTotals = ingredientTotals(trip.items);

  return (
    <div className="flex overflow-hidden rounded-lg border border-[#ebebeb] bg-card shadow-[0_1px_1px_#00000005,0_2px_2px_#0000000a]">
      {/* Левая зона: фон по статусу. */}
      <div
        className="flex w-[280px] shrink-0 flex-col gap-2 border-r border-[#ebebeb] p-3"
        style={{ backgroundColor: zoneBg }}
      >
        <div className="flex items-center gap-2">
          <StatusBadge status={trip.status} />
          <span className="text-[13px] tracking-tight">
            <TripDates departure={trip.departureDate} arrival={trip.arrivalDate} />
          </span>
          <RoleGate allow={["admin"]}>
            <div className="ml-auto flex items-center gap-0.5">
              <EditMaterialButton id={trip.id} options={options} />
              {isPlanned && <DeleteMaterialButton id={trip.id} code={trip.code} />}
            </div>
          </RoleGate>
        </div>

        {trip.driverName ? (
          <DriverModal
            driverName={trip.driverName}
            transportCompanyName={trip.transportCompanyName}
            phone={trip.driverPhone}
            info={trip.driverInfo}
          />
        ) : (
          <span className="text-[13px] italic text-muted-foreground">
            водитель не назначен
          </span>
        )}
      </div>

      {/* Правая зона: позиции + футер. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1">
          {trip.items.map((it) => {
            const isIngredient = it.itemKind === "ingredient";
            const unit = isIngredient
              ? it.ingredientUnit
                ? INGREDIENT_UNIT_LABELS[it.ingredientUnit]
                : "ед."
              : "шт";
            return (
              <div
                key={it.id}
                className="grid items-center gap-3 border-t border-[#ebebeb] px-4 py-2.5 first:border-t-0"
                style={{ gridTemplateColumns: "minmax(140px,1.5fr) minmax(150px,1.4fr) 104px" }}
              >
                <span className="truncate text-sm font-medium">{it.farmerName}</span>
                <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
                  {isIngredient ? (
                    <FlaskConical className="size-[15px] shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <MaterialTareIcon kind={it.packagingKind} />
                  )}
                  <span className="truncate">
                    {isIngredient
                      ? lcFirst(it.ingredientName ?? "ингредиент")
                      : lcFirst(it.packagingTypeName ?? "тара")}
                    {!isIngredient && it.capacityKg != null && (
                      <span className="text-muted-foreground"> · {nf.format(it.capacityKg)} кг</span>
                    )}
                  </span>
                </span>
                <span className="text-right text-sm font-semibold tabular-nums">
                  {(isIngredient ? nfDec : nf).format(it.quantity)}
                  <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>
                </span>
              </div>
            );
          })}
        </div>

        {/* Футер: счётчик позиций + итоги по типам (динамически) + действия. */}
        <div className="flex items-center gap-2.5 border-t border-[#ebebeb] bg-[#fafafa] px-4 py-2">
          <span className="text-xs tracking-tight text-muted-foreground">
            <b className="font-semibold text-[#4d4d4d]">{trip.items.length}</b>{" "}
            {positionsWord(trip.items.length)}
            {totals.map((t) => (
              <span key={t.packagingTypeId}>
                {" · "}
                <b className="font-semibold tabular-nums text-[#4d4d4d]">{nf.format(t.qty)}</b>{" "}
                {lcFirst(t.name)}
              </span>
            ))}
            {ingTotals.map((g) => (
              <span key={g.ingredientId}>
                {" · "}
                <b className="font-semibold tabular-nums text-[#4d4d4d]">{nfDec.format(g.qty)}</b>{" "}
                {lcFirst(g.name)}
              </span>
            ))}
          </span>
          <span className="flex-1" />
          {isPlanned && (
            <RoleGate allow={["admin"]}>
              <SendMaterialButton id={trip.id} code={trip.code} />
            </RoleGate>
          )}
          {isSent && (
            <>
              <RoleGate allow={["admin"]}>
                <RevertToPlannedButton id={trip.id} code={trip.code} />
              </RoleGate>
              <RoleGate allow={["admin", "operator"]}>
                <ArriveMaterialButton id={trip.id} code={trip.code} />
              </RoleGate>
            </>
          )}
          {isArrived && (
            <RoleGate allow={["admin"]}>
              <RevertToSentButton id={trip.id} code={trip.code} />
            </RoleGate>
          )}
        </div>
      </div>
    </div>
  );
}
