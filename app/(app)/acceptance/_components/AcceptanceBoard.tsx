"use client";

import type { AcceptanceBoard as Board } from "@/server/acceptance/schema";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AcceptanceMachine } from "./AcceptanceMachine";

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
                <AcceptanceMachine key={m.id} machine={m} />
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
                <AcceptanceMachine key={m.id} machine={m} />
              ))}
            </div>
          )}
        </section>

        {/* Зона 3: принято (заглушка, этап C). */}
        <section>
          <ZoneHeader title="Принято" count={board.acceptedCount} />
          <EmptyZone note="Принятые машины появятся здесь (этап C)." />
        </section>
      </div>
    </TooltipProvider>
  );
}
