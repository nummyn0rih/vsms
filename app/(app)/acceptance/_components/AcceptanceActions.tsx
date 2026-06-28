"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { markArrived } from "@/server/acceptance/actions";

// Формат даты как в ленте (день + месяц прописью), UTC чтобы date-only не плыл по TZ.
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
function fmtDate(iso: string): string {
  return dayMonthFmt.format(new Date(`${iso}T00:00:00Z`));
}

// «Отметить прибытие»: sent → arrived (BR-24б). Диалог выбора фактической даты прибытия —
// плановая (из отгрузки) либо сегодня. operator/admin (RoleGate на вызове; серверный
// requireRole — истина).
export function MarkArrivedButton({
  shipmentId,
  code,
  arrivalDate,
}: {
  shipmentId: number;
  code: string;
  arrivalDate?: string | null; // плановая дата машины (YYYY-MM-DD)
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const planned = arrivalDate ?? null;
  // Умный дефолт: плановая в прошлом → берём её (отгрузка задним числом); иначе сегодня.
  const plannedIsPast = planned != null && planned < today;
  const [choice, setChoice] = useState<"planned" | "today">(
    plannedIsPast ? "planned" : "today",
  );

  async function confirm() {
    const chosen = choice === "planned" && planned ? planned : today;
    setBusy(true);
    const res = await markArrived({ shipmentId, arrivalDate: chosen });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      toast.success(`Машина №${code} прибыла`);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <MapPin className="size-3.5" /> Отметить прибытие
      </Button>

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Дата прибытия · №{code}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            {planned != null && (
              <Button
                variant={choice === "planned" ? "default" : "outline"}
                className="justify-start"
                onClick={() => setChoice("planned")}
                disabled={busy}
              >
                Дата из отгрузки: {fmtDate(planned)}
              </Button>
            )}
            <Button
              variant={choice === "today" ? "default" : "outline"}
              className="justify-start"
              onClick={() => setChoice("today")}
              disabled={busy}
            >
              Сегодня: {fmtDate(today)}
            </Button>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Отмена
            </Button>
            <Button onClick={confirm} disabled={busy}>
              Отметить прибытие
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
