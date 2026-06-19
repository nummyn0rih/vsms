"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Pencil,
  Trash2,
  Send,
  Undo2,
  Calendar,
  Building2,
  AlertTriangle,
  FileText,
  RotateCcw,
  X,
} from "lucide-react";

import {
  getShipment,
  deleteShipment,
  sendShipment,
  revertShipmentToPlanned,
} from "@/server/shipments/actions";
import type { ShipmentDetail, ShipmentOptions } from "@/server/shipments/schema";
import type { FeedShipment, SendPreview } from "@/server/shipments/feed";
import { buildSendPreview } from "@/server/shipments/feed";
import {
  formatTareTotals,
  tareUnitWord,
  positionsWord,
  farmersWord,
} from "@/server/shipments/format";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ShipmentFormDialog } from "./ShipmentFormDialog";

// Вес с разделением тысяч и tabular-nums.
const nf = new Intl.NumberFormat("ru-RU");
export function formatWeight(kg: string | number): string {
  return nf.format(Number(kg));
}

// Карандаш правки. Деталь грузим лениво по клику. Для sent+ форма открывается
// в read-only (логику решает сама форма по row.status). Кнопку скрывают через
// RoleGate на стороне вызывающего (admin).
export function EditShipmentButton({
  id,
  options,
}: {
  id: number;
  options: ShipmentOptions;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);

  async function onClick() {
    const d = await getShipment(id);
    if (!d) {
      toast.error("Отгрузка не найдена");
      return;
    }
    setDetail(d);
    setOpen(true);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Редактировать"
        onClick={onClick}
      >
        <Pencil className="size-4" />
      </Button>
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

// --- Свёрстанные диалоги статусов (макет docs/prototypes/status-dialogs-3.html) ---

const dlgDateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
function fmtDate(s: string | null): string {
  return s ? dlgDateFmt.format(new Date(`${s}T00:00:00Z`)) : "—";
}

// «Коваль Роман Сергеевич» → «Коваль Р. С.» (фолбэк — как есть).
function formatDriverShort(full: string | null): string {
  if (!full) return "—";
  const [last, ...rest] = full.trim().split(/\s+/);
  const initials = rest.map((p) => `${p.charAt(0).toUpperCase()}.`).join(" ");
  return initials ? `${last} ${initials}` : last;
}

// Контекст-строка диалога: «{отпр} → {приб} · {Водитель} · {ТК}».
function MCtx({ shipment }: { shipment: FeedShipment }) {
  return (
    <div className="mt-[7px] inline-flex flex-wrap items-center gap-[7px] text-[13px] tracking-tight text-[#4d4d4d]">
      <Calendar className="size-[13px] shrink-0 text-[#888]" />
      <span className="text-[#888]">{fmtDate(shipment.departureDate)}</span>
      <span className="font-medium text-[#171717]">
        → {fmtDate(shipment.arrivalDate)}
      </span>
      {shipment.driverName && (
        <>
          <span className="text-[#a1a1a1]">·</span>
          <span>{formatDriverShort(shipment.driverName)}</span>
        </>
      )}
      {shipment.transportCompanyName && (
        <span className="text-[#888]">· {shipment.transportCompanyName}</span>
      )}
    </div>
  );
}

// Кнопка закрытия в углу шапки (макетная .m-x).
function DialogCloseX() {
  return (
    <DialogClose asChild>
      <button
        title="Закрыть"
        className="grid size-7 shrink-0 place-items-center rounded-md text-[#888] hover:bg-[#f5f5f5] hover:text-[#171717]"
      >
        <X className="size-4" />
      </button>
    </DialogClose>
  );
}

// Превью списания/возврата, сгруппированное по фермеру. Тип тары показываем у
// бочек (есть варианты) и у фермеров с несколькими типами.
function TarePreview({
  pre,
  totalLabel,
}: {
  pre: SendPreview;
  totalLabel: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#ebebeb] bg-white">
      {pre.groups.map((g) => (
        <div
          key={g.farmerId}
          className="border-t border-[#ebebeb] px-[13px] py-3 first:border-t-0"
        >
          <div className="mb-[7px] flex items-center gap-[7px] text-[13px] font-medium tracking-tight text-[#171717]">
            <Building2 className="size-[13px] shrink-0 text-[#888]" />
            {g.farmerName}
          </div>
          <div className="flex flex-col gap-[5px] pl-5">
            {g.lines.map((l, idx) => {
              const showName = l.kind === "barrel" || g.lines.length > 1;
              return (
                <div
                  key={l.packagingTypeId}
                  className="flex items-baseline gap-2.5"
                >
                  <span className="whitespace-nowrap text-sm font-semibold tabular-nums tracking-tight text-[#171717]">
                    {l.units}
                    <span className="ml-[3px] font-normal text-[#888]">
                      {idx > 0 ? "× " : ""}
                      {tareUnitWord(l.kind, l.units)}
                      {showName && (
                        <span className="opacity-85"> {l.packagingName}</span>
                      )}
                    </span>
                  </span>
                  <span className="ml-auto whitespace-nowrap text-right text-xs tracking-tight text-[#888]">
                    {l.cultures.map((c, i) => (
                      <span key={i}>
                        {i > 0 && <span className="mx-1 text-[#a1a1a1]">+</span>}
                        {c.name}{" "}
                        <span className="tabular-nums">{c.units}</span>
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2.5 border-t border-[#ebebeb] bg-[#fafafa] px-[13px] py-[11px]">
        <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-[#888]">
          {totalLabel}
        </span>
        <span className="ml-auto text-sm font-semibold tabular-nums tracking-tight text-[#171717]">
          {formatTareTotals(pre.totals.boxes, pre.totals.barrels)}
        </span>
      </div>
    </div>
  );
}

// Капшн над превью: метка + счётчик.
function TaraCap({ label, count }: { label: string; count: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-[#888]">
        {label}
      </span>
      <span className="text-xs tracking-tight text-[#888]">{count}</span>
    </div>
  );
}

// Блокирующий error-блок «нет нормы» с тройками и подсказкой.
function ErrBox({ missing }: { missing: SendPreview["missing"] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#f7d4d6] bg-[#fff7f7]">
      <div className="flex items-start gap-[9px] px-[13px] pb-[9px] pt-[11px]">
        <AlertTriangle className="mt-px size-[15px] shrink-0 text-[#ee0000]" />
        <span className="text-[13px] font-semibold leading-[18px] tracking-tight text-[#c50000]">
          Не рассчитана тара — нет нормы:
        </span>
      </div>
      <div className="flex flex-col px-[13px] pb-1 pl-[35px]">
        {missing.map((m, i) => (
          <div
            key={i}
            className="flex items-center gap-2 border-t border-dashed border-[#f7d4d6] py-[5px] text-[13px] tracking-tight text-[#171717] first:border-t-0"
          >
            {m.cultureName} <span className="font-medium text-[#ee0000]">×</span>{" "}
            {m.farmerName} <span className="font-medium text-[#ee0000]">×</span>{" "}
            <span className="text-[#888]">{m.packagingName}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-[#f7d4d6] bg-[#fffafa] px-[13px] pb-[11px] pl-[35px] pt-[9px] text-xs leading-[17px] tracking-tight text-[#4d4d4d]">
        Заведите нормы в{" "}
        <span className="font-medium text-[#171717]">Настройки → Нормы</span>,
        чтобы отправить.
      </div>
    </div>
  );
}

const M_CONTENT_CLS =
  "gap-0 overflow-hidden rounded-lg border border-[#ebebeb] bg-white p-0 sm:max-w-[480px]";
const M_TITLE_CLS =
  "text-[18px] font-semibold leading-6 tracking-[-0.035em] text-[#171717]";
const M_LEAD_CLS = "text-sm leading-5 tracking-tight text-[#4d4d4d]";
const BTN_SECONDARY_CLS =
  "h-10 flex-1 rounded-md border border-[#ebebeb] bg-white px-4 text-sm font-medium tracking-tight text-[#4d4d4d] hover:bg-[#fafafa]";
const BTN_PRIMARY_CLS =
  "flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-[#171717] bg-[#171717] px-4 text-sm font-medium tracking-tight text-white shadow-[0_1px_2px_#0000001f] hover:bg-[#171717]/90 disabled:opacity-60";

// Отправка planned → sent. Превью строится из shipment.items (tareUnits уже
// посчитан сервером по плановому весу — это агрегация, не пересчёт). Нет водителя
// и/или нет нормы → «Отправить» disabled с тултипом.
export function SendShipmentButton({ shipment }: { shipment: FeedShipment }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pre = useMemo(() => buildSendPreview(shipment.items), [shipment.items]);
  const noDriver = shipment.driverId == null;
  const hasMissing = pre.missing.length > 0;
  const blocked = noDriver || hasMissing;

  const tip =
    noDriver && hasMissing
      ? "Назначьте водителя и заведите нормы"
      : noDriver
        ? "Назначьте водителя"
        : "Нельзя отправить: есть нерассчитанная тара";

  const capCount = hasMissing
    ? `${pre.computedPositions} из ${pre.totalTarePositions} ${positionsWord(pre.totalTarePositions)}`
    : `${pre.computedPositions} ${positionsWord(pre.computedPositions)} · ${pre.farmersCount} ${farmersWord(pre.farmersCount)}`;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setError(null);
  }

  async function onConfirm() {
    setSending(true);
    setError(null);
    const res = await sendShipment(shipment.id);
    setSending(false);
    if (res.ok) {
      toast.success(`Отгрузка №${shipment.code} отправлена`);
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Отправить">
          <Send className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className={M_CONTENT_CLS}>
        <div className="flex items-start gap-3 px-5 pt-5">
          <div className="min-w-0 flex-1">
            <DialogTitle className={M_TITLE_CLS}>Отправить отгрузку?</DialogTitle>
            <MCtx shipment={shipment} />
          </div>
          <DialogCloseX />
        </div>

        <div className="flex flex-col gap-3.5 px-5 pb-5 pt-[18px]">
          <DialogDescription className={M_LEAD_CLS}>
            При отправке будет{" "}
            <strong className="font-medium text-[#171717]">списана тара</strong>{" "}
            у фермеров (движение фермер&nbsp;→&nbsp;завод):
          </DialogDescription>

          <TaraCap label="Будет списано" count={capCount} />
          {pre.groups.length > 0 && <TarePreview pre={pre} totalLabel="Итого" />}
          {hasMissing && <ErrBox missing={pre.missing} />}
          {error && <p className="text-sm text-[#c50000]">{error}</p>}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <DialogClose asChild>
            <button className={BTN_SECONDARY_CLS}>Отмена</button>
          </DialogClose>
          {blocked ? (
            <div className="group relative flex flex-1">
              <button
                aria-disabled="true"
                className="flex h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-[#ebebeb] bg-[#f1f1f1] px-4 text-sm font-medium tracking-tight text-[#888]"
              >
                <Send className="size-[15px]" /> Отправить
              </button>
              <span className="pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#171717] px-[10px] py-[7px] text-xs leading-4 text-white group-hover:block">
                {tip}
              </span>
            </div>
          ) : (
            <button
              onClick={onConfirm}
              disabled={sending}
              className={BTN_PRIMARY_CLS}
            >
              <Send className="size-[15px]" /> Отправить
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Откат sent → planned со сторно тары (только admin). Кнопка «Откатить» — обычная
// primary (обратимое штатное действие, НЕ деструктив).
export function RevertShipmentButton({ shipment }: { shipment: FeedShipment }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pre = useMemo(() => buildSendPreview(shipment.items), [shipment.items]);
  const capCount = `${pre.computedPositions} ${positionsWord(pre.computedPositions)} · ${pre.farmersCount} ${farmersWord(pre.farmersCount)}`;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setError(null);
  }

  async function onConfirm() {
    setReverting(true);
    setError(null);
    const res = await revertShipmentToPlanned(shipment.id);
    setReverting(false);
    if (res.ok) {
      toast.success(`Отгрузка №${shipment.code} возвращена в план`);
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Откатить в план">
          <Undo2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className={M_CONTENT_CLS}>
        <div className="flex items-start gap-3 px-5 pt-5">
          <div className="min-w-0 flex-1">
            <DialogTitle className={M_TITLE_CLS}>
              Откатить отгрузку в план?
            </DialogTitle>
            <MCtx shipment={shipment} />
          </div>
          <DialogCloseX />
        </div>

        <div className="flex flex-col gap-3.5 px-5 pb-5 pt-[18px]">
          <DialogDescription className={M_LEAD_CLS}>
            Отгрузка вернётся в статус{" "}
            <strong className="font-medium text-[#171717]">«Плановая»</strong>.
            Ранее списанная тара будет{" "}
            <strong className="font-medium text-[#171717]">
              возвращена фермерам
            </strong>{" "}
            (сторно).
          </DialogDescription>

          <TaraCap label="Вернётся фермерам" count={capCount} />
          {pre.groups.length > 0 && (
            <TarePreview pre={pre} totalLabel="Вернётся" />
          )}

          <p className="m-0 flex items-center gap-[7px] text-xs leading-[17px] tracking-tight text-[#888]">
            <FileText className="size-[13px] shrink-0 opacity-80" />
            Действие фиксируется в журнале изменений.
          </p>
          {error && <p className="text-sm text-[#c50000]">{error}</p>}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <DialogClose asChild>
            <button className={BTN_SECONDARY_CLS}>Отмена</button>
          </DialogClose>
          <button
            onClick={onConfirm}
            disabled={reverting}
            className={BTN_PRIMARY_CLS}
          >
            <RotateCcw className="size-[15px]" /> Откатить
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteShipmentButton({ id, code }: { id: number; code: string }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await deleteShipment(id);
    if (res.ok) {
      toast.success("Отгрузка удалена");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Удалить"
          className="hover:text-[#ee0000]"
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить отгрузку №{code}?</AlertDialogTitle>
          <AlertDialogDescription>
            Плановая отгрузка и все её позиции будут удалены безвозвратно.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Удалить</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
