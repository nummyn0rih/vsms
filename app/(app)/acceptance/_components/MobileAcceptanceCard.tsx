"use client";

import { useState } from "react";
import { Phone, User, FileText, Loader2 } from "lucide-react";

import type { AcceptanceMachine as Machine } from "@/server/acceptance/schema";
import { normalizePhone } from "@/lib/validators";
import {
  StatusBadge,
  STATUS_STYLE,
} from "@/app/(app)/shipments/_components/shipment-status";
import { TripDates } from "@/app/(app)/shipments/_components/MachineRow";
import { formatWeight } from "@/app/(app)/shipments/_components/shipment-actions";
import { MobileWeightInput } from "./MobileWeightInput";
import { MobileArrivalSheet } from "./MobileArrivalSheet";

// Мобильная карточка машины (зоны 1/2 — «Ожидают перевески»/«На приёмке»). Позиции
// рендерятся инлайн (как десктопная AcceptanceMachine.tsx, без лишнего дробления файлов).
export function MobileAcceptanceCard({
  machine,
  canEdit,
  pendingId,
  onOpenAct,
}: {
  machine: Machine;
  canEdit: boolean;
  pendingId: number | null;
  onOpenAct: (
    itemId: number,
    machineId: number,
    machineStatus: "sent" | "arrived",
  ) => void;
}) {
  const [arriveOpen, setArriveOpen] = useState(false);
  const isSent = machine.status === "sent";

  return (
    <article className="acard">
      <div className="acard-head" style={{ backgroundColor: STATUS_STYLE[machine.status].zone }}>
        <div className="acard-top">
          <StatusBadge status={machine.status} />
          <span className="acard-dates">
            <TripDates departure={machine.departureDate} arrival={machine.arrivalDate} />
          </span>
        </div>

        <div className="acard-drv">
          {machine.driverName ? (
            <span className="di">
              <User />
              {machine.driverName}
              {machine.transportCompanyName && (
                <span className="tk"> · {machine.transportCompanyName}</span>
              )}
            </span>
          ) : (
            <span className="di" style={{ color: "var(--mute)", fontStyle: "italic" }}>
              водитель не назначен
            </span>
          )}
          {machine.driverPhone && (
            <a className="call-mini" href={`tel:${normalizePhone(machine.driverPhone)}`}>
              <Phone />
            </a>
          )}
        </div>

        <span className="acard-progress">
          взвешено <span className="pn">{machine.weighed}&#8202;/&#8202;{machine.total}</span>
          {machine.acceptedCount > 0 && (
            <>
              {" · "}принято <span className="pn">{machine.acceptedCount}&#8202;/&#8202;{machine.total}</span>
            </>
          )}
        </span>

        {isSent && canEdit && (
          <button type="button" className="abtn arrive" onClick={() => setArriveOpen(true)}>
            Отметить прибытие
          </button>
        )}
      </div>

      {machine.items.map((it) => (
        <div key={it.id} className="apos">
          <div className="apos-cult">
            <span className="sq" style={{ backgroundColor: it.color }} />
            {it.cultureName}
          </div>
          <div className="apos-farmer">
            {it.farmerName} · план <span className="apos-plan">{formatWeight(it.plannedKg)} кг</span>
          </div>

          {it.accepted ? (
            <>
              <div className="apos-done">
                <span className="fact">
                  факт <b>{formatWeight(it.actualKg ?? 0)}</b> кг
                </span>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  className="apos-actchip"
                  onClick={() => onOpenAct(it.id, machine.id, machine.status)}
                >
                  <FileText /> Акт принят
                  {it.actNumber && <span className="no">· {it.actNumber}</span>}
                </button>
              ) : (
                <div className="apos-actchip">
                  <FileText /> Акт принят
                  {it.actNumber && <span className="no">· {it.actNumber}</span>}
                </div>
              )}
            </>
          ) : (
            <>
              <MobileWeightInput
                shipmentItemId={it.id}
                savedValue={it.actualKg}
                disabled={!canEdit}
                locked={false}
              />
              {it.actualKg != null && canEdit && (
                <div className="apos-actbar">
                  <button
                    type="button"
                    className="abtn"
                    disabled={pendingId === it.id}
                    onClick={() => onOpenAct(it.id, machine.id, machine.status)}
                  >
                    {pendingId === it.id ? (
                      <Loader2 className="size-[17px] animate-spin" />
                    ) : (
                      <FileText className="size-[17px]" />
                    )}
                    Оформить акт
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      <MobileArrivalSheet
        open={arriveOpen}
        onClose={() => setArriveOpen(false)}
        shipmentId={machine.id}
        code={machine.code}
        arrivalDate={machine.arrivalDate}
      />
    </article>
  );
}
