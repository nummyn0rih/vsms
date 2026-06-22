"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import type { AcceptanceBoard as Board } from "@/server/acceptance/schema";
import type { ActContext } from "@/server/acceptance/schema";
import { markArrived } from "@/server/acceptance/actions";
import { getActContext } from "@/server/acceptance/act";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AcceptanceMachine } from "./AcceptanceMachine";
import { AcceptedMachine } from "./AcceptedMachine";
import { AcceptanceActDialog } from "./AcceptanceActDialog";

function ZoneHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <span className="text-sm tabular-nums text-muted-foreground">{count}</span>
    </div>
  );
}

function EmptyZone({ note }: { note: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[#ebebeb] px-4 py-8 text-center text-sm text-muted-foreground">
      {note}
    </div>
  );
}

export function AcceptanceBoard({ board }: { board: Board }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

  // Состояние диалога акта держим ЗДЕСЬ (на доске), не в карточке: markArrived
  // перетасовывает зоны (sent→arrived), карточка размонтируется — диалог жил бы внутри
  // и терялся. Доска поверх перетасовки сохраняет состояние (фикс 1).
  const [actState, setActState] = useState<{
    context: ActContext;
    fromSent: boolean;
  } | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function onOpenAct(
    itemId: number,
    machineId: number,
    machineStatus: "sent" | "arrived",
  ) {
    setPendingId(itemId);
    const fromSent = machineStatus === "sent";
    if (fromSent) {
      const arr = await markArrived({ shipmentId: machineId });
      if (!arr.ok) {
        setPendingId(null);
        toast.error(arr.error);
        return;
      }
    }
    const ctx = await getActContext({ shipmentItemId: itemId });
    setPendingId(null);
    if (!ctx) {
      toast.error("Позиция не найдена");
      return;
    }
    setActState({ context: ctx, fromSent });
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-8">
        {/* Зона 1: машины в пути (sent) — ожидают перевески. */}
        <section>
          <ZoneHeader title="Ожидают перевески" count={board.zone1.length} />
          {board.zone1.length === 0 ? (
            <EmptyZone note="Нет машин в пути." />
          ) : (
            <div className="flex flex-col gap-3">
              {board.zone1.map((m) => (
                <AcceptanceMachine
                  key={m.id}
                  machine={m}
                  onOpenAct={onOpenAct}
                  pendingId={pendingId}
                />
              ))}
            </div>
          )}
        </section>

        {/* Зона 2: машины на приёмке (arrived). */}
        <section>
          <ZoneHeader title="На приёмке" count={board.zone2.length} />
          {board.zone2.length === 0 ? (
            <EmptyZone note="Нет машин на приёмке." />
          ) : (
            <div className="flex flex-col gap-3">
              {board.zone2.map((m) => (
                <AcceptanceMachine
                  key={m.id}
                  machine={m}
                  onOpenAct={onOpenAct}
                  pendingId={pendingId}
                />
              ))}
            </div>
          )}
        </section>

        {/* Зона 3: принято (accepted) — карточки свёрнуты, разворот по клику. */}
        <section>
          <ZoneHeader title="Принято" count={board.acceptedCount} />
          {board.zone3.length === 0 ? (
            <EmptyZone note="Нет принятых машин." />
          ) : (
            <div className="flex flex-col gap-3">
              {board.zone3.map((m) => (
                <AcceptedMachine key={m.id} machine={m} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Один диалог акта на доску — переживает перетасовку зон (фикс 1/3). */}
      {actState && (
        <AcceptanceActDialog
          key={actState.context.shipmentItemId}
          context={actState.context}
          open
          onOpenChange={(v) => {
            if (!v) {
              setActState(null);
              router.refresh();
            }
          }}
          openedFromSent={actState.fromSent}
          isAdmin={isAdmin}
        />
      )}
    </TooltipProvider>
  );
}
