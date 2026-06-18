"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2, Send, Undo2 } from "lucide-react";

import {
  getShipment,
  deleteShipment,
  sendShipment,
  revertShipmentToPlanned,
  previewShipmentTare,
} from "@/server/shipments/actions";
import type {
  ShipmentDetail,
  ShipmentOptions,
  ShipmentTarePreview,
} from "@/server/shipments/schema";
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

// Отправка planned → sent. Предпросмотр тары грузится при открытии: нет водителя /
// нет норм → ошибка в теле, кнопка disabled; иначе список списаний у фермеров.
export function SendShipmentButton({ id, code }: { id: number; code: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ShipmentTarePreview | null>(null);
  const [sending, setSending] = useState(false);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setPreview(null);
      setPreview(await previewShipmentTare(id));
    }
  }

  async function onConfirm() {
    setSending(true);
    const res = await sendShipment(id);
    setSending(false);
    if (res.ok) {
      toast.success(`Отгрузка №${code} отправлена`);
      setOpen(false);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  const canSend = preview?.ok === true;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Send className="size-3.5" /> Отправить
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Отправить отгрузку №{code}?</AlertDialogTitle>
          <AlertDialogDescription>
            При отправке тара спишется со складов фермеров на завод.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {preview === null && (
          <p className="text-sm text-muted-foreground">Расчёт тары…</p>
        )}

        {preview?.ok === true && (
          <div className="text-sm">
            {preview.lines.length === 0 ? (
              <p className="text-muted-foreground">
                Тары нет (навал) — движений не будет.
              </p>
            ) : (
              <>
                <p className="mb-1 font-medium">Будет списано у фермеров:</p>
                <ul className="space-y-0.5">
                  {preview.lines.map((l, i) => (
                    <li key={i}>
                      {l.farmerName} —{" "}
                      <span className="tabular-nums">{l.units}</span>{" "}
                      {l.packagingName}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {preview?.ok === false && (
          <div className="text-sm text-destructive">
            {preview.driverMissing && <p>Назначьте водителя перед отправкой.</p>}
            {preview.missing.length > 0 && (
              <>
                <p className="font-medium">Нет нормы фасовки для пар:</p>
                <ul className="space-y-0.5">
                  {preview.missing.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canSend || sending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            Отправить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Откат sent → planned со сторно тары (только admin).
export function RevertShipmentButton({ id, code }: { id: number; code: string }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await revertShipmentToPlanned(id);
    if (res.ok) {
      toast.success(`Отгрузка №${code} возвращена в черновик`);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Undo2 className="size-3.5" /> В план
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Откатить отгрузку №{code} в черновик?</AlertDialogTitle>
          <AlertDialogDescription>
            Списанная при отправке тара вернётся фермерам сторно-движениями.
            Статус сменится на «Черновик», после чего отгрузку снова можно править.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Откатить</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
        <Button variant="ghost" size="icon-sm" title="Удалить">
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить отгрузку №{code}?</AlertDialogTitle>
          <AlertDialogDescription>
            Черновик отгрузки и все его позиции будут удалены безвозвратно.
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
