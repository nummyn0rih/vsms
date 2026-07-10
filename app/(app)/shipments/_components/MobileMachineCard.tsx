"use client";

import { Phone, User } from "lucide-react";

import type { FeedShipment } from "@/server/shipments/feed";
import { normalizePhone, formatPhone } from "@/lib/validators";
import { StatusBadge, STATUS_STYLE } from "./shipment-status";
import { TripDates, ActCell, lcFirst } from "./MachineRow";
import { formatWeight } from "./shipment-actions";

// Карточка машины (mobile-1, read-only): та же лента, что десктоп (MachineRow), но
// карточная раскладка по прототипу mobile-v1.html. Никаких кнопок правки/статуса —
// водитель звонит напрямую (tel:), без модалки (в отличие от десктопной DriverModal).
export function MobileMachineCard({ shipment }: { shipment: FeedShipment }) {
  const zoneBg = STATUS_STYLE[shipment.status].zone;
  const isPlanned = shipment.status === "planned";

  return (
    <article className="mship-card">
      <div className="mcard-strip" style={{ backgroundColor: zoneBg }}>
        <StatusBadge status={shipment.status} />
        <span className="mcard-dates">
          <TripDates departure={shipment.departureDate} arrival={shipment.arrivalDate} />
        </span>
      </div>

      {shipment.items.map((it) => (
        <div key={it.id} className="mpos">
          <div className="mpos-main">
            <span className="mpos-cult">
              <span className="sq" style={{ backgroundColor: it.color }} />
              {it.cultureName}
            </span>
            <span className="mpos-sub">
              {it.farmerName}
              {it.tareUnits != null && it.packagingTypeName ? (
                <>
                  {" · "}
                  {lcFirst(it.packagingTypeName)}{" "}
                  <span className="tc">
                    {isPlanned ? "≈" : ""}
                    {it.tareUnits} шт
                  </span>
                </>
              ) : it.tareMissingNorm ? (
                <span title="Нет нормы тары"> · ?</span>
              ) : null}
            </span>
          </div>
          <div className="mpos-right">
            <span className="mpos-wt">
              {formatWeight(it.plannedKg)}
              <span className="u">кг</span>
            </span>
            <span className="mpos-act">
              <ActCell status={shipment.status} item={it} />
            </span>
          </div>
        </div>
      ))}

      {shipment.driverName ? (
        <div className="mdriver">
          <span className="mdriver-info">
            <User />
            <span className="mdriver-name">
              {shipment.driverName}
              {shipment.transportCompanyName && (
                <span className="tk"> · {shipment.transportCompanyName}</span>
              )}
            </span>
          </span>
          {shipment.driverPhone && (
            <a className="callbtn" href={`tel:${normalizePhone(shipment.driverPhone)}`}>
              <Phone />
              {formatPhone(shipment.driverPhone)}
            </a>
          )}
        </div>
      ) : (
        <div className="mdriver">
          <span className="mdriver-none">
            <User /> водитель не назначен
          </span>
        </div>
      )}
    </article>
  );
}
