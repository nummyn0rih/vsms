"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { PackageOpen } from "lucide-react";

import type { AcceptanceBoard as Board, ActContext } from "@/server/acceptance/schema";
import { markArrived } from "@/server/acceptance/actions";
import { getActContext } from "@/server/acceptance/act";
import { writeUrlParam } from "@/app/(app)/shipments/_components/week-format";
import { MobileAcceptanceCard } from "./MobileAcceptanceCard";
import { MobileAcceptedCard } from "./MobileAcceptedCard";
import { MobileActDialog } from "./MobileActDialog";

type ZoneKey = "zone1" | "zone2" | "zone3";

function EmptyZone({ note }: { note: string }) {
  return (
    <div className="m-empty">
      <div className="ec-ic">
        <PackageOpen />
      </div>
      <div className="ed">{note}</div>
    </div>
  );
}

// Мобильная доска приёмки (<md) — те же данные (getAcceptanceBoard) и server actions,
// что десктопная AcceptanceBoard. Зоны — сегмент-таб (BR-26), состояние в ?zone=
// (writeUrlParam, тот же паттерн, что ?week= в ленте). Диалог акта — на доске, не в
// карточке: markArrived перетасовывает зоны (sent→arrived), карточка размонтируется
// (тот же фикс, что десктопная AcceptanceBoard.tsx).
export function MobileAcceptanceBoard({
  board,
  initialZone,
}: {
  board: Board;
  initialZone: ZoneKey;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canEdit = role === "operator" || role === "admin";
  const isAdmin = role === "admin";

  const [zone, setZone] = useState<ZoneKey>(initialZone);
  const [actState, setActState] = useState<{ context: ActContext; fromSent: boolean } | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  function selectZone(z: ZoneKey) {
    setZone(z);
    writeUrlParam("zone", z);
  }

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
    <div className="md:hidden">
      <div className="zone-seg">
        <button
          type="button"
          className={`zone-tab${zone === "zone1" ? " active" : ""}`}
          onClick={() => selectZone("zone1")}
        >
          <span className="zt-count">{board.zone1.length}</span>
          <span className="zt-lab">Ожидают перевески</span>
        </button>
        <button
          type="button"
          className={`zone-tab${zone === "zone2" ? " active" : ""}`}
          onClick={() => selectZone("zone2")}
        >
          <span className="zt-count">{board.zone2.length}</span>
          <span className="zt-lab">На приёмке</span>
        </button>
        <button
          type="button"
          className={`zone-tab${zone === "zone3" ? " active" : ""}`}
          onClick={() => selectZone("zone3")}
        >
          <span className="zt-count">{board.acceptedCount}</span>
          <span className="zt-lab">Принято</span>
        </button>
      </div>

      <div className="acards">
        {zone === "zone1" &&
          (board.zone1.length === 0 ? (
            <EmptyZone note="Нет машин в пути." />
          ) : (
            board.zone1.map((m) => (
              <MobileAcceptanceCard
                key={m.id}
                machine={m}
                canEdit={canEdit}
                pendingId={pendingId}
                onOpenAct={onOpenAct}
              />
            ))
          ))}

        {zone === "zone2" &&
          (board.zone2.length === 0 ? (
            <EmptyZone note="Нет машин на приёмке." />
          ) : (
            board.zone2.map((m) => (
              <MobileAcceptanceCard
                key={m.id}
                machine={m}
                canEdit={canEdit}
                pendingId={pendingId}
                onOpenAct={onOpenAct}
              />
            ))
          ))}

        {zone === "zone3" &&
          (board.zone3.length === 0 ? (
            <EmptyZone note="Нет принятых машин." />
          ) : (
            board.zone3.map((m) => <MobileAcceptedCard key={m.id} machine={m} isAdmin={isAdmin} />)
          ))}
      </div>

      {actState && (
        <MobileActDialog
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
    </div>
  );
}
