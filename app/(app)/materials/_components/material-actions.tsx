"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2, Send, Undo2, RotateCcw, Check, X } from "lucide-react";

import {
  getMaterialShipment,
  deleteMaterialShipment,
  sendMaterialShipment,
  markItemArrived,
  unmarkItemArrived,
  markAllArrived,
  revertMaterialToPlanned,
  unmarkAllArrived,
} from "@/server/materials/actions";
import { RoleGate } from "@/components/auth/RoleGate";
import type { MaterialDetail, MaterialOptions } from "@/server/materials/schema";
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
import { MaterialFormDialog } from "./MaterialFormDialog";

// Карандаш правки. Деталь грузим лениво по клику. Для sent+ форма открывается в
// read-only (логику решает сама форма по row.status). RoleGate — у вызывающего.
export function EditMaterialButton({
  id,
  options,
}: {
  id: number;
  options: MaterialOptions;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<MaterialDetail | null>(null);

  async function onClick() {
    const d = await getMaterialShipment(id);
    if (!d) {
      toast.error("Рейс не найден");
      return;
    }
    setDetail(d);
    setOpen(true);
  }

  return (
    <>
      <Button variant="ghost" size="icon-sm" title="Редактировать" onClick={onClick}>
        <Pencil className="size-4" />
      </Button>
      {detail && (
        <MaterialFormDialog
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

export function DeleteMaterialButton({ id, code }: { id: number; code: string }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await deleteMaterialShipment(id);
    if (res.ok) {
      toast.success("Рейс удалён");
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
          <AlertDialogTitle>Удалить рейс №{code}?</AlertDialogTitle>
          <AlertDialogDescription>
            Плановый рейс тары и все его позиции будут удалены безвозвратно.
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

// Общий конфирм для переходов статуса (отправка/прибытие/откаты). Текстовая кнопка
// в футере карточки, подтверждение через AlertDialog.
function StatusActionButton({
  label,
  title,
  icon,
  description,
  confirmLabel,
  action,
  successText,
  variant = "outline",
}: {
  label: string;
  title: string;
  icon: React.ReactNode;
  description: string;
  confirmLabel: string;
  action: () => Promise<{ ok: boolean; error?: string }>;
  successText: string;
  variant?: "outline" | "default" | "ghost";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    setBusy(true);
    const res = await action();
    setBusy(false);
    if (res.ok) {
      toast.success(successText);
      router.refresh();
    } else {
      toast.error(res.error ?? "Не удалось");
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size="sm" title={title}>
          {icon}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SendMaterialButton({ id, code }: { id: number; code: string }) {
  return (
    <StatusActionButton
      label="Отправить"
      title="Отправить рейс?"
      icon={<Send className="size-[15px]" />}
      description="Тара спишется с завода и уйдёт «в путь» к фермерам (движение завод → транзит)."
      confirmLabel="Отправить"
      action={() => sendMaterialShipment(id)}
      successText={`Рейс №${code} отправлен`}
      variant="default"
    />
  );
}

// Дата прибытия позиции (feed отдаёт YYYY-MM-DD — времени суток нет).
const arrivedDateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "numeric",
  timeZone: "UTC",
});

// Per-item прибытие: отметить (admin|operator) / снять (admin). Состояние busy на
// время запроса, ошибка из ActionResult — тостом. Обновление дерева — router.refresh().
export function ItemArrivedControl({
  itemId,
  arrivedAt,
}: {
  itemId: number;
  arrivedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    const res = await action();
    setBusy(false);
    if (res.ok) router.refresh();
    else toast.error(res.error ?? "Не удалось");
  }

  if (arrivedAt == null) {
    return (
      <RoleGate allow={["admin", "operator"]}>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => run(() => markItemArrived(itemId))}
        >
          Отметить прибытие
        </Button>
      </RoleGate>
    );
  }

  return (
    <span className="flex items-center justify-end gap-1.5">
      <Check className="size-[15px] shrink-0 text-[#1d8e75]" aria-hidden />
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {arrivedDateFmt.format(new Date(`${arrivedAt}T00:00:00Z`))}
      </span>
      <RoleGate allow={["admin"]}>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Снять прибытие"
          disabled={busy}
          onClick={() => run(() => unmarkItemArrived(itemId))}
        >
          <X className="size-4" />
        </Button>
      </RoleGate>
    </span>
  );
}

export function ArriveMaterialButton({ id, code }: { id: number; code: string }) {
  return (
    <StatusActionButton
      label="Принять рейс"
      title="Отметить прибытие?"
      icon={<Check className="size-[15px]" />}
      description="Тара перейдёт из «в пути» на балансы фермеров (движение транзит → фермер)."
      confirmLabel="Прибыл"
      action={() => markAllArrived(id)}
      successText={`Рейс №${code} прибыл`}
    />
  );
}

export function RevertToPlannedButton({ id, code }: { id: number; code: string }) {
  return (
    <StatusActionButton
      label="Откатить в план"
      title="Откатить рейс в план?"
      icon={<Undo2 className="size-[15px]" />}
      description="Рейс вернётся в «Плановый». Ранее отправленная тара вернётся на завод (сторно)."
      confirmLabel="Откатить"
      action={() => revertMaterialToPlanned(id)}
      successText={`Рейс №${code} возвращён в план`}
      variant="ghost"
    />
  );
}

export function RevertToSentButton({ id, code }: { id: number; code: string }) {
  return (
    <StatusActionButton
      label="Откатить в путь"
      title="Откатить прибытие?"
      icon={<RotateCcw className="size-[15px]" />}
      description="Рейс вернётся в «Отправлен». Тара уйдёт с балансов фермеров обратно «в путь» (сторно)."
      confirmLabel="Откатить"
      action={() => unmarkAllArrived(id)}
      successText={`Рейс №${code} возвращён в путь`}
      variant="ghost"
    />
  );
}
