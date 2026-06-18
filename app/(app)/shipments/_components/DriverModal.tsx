"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Phone, Copy } from "lucide-react";

import { formatPhone, normalizePhone } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Модалка водителя (DESIGN §2). Триггер — кнопка «Фамилия · ТК» в левой зоне
// машины. Данные приходят из FeedShipment (passthrough из feed.ts).
export function DriverModal({
  driverName,
  transportCompanyName,
  phone,
  info,
}: {
  driverName: string;
  transportCompanyName: string | null;
  phone: string | null;
  info: string | null;
}) {
  const [open, setOpen] = useState(false);

  const driverLabel = transportCompanyName
    ? `${driverName} · ${transportCompanyName}`
    : driverName;

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} скопировано`);
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  function copyAll() {
    const parts = [driverName];
    if (transportCompanyName) parts.push(transportCompanyName);
    if (phone) parts.push(formatPhone(phone));
    if (info) parts.push(info);
    copy(parts.join("\n"), "Карточка водителя");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-left text-[13px] font-medium tracking-tight text-foreground hover:underline"
      >
        {driverLabel}
      </button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{driverName}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {transportCompanyName && (
            <span className="inline-flex w-fit items-center rounded-md border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {transportCompanyName}
            </span>
          )}

          {phone ? (
            <a
              href={`tel:${normalizePhone(phone)}`}
              className="inline-flex items-center gap-2 text-sm text-[#0070f3] hover:underline"
            >
              <Phone className="size-4" />
              <span className="tabular-nums">{formatPhone(phone)}</span>
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">Телефон не указан</span>
          )}

          {info && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
              {info}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {phone && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(formatPhone(phone), "Телефон")}
              >
                <Copy className="size-3.5" /> Скопировать телефон
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={copyAll}>
              <Copy className="size-3.5" /> Скопировать всё
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
