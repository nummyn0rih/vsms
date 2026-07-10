"use client";

import type { FeedShipment, FeedWeek } from "@/server/shipments/feed";
import { filterFeedWeeks } from "@/server/shipments/feed";
import { pluralRu } from "@/server/shipments/format";
import type { ShipmentOptions } from "@/server/shipments/schema";
import { STATUS_STYLE } from "./shipment-status";

type Status = FeedShipment["status"];
const STATUSES: readonly Status[] = ["planned", "sent", "arrived", "accepted"];

// Bottom-sheet фильтров ленты (mobile-1): Статус/Сырьё/Поставщик, live-apply — тап по
// чипу сразу меняет Set в родителе (та же модель, что десктопный FilterCombo, без
// staged-черновика). Счётчик показа — filterFeedWeeks (feed.ts, общий с десктопом).
export function MobileFilterSheet({
  open,
  onClose,
  weeks,
  options,
  supplierSel,
  cultureSel,
  statusSel,
  onToggleSupplier,
  onToggleCulture,
  onToggleStatus,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  weeks: FeedWeek[];
  options: ShipmentOptions;
  supplierSel: Set<number>;
  cultureSel: Set<number>;
  statusSel: Set<Status>;
  onToggleSupplier: (id: number) => void;
  onToggleCulture: (id: number) => void;
  onToggleStatus: (status: Status) => void;
  onReset: () => void;
}) {
  if (!open) return null;

  const matched = filterFeedWeeks(weeks, {
    search: "",
    supplierSel,
    cultureSel,
    statusSel,
    hidePlanned: false,
  }).flatMap((w) => w.days).flatMap((d) => d.shipments).length;

  return (
    <div className="md:hidden">
      <div className="ov-scrim" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <span className="sheet-title">Фильтры</span>
          <button type="button" className="sheet-clear" onClick={onReset}>
            Сбросить
          </button>
        </div>

        <div className="sheet-body">
          <div className="sheet-sec">
            <div className="sheet-sec-lab">Статус</div>
            <div className="opt-chips">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`opt-chip${statusSel.has(s) ? " sel" : ""}`}
                  onClick={() => onToggleStatus(s)}
                >
                  {STATUS_STYLE[s].label}
                </button>
              ))}
            </div>
          </div>

          <div className="sheet-sec">
            <div className="sheet-sec-lab">Сырьё</div>
            <div className="opt-chips">
              {options.cultures.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`opt-chip${cultureSel.has(c.id) ? " sel" : ""}`}
                  onClick={() => onToggleCulture(c.id)}
                >
                  <span className="sq" style={{ backgroundColor: c.color }} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="sheet-sec">
            <div className="sheet-sec-lab">Поставщик</div>
            <div className="opt-chips">
              {options.farmers.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`opt-chip${supplierSel.has(f.id) ? " sel" : ""}`}
                  onClick={() => onToggleSupplier(f.id)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sheet-foot">
          <button type="button" className="abtn ghost" style={{ flex: 1 }} onClick={onReset}>
            Сбросить
          </button>
          <button type="button" className="abtn" style={{ flex: 1.6 }} onClick={onClose}>
            Показать {matched} {pluralRu(matched, "машину", "машины", "машин")}
          </button>
        </div>
      </div>
    </div>
  );
}
