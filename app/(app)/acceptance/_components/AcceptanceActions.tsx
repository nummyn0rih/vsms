"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { markArrived } from "@/server/acceptance/actions";

// «Отметить прибытие»: sent → arrived без веса (BR-24б). operator/admin (под RoleGate
// на стороне вызова; серверный requireRole — истина).
export function MarkArrivedButton({
  shipmentId,
  code,
}: {
  shipmentId: number;
  code: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    const res = await markArrived({ shipmentId });
    setBusy(false);
    if (res.ok) {
      toast.success(`Машина №${code} прибыла`);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={busy}>
      <MapPin className="size-3.5" /> Отметить прибытие
    </Button>
  );
}

// «Акт» — заглушка (этап C: приёмка с % брака). disabled + CSS-тултип (как у
// SendShipmentButton, без TooltipProvider).
export function ActButtonStub() {
  return (
    <div className="group relative inline-flex">
      <button
        aria-disabled="true"
        className="inline-flex h-7 cursor-not-allowed items-center gap-1.5 rounded-md border border-[#ebebeb] bg-[#f1f1f1] px-2.5 text-[0.8rem] font-medium tracking-tight text-[#888]"
      >
        <FileText className="size-3.5" /> Акт
      </button>
      <span className="pointer-events-none absolute bottom-[calc(100%+7px)] left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#171717] px-[10px] py-[7px] text-xs leading-4 text-white group-hover:block">
        Приёмка с % брака — этап C
      </span>
    </div>
  );
}
