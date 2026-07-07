import { Truck } from "lucide-react";

import type { FarmerCard } from "@/server/farmers/card";
import { StatusBadge } from "@/app/(app)/shipments/_components/shipment-status";
import { EmptyState } from "./EmptyState";

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });

function fmtDate(d: string | null): string {
  return d ? dateFmt.format(new Date(`${d}T00:00:00Z`)) : "—";
}

function fmtKg(n: number | null): string {
  return n == null ? "—" : Math.round(n).toLocaleString("ru-RU");
}

export function ShipmentsPanel({ card }: { card: FarmerCard }) {
  const { weeks } = card.shipments;

  if (weeks.length === 0) {
    return (
      <EmptyState
        icon={Truck}
        title="Нет отгрузок"
        description={`По этому поставщику ещё не было отгрузок в сезоне ${card.farmer.season}.`}
      />
    );
  }

  return (
    <div className="flex max-h-[460px] flex-col gap-5 overflow-y-auto">
      {weeks.map((w) => (
        <div key={`${w.isoYear}-${w.isoWeek}`}>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <span className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              W{w.isoWeek}
            </span>
            <span className="text-sm font-semibold">
              Неделя {w.isoWeek}{" "}
              <span className="font-normal text-muted-foreground">
                · {fmtDate(w.startDate)} – {fmtDate(w.endDate)}
              </span>
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              <b className="font-medium text-foreground tabular-nums">{w.machineCount}</b>{" "}
              {w.machineCount === 1 ? "машина" : "машин"}
              {w.totalAcceptedKg > 0 && (
                <>
                  {" "}
                  · принято{" "}
                  <b className="font-medium text-foreground tabular-nums">
                    {fmtKg(w.totalAcceptedKg)} кг
                  </b>
                </>
              )}
            </span>
          </div>

          <table className="w-full table-fixed border-collapse overflow-hidden rounded-lg border text-sm">
            <colgroup>
              <col style={{ width: 92 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 130 }} />
              <col />
              <col style={{ width: 96 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 104 }} />
            </colgroup>
            <thead>
              <tr className="bg-muted/40 text-xs text-muted-foreground">
                <th className="border-b px-3 py-2 text-left font-medium">Дата</th>
                <th className="border-b px-3 py-2 text-left font-medium">Машина</th>
                <th className="border-b px-3 py-2 text-left font-medium">Статус</th>
                <th className="border-b px-3 py-2 text-left font-medium">Культура</th>
                <th className="border-b px-3 py-2 text-right font-medium">План, кг</th>
                <th className="border-b px-3 py-2 text-right font-medium">Факт, кг</th>
                <th className="border-b px-3 py-2 text-right font-medium">Принято, кг</th>
              </tr>
            </thead>
            <tbody>
              {w.rows.map((r) => (
                <tr key={r.itemId} className="hover:bg-muted/20">
                  <td className="border-b px-3 py-2 tabular-nums text-muted-foreground">
                    {fmtDate(r.date)}
                  </td>
                  <td className="border-b px-3 py-2 font-mono text-xs">{r.machineCode}</td>
                  <td className="overflow-visible border-b px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="border-b px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block size-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: r.color }}
                      />
                      {r.cultureName}
                    </span>
                  </td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">
                    {fmtKg(r.plannedKg)}
                  </td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">
                    {fmtKg(r.actualKg)}
                  </td>
                  <td className="border-b px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {r.acceptedKg != null
                      ? fmtKg(r.acceptedKg)
                      : r.status === "planned"
                        ? "—"
                        : "— приёмка"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
