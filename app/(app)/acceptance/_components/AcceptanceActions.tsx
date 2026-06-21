"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin } from "lucide-react";

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
