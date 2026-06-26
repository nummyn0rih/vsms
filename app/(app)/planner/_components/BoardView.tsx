"use client";

import { useState } from "react";
import { toast } from "sonner";
import { GripVertical, Lock, Plus, Package, Info, AlertCircle } from "lucide-react";

import type { BoardWeek, BoardCard } from "@/server/board/schema";
import type { ShipmentDetail, ShipmentOptions } from "@/server/shipments/schema";
import { getShipment } from "@/server/shipments/actions";
import { formatTareTotals } from "@/server/shipments/format";
import { ShipmentFormDialog } from "@/app/(app)/shipments/_components/ShipmentFormDialog";

// Полка цели бара: 100%-эффективный/риска садятся на 95,2%, оставляя запас под
// перелёт (как в PlanView/прототипе). EPS — допуск сравнения тонн (3 знака).
const BAR_FILL_PCT = 95.2;
const EPS = 0.0005;

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "UTC" });
const kgFmt = new Intl.NumberFormat("ru-RU");

function parse(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}
function shortWeekday(dateStr: string): string {
  return WEEKDAY_SHORT[(parse(dateStr).getUTCDay() + 6) % 7];
}
// Тонны всегда с 1 знаком после запятой (полоса прогресса): «19,0», «−1,8».
function tons1(n: number): string {
  return n.toFixed(1).replace(".", ",");
}
// Дневной подытог: «3,24 т» (2 знака) или «—» при нуле.
function tons2(kg: number): string {
  return kg > 0 ? `${(kg / 1000).toFixed(2).replace(".", ",")} т` : "—";
}
function pluralMachines(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return "машина";
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return "машины";
  return "машин";
}
// «Коваль Роман Сергеевич» → «Коваль Р. С.».
function driverShort(full: string): string {
  const [last, ...rest] = full.trim().split(/\s+/);
  const initials = rest.map((p) => `${p.charAt(0).toUpperCase()}.`).join(" ");
  return initials ? `${last} ${initials}` : last;
}

const STATUS_LABEL: Record<BoardCard["status"], string> = {
  planned: "Плановая",
  sent: "Отправлена",
  arrived: "Прибыла",
  accepted: "Принята",
};

// Подложка/бордер чипа культуры из Culture.color (как в прототипе: 9% / 18%).
function chipStyle(color: string): React.CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} 9%, #fff)`,
    borderColor: `color-mix(in srgb, ${color} 18%, var(--hairline))`,
  };
}

function MCard({ card, onOpen }: { card: BoardCard; onOpen: (id: number) => void }) {
  const locked = !card.draggable;
  const tareLabel = formatTareTotals(card.tare.boxes, card.tare.barrels);
  const depDay = card.departureDate ? dayFmt.format(parse(card.departureDate)) : "—";
  const arr = card.arrivalDate ? dayMonthFmt.format(parse(card.arrivalDate)) : "—";

  return (
    <article
      className={`mcard s-${card.status} ${card.draggable ? "draggable" : "locked"}`}
      onClick={() => onOpen(card.shipmentId)}
    >
      <div className="mcard-strip" />
      <div className="mcard-top">
        <span className={`badge s-${card.status}`}>
          <span className="dot" />
          {STATUS_LABEL[card.status]}
        </span>
        <span className="mcard-dates">
          <span className="dep">{depDay}</span>
          <span className="arrow">→</span>
          <span className="arr">{arr}</span>
        </span>
        <span
          className="mcard-handle"
          title={
            locked
              ? "Залочена — отправлена, перенос недоступен"
              : "Перенос — в B5-1b"
          }
        >
          {locked ? <Lock /> : <GripVertical />}
        </span>
      </div>
      <div className="mcard-body">
        <div>
          <div className="farmer">{card.farmerName}</div>
          {card.driverName ? (
            <span className="driver">
              {driverShort(card.driverName)}
              {card.transportCompanyName ? ` · ${card.transportCompanyName}` : ""}
              <Info className="i" />
            </span>
          ) : (
            <span className="driver driver-none">водитель не назначен</span>
          )}
        </div>
        <div className="chips">
          {card.cultures.map((c) => (
            <div key={c.cultureId} className="cchip" style={chipStyle(c.color)}>
              <span className="sq" style={{ background: c.color }} />
              <span className="nm">{c.name}</span>
              <span className="wt tnum">
                {kgFmt.format(c.totalKg)}
                <span className="u">кг</span>
              </span>
            </div>
          ))}
        </div>
        <div className="mcard-foot">
          <span className="tara">
            <Package />
            <b>
              {tareLabel
                ? `${card.status === "planned" ? "≈ " : ""}${tareLabel}`
                : "навал"}
            </b>
          </span>
          <span className="deficit-slot" />
        </div>
      </div>
    </article>
  );
}

function ProgressBar({
  planned,
  target,
  color,
}: {
  planned: number;
  target: number;
  color: string;
}) {
  const scaleMax = Math.max(target, planned);
  const fillPct = scaleMax > 0 ? (planned / scaleMax) * BAR_FILL_PCT : 0;
  const tickPct = scaleMax > 0 ? (target / scaleMax) * BAR_FILL_PCT : 0;
  const over = planned > target + EPS;
  return (
    <div className={`mbar${over ? " over" : ""}`}>
      <div className="fill" style={{ width: `${fillPct}%`, background: color }} />
      <div className="tick" style={{ left: `${tickPct}%` }} />
    </div>
  );
}

export function BoardView({
  week,
  loading,
  options,
  onOpenPlan,
}: {
  week: BoardWeek | null;
  loading: boolean;
  options: ShipmentOptions;
  onOpenPlan: () => void;
}) {
  // Один хост диалога правки на доску (деталь грузим лениво по клику карточки).
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);

  async function openCard(id: number) {
    const d = await getShipment(id);
    if (!d) {
      toast.error("Отгрузка не найдена");
      return;
    }
    setDetail(d);
    setOpen(true);
  }

  if (!week) {
    return (
      <div className="board-wrap">
        <p className="text-sm text-[#888]">{loading ? "Загрузка…" : "Нет доступа"}</p>
      </div>
    );
  }

  return (
    <>
      {/* Полоса прогресса к плану (или намёк, если плана нет). */}
      {week.hasPlan ? (
        <div className="progress">
          <div className="pg-lead">
            <span className="t">Прогресс к плану</span>
            <span className="v tnum">
              {tons1(week.totalPlannedTons)}{" "}
              <span className="g">/ {tons1(week.totalTargetTons)} т</span>
            </span>
          </div>
          <div className="pgbars">
            {week.progress.map((p) => {
              const delta = p.plannedTons - p.targetTons;
              const over = delta > EPS;
              return (
                <div key={p.cultureId} className="pgcol">
                  <div className="pgcol-top">
                    <span className="sq" style={{ background: p.color }} />
                    <span className="nm">{p.name}</span>
                    <span className={`delta ${over ? "over" : "under"} tnum`}>
                      {over ? "+" : "−"}
                      {tons1(Math.abs(delta))}
                    </span>
                  </div>
                  <ProgressBar
                    planned={p.plannedTons}
                    target={p.targetTons}
                    color={p.color}
                  />
                  <div className="pgcol-cap tnum">
                    {tons1(p.plannedTons)}{" "}
                    <span className="g">/ {tons1(p.targetTons)} т</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="progress flat">
          <div className="noplan">
            <AlertCircle />
            Цели по культурам на неделю не заданы — прогресс не считается.{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onOpenPlan();
              }}
            >
              Задать план →
            </a>
          </div>
        </div>
      )}

      {/* Доска: колонки рабочих дней, карточки в дне прибытия. */}
      <div className="board-wrap">
        <div className="board">
          {week.columns.map((col) => (
            <section
              key={col.dateISO}
              className={`col${col.cards.length === 0 ? " is-empty" : ""}`}
            >
              <div className="col-head">
                <span className="dow">{shortWeekday(col.dateISO)}</span>
                <span className="date">{dayMonthFmt.format(parse(col.dateISO))}</span>
                <span className="sub">
                  <b>{col.machineCount}</b> {pluralMachines(col.machineCount)} ·{" "}
                  <b>{tons2(col.daySubtotalKg)}</b>
                </span>
              </div>
              <div className="col-body">
                {col.cards.length === 0 ? (
                  <div className="col-empty-hint">Нет отгрузок</div>
                ) : (
                  col.cards.map((card) => (
                    <MCard key={card.shipmentId} card={card} onOpen={openCard} />
                  ))
                )}
              </div>
              <div className="col-foot">
                {/* «+ Отгрузка» — обработчик в B5-1b; пока заглушка. */}
                <button className="addship" disabled title="Скоро — B5-1b">
                  <Plus />
                  Отгрузка
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>

      {detail && (
        <ShipmentFormDialog
          mode="edit"
          row={detail}
          options={options}
          open={open}
          onOpenChange={setOpen}
          showTrigger={false}
        />
      )}
    </>
  );
}
