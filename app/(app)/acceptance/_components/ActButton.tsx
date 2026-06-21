"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Check, Loader2 } from "lucide-react";

import type { ActContext } from "@/server/acceptance/schema";
import { markArrived } from "@/server/acceptance/actions";
import { getActContext } from "@/server/acceptance/act";
import { AcceptanceActDialog } from "./AcceptanceActDialog";

// Кнопка «Акт» на позиции (BR-13: приёмка позиционная). Из sent-машины — сначала
// markArrived (sent→arrived), затем форма с баннером. accepted → бейдж «принят»,
// клик открывает форму на редактирование. user (read-only) — только бейдж/«—».
export function ActButton({
  shipmentItemId,
  machineId,
  machineStatus,
  accepted,
  actNumber,
  canEdit,
  isAdmin,
}: {
  shipmentItemId: number;
  machineId: number;
  machineStatus: "sent" | "arrived";
  accepted: boolean;
  actNumber: string | null;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<ActContext | null>(null);
  const [fromSent, setFromSent] = useState(false);
  // Счётчик открытий: ключ ремонтирует диалог, чтобы его состояние (вес/№/проценты)
  // переинициализировалось из свежего контекста при каждом открытии.
  const [openSeq, setOpenSeq] = useState(0);

  // user: только индикатор, без действий.
  if (!canEdit) {
    return accepted ? (
      <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-[#1d8e75]">
        <Check className="size-3" /> принят
      </span>
    ) : (
      <span className="text-xs text-[#888888]">—</span>
    );
  }

  async function onOpen() {
    setBusy(true);
    const openedFromSent = machineStatus === "sent";
    if (openedFromSent) {
      const arr = await markArrived({ shipmentId: machineId });
      if (!arr.ok) {
        setBusy(false);
        toast.error(arr.error);
        return;
      }
    }
    const ctx = await getActContext({ shipmentItemId });
    setBusy(false);
    if (!ctx) {
      toast.error("Позиция не найдена");
      return;
    }
    setContext(ctx);
    setFromSent(openedFromSent);
    setOpenSeq((s) => s + 1);
    setOpen(true);
  }

  return (
    <>
      {accepted ? (
        <button
          onClick={onOpen}
          disabled={busy}
          title={actNumber ? `Акт №${actNumber}` : undefined}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#c7f6ea] bg-[#ddfff7] px-2.5 text-[0.8rem] font-medium tracking-tight text-[#1d8e75] hover:bg-[#c7f6ea]"
        >
          <Check className="size-3.5" /> принят
        </button>
      ) : (
        <button
          onClick={onOpen}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#171717] bg-[#171717] px-2.5 text-[0.8rem] font-medium tracking-tight text-white hover:bg-[#171717]/90 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileText className="size-3.5" />
          )}{" "}
          Акт
        </button>
      )}

      {context && (
        <AcceptanceActDialog
          key={openSeq}
          context={context}
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) router.refresh();
          }}
          openedFromSent={fromSent}
          isAdmin={isAdmin}
        />
      )}
    </>
  );
}
