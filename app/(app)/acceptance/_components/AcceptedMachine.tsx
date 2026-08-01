"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronRight, FileText, Loader2, Pencil, RotateCcw } from "lucide-react";

import type { AcceptedMachine as Machine } from "@/server/acceptance/schema";
import { revertAct } from "@/server/acceptance/act";
import {
  actNumbersSummary,
  computeAcceptedPercent,
} from "@/server/acceptance/accepted";
import { RoleGate } from "@/components/auth/RoleGate";
import { formatWeight } from "@/app/(app)/shipments/_components/shipment-actions";
import { DriverModal } from "@/app/(app)/shipments/_components/DriverModal";
import { ACT_CHIP_CLS, LEFT_ZONE_CLS } from "./card-layout";

const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "UTC" });

function monthOf(s: string): number {
  return new Date(`${s}T00:00:00Z`).getUTCMonth();
}

// «{отправление} → {прибытие}» — как в ленте/зонах 1–2.
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

// Уникальные культуры машины (по названию) — чипы в шапке.
function cultureChips(
  positions: Machine["positions"],
): { name: string; color: string }[] {
  const seen = new Map<string, string>();
  for (const p of positions) {
    if (!seen.has(p.cultureName)) seen.set(p.cultureName, p.color);
  }
  return [...seen].map(([name, color]) => ({ name, color }));
}

function kg(n: number): string {
  return formatWeight(Math.round(n));
}
function rub(n: number): string {
  return formatWeight(Math.round(n));
}

// % принятого веса позиции. Формула НЕ новая — та же чистая computeAcceptedPercent, что
// валидирует settlement_percent на сервере (simple: 100 − брак%; калибр: Σ принятых
// категорий), поэтому значение всегда сходится с «принято … кг» (computeAcceptedKg).
function acceptedPctLabel(pos: Machine["positions"][number]): string {
  if (!(pos.actualKg > 0)) return "—";
  const pct = computeAcceptedPercent(pos.brakPercent, pos.calibres);
  return `${pct.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} %`;
}

// Кнопка отката акта (admin). Откат штатный/обратим → вторичный, не красный стиль.
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
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex h-[34px] items-center gap-1.5 rounded-md border border-[#ebebeb] bg-white px-3 text-[13px] font-medium tracking-tight text-[#4d4d4d] shadow-[0_1px_1px_#0000000a] hover:border-[#a1a1a1] hover:bg-[#fafafa] hover:text-[#171717] disabled:opacity-60"
      >
        <RotateCcw className="size-3.5" /> Откатить акт
      </button>
      <span className="pointer-events-none absolute bottom-[calc(100%+9px)] right-0 z-10 w-[252px] rounded-md bg-[#171717] px-2.5 py-2 text-xs leading-4 text-white opacity-0 shadow-[0_8px_18px_-6px_#00000055] transition-opacity group-hover:opacity-100">
        Вернёт машину в статус <b className="font-semibold">«Прибыла»</b> и сторнирует
        движения ингредиентов. Откат обратим и штатен.
      </span>
    </div>
  );
}

// Кнопка правки акта БЕЗ отката (admin, acceptance-ux-2). Открывает тот же диалог акта,
// что и приёмка (getActContext отдаёт сохранённые значения); фактический вес в нём
// остаётся read-only — расход ингредиентов уже списан по нему (гард w5a).
function EditActButton({
  onClick,
  pending,
}: {
  onClick: () => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex h-[34px] items-center gap-1.5 rounded-md border border-[#ebebeb] bg-white px-3 text-[13px] font-medium tracking-tight text-[#4d4d4d] shadow-[0_1px_1px_#0000000a] hover:border-[#a1a1a1] hover:bg-[#fafafa] hover:text-[#171717] disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Pencil className="size-3.5" />
      )}{" "}
      Изменить акт
    </button>
  );
}

function Position({
  pos,
  onEditAct,
  pending,
}: {
  pos: Machine["positions"][number];
  onEditAct: () => void;
  pending: boolean;
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-[#ebebeb]"
      style={{ backgroundColor: `color-mix(in srgb, ${pos.color} 9%, #fff)` }}
    >
      {/* Шапка: культура + фермер · № акта + бейдж «Акт принят». */}
      <div className="flex items-start gap-3 px-3.5 pb-2 pt-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-2 text-[14.5px] font-semibold tracking-tight text-[#171717]">
            <span
              className="inline-block size-[10px] shrink-0 rounded-[3px]"
              style={{ backgroundColor: pos.color }}
            />
            {pos.cultureName}
          </span>
          <span className="pl-[18px] text-[12.5px] text-muted-foreground">
            {pos.farmerName}
          </span>
        </div>
        <div className="ml-auto inline-flex shrink-0 items-center gap-2">
          {pos.actNumber && (
            <span className="whitespace-nowrap rounded-[5px] border border-[#ebebeb] bg-white px-1.5 py-1 font-mono text-xs text-[#171717]">
              № {pos.actNumber}
            </span>
          )}
          <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-[#c7f6ea] px-2.5 text-xs font-medium text-[#1d8e75]">
            <FileText className="size-3" /> Акт принят
          </span>
        </div>
      </div>

      {/* Метрики: факт · принято % · брак · принято [· к оплате, если корректировка BR-33]. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3.5 pt-0.5">
        <Metric k="факт" v={`${kg(pos.actualKg)}`} u="кг" />
        <span className="text-[#a1a1a1]">·</span>
        <Metric k="принято %" v={acceptedPctLabel(pos)} />
        <span className="text-[#a1a1a1]">·</span>
        <Metric k="брак" v={`${pos.brakPercent} %`} />
        <span className="text-[#a1a1a1]">·</span>
        <Metric
          k="принято"
          v={`${kg(pos.acceptedKg)}`}
          u="кг"
          pay={pos.settlementPercent == null}
        />
        {pos.settlementPercent != null && (
          <>
            <span className="text-[#a1a1a1]">·</span>
            <Metric k="к оплате" v={`${kg(pos.paidKg)}`} u="кг" pay />
            <span className="whitespace-nowrap rounded-[5px] border border-[#ebebeb] bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#4d4d4d]">
              договорённость {pos.settlementPercent} %
            </span>
          </>
        )}
      </div>

      {/* Калибр-разбивка (только калибр-культуры). */}
      {pos.calibres.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3.5 pb-0.5 pt-2.5">
          <span className="mr-0.5 font-mono text-[9.5px] uppercase tracking-[0.04em] text-muted-foreground">
            калибр
          </span>
          {pos.calibres.map((c, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1 text-xs ${
                c.isAccepted
                  ? "border-[#ebebeb]"
                  : "border-dashed border-[#a1a1a1]"
              }`}
            >
              <span className="font-medium tabular-nums text-[#171717]">
                {c.label}
              </span>
              <span className="tabular-nums text-[#4d4d4d]">{c.percent} %</span>
              {c.isAccepted ? (
                <span className="tabular-nums text-muted-foreground">
                  {kg(c.kg)} кг
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">не в зачёт</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Футер: контракт · стоимость · откат. */}
      <div className="mt-2.5 grid grid-cols-[1fr_auto_auto] items-center gap-3.5 border-t border-[#ebebeb] bg-white px-3.5 py-2.5">
        <div className="inline-flex min-w-0 items-center gap-2 text-[13px] tracking-tight">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.04em] text-muted-foreground">
            контракт
          </span>
          {pos.lineLabel ? (
            <span className="truncate font-medium text-[#171717]">
              {pos.lineLabel}
            </span>
          ) : (
            <span className="italic text-muted-foreground">строка не привязана</span>
          )}
          {pos.pricePerKg != null && (
            <span className="whitespace-nowrap tabular-nums text-[#4d4d4d]">
              {pos.pricePerKg} <span className="text-muted-foreground">₽/кг</span>
            </span>
          )}
        </div>
        <div className="whitespace-nowrap text-right">
          {pos.pricePerKg != null && (
            <span className="mb-0.5 block text-[11.5px] tabular-nums text-[#1d8e75]">
              {/* База денег — оплачиваемый вес (принятый + доплата BR-33). */}
              {kg(pos.settlementPercent != null ? pos.paidKg : pos.acceptedKg)} кг ×{" "}
              {pos.pricePerKg} ₽
              {pos.surchargeKg > 0 && (
                <span className="ml-1 text-muted-foreground">
                  (вкл. доплату {kg(pos.surchargeKg)} кг)
                </span>
              )}
            </span>
          )}
          <span className="text-lg font-semibold tabular-nums tracking-tight text-[#171717]">
            {rub(pos.costRub)}
            <span className="ml-0.5 text-xs font-normal text-[#4d4d4d]">₽</span>
          </span>
        </div>
        {/* Правка и откат — обе admin-действия над принятой партией (деньги). Серверная
            проверка роли — в saveAct/revertAct, RoleGate прячет только кнопки. */}
        <RoleGate allow={["admin"]}>
          <div className="flex items-center gap-2">
            <EditActButton onClick={onEditAct} pending={pending} />
            <RollbackButton shipmentItemId={pos.id} />
          </div>
        </RoleGate>
      </div>

      {/* Нестандарт со своей строкой — оплачивается отдельно (в headline «к оплате» не входит). */}
      {pos.nonStandard.map((ns, i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 border-t border-dashed border-[#ebebeb] bg-white px-3.5 py-2 text-[12.5px] tracking-tight"
        >
          <span
            className="inline-block size-[7px] shrink-0 rounded-[2px] opacity-60"
            style={{ backgroundColor: pos.color }}
          />
          <span className="font-medium text-[#4d4d4d]">{ns.label}</span>
          {ns.lineLabel && (
            <span className="truncate text-[11.5px] text-muted-foreground">
              {ns.lineLabel}
            </span>
          )}
          {ns.pricePerKg != null ? (
            <span className="ml-auto whitespace-nowrap text-right">
              <span className="mr-2 tabular-nums text-[11.5px] text-muted-foreground">
                {kg(ns.kg)} кг × {ns.pricePerKg} ₽
              </span>
              <span className="font-semibold tabular-nums text-[#171717]">
                {rub(ns.costRub)}
                <span className="ml-0.5 text-[11px] font-normal text-[#4d4d4d]">₽</span>
              </span>
            </span>
          ) : (
            <span className="ml-auto tabular-nums text-muted-foreground">
              {kg(ns.kg)} кг
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Metric({
  k,
  v,
  u,
  pay,
}: {
  k: string;
  v: string;
  u?: string;
  pay?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap text-[13px] tracking-tight">
      <span className={pay ? "text-[#1d8e75]" : "text-muted-foreground"}>{k}</span>
      <span
        className={`tabular-nums ${pay ? "font-semibold text-[#1d8e75]" : "font-medium text-[#171717]"}`}
      >
        {v}
        {u && <span className="ml-0.5 text-[11.5px] font-normal text-muted-foreground">{u}</span>}
      </span>
    </span>
  );
}

export function AcceptedMachine({
  machine,
  onOpenAct,
  pendingId,
}: {
  machine: Machine;
  onOpenAct: (itemId: number, machineId: number, machineStatus: "accepted") => void;
  pendingId: number | null;
}) {
  const [open, setOpen] = useState(false);
  // № актов машины в СВЁРНУТОМ виде: раньше их было видно только после раскрытия, и
  // поиск нужного акта означал разворачивать каждую машину подряд.
  const acts = actNumbersSummary(machine.positions.map((p) => p.actNumber));

  return (
    <div className="overflow-hidden rounded-lg border border-[#ebebeb] bg-card shadow-[0_1px_1px_#00000005,0_2px_2px_#0000000a]">
      <div className="flex cursor-pointer items-stretch" onClick={() => setOpen((v) => !v)}>
        {/* Левая зона: статус · даты · водитель. */}
        <div
          className={`flex ${LEFT_ZONE_CLS} flex-col gap-2 border-r border-[#ebebeb] p-3`}
          style={{ backgroundColor: "#ddfff7" }}
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex h-[22px] items-center gap-1.5 rounded-md bg-[#c7f6ea] px-2.5 text-xs font-medium text-[#1d8e75]">
              <span className="inline-block size-1.5 rounded-full bg-[#29bc9b]" />
              Принята
            </span>
            <span className="text-[13px] tracking-tight">
              <TripDates
                departure={machine.departureDate}
                arrival={machine.arrivalDate}
              />
            </span>
          </div>
          {machine.driverName ? (
            <div onClick={(e) => e.stopPropagation()}>
              <DriverModal
                driverName={machine.driverName}
                transportCompanyName={machine.transportCompanyName}
                phone={machine.driverPhone}
                info={machine.driverInfo}
              />
            </div>
          ) : (
            <span className="text-[13px] italic text-muted-foreground">
              водитель не назначен
            </span>
          )}
        </div>

        {/* Правая зона: чипы культур · «принято M/M» · сумма машины · шеврон. */}
        <div className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3.5 gap-y-1 overflow-hidden">
            {cultureChips(machine.positions).map((c) => (
              <span
                key={c.name}
                className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] tracking-tight text-[#4d4d4d]"
              >
                <span
                  className="inline-block size-[9px] shrink-0 rounded-[2px]"
                  style={{ backgroundColor: c.color }}
                />
                {c.name}
              </span>
            ))}
            {acts.shown.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                {acts.shown.map((n) => (
                  <span key={n} className={ACT_CHIP_CLS}>
                    № {n}
                  </span>
                ))}
                {acts.rest > 0 && (
                  <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    +{acts.rest}
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-5">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] tracking-tight text-[#4d4d4d]">
              <Check className="size-3.5 text-[#1d8e75]" strokeWidth={2.4} />
              принято{" "}
              <b className="font-semibold tabular-nums text-[#171717]">
                {machine.acceptedCount}/{machine.total}
              </b>
            </span>
            <span className="whitespace-nowrap text-right">
              <span className="mb-0.5 block font-mono text-[9.5px] uppercase tracking-[0.04em] text-muted-foreground">
                сумма машины
              </span>
              <span className="text-[17px] font-semibold tabular-nums tracking-tight text-[#171717]">
                {rub(machine.machineSumRub)}
                <span className="ml-0.5 text-xs font-normal text-[#4d4d4d]">₽</span>
              </span>
            </span>
            <ChevronRight
              className={`size-[18px] text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
            />
          </div>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-2.5 border-t border-[#ebebeb] bg-[#fafafa] p-3">
          {machine.positions.map((pos) => (
            <Position
              key={pos.id}
              pos={pos}
              pending={pendingId === pos.id}
              onEditAct={() => onOpenAct(pos.id, machine.id, "accepted")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
