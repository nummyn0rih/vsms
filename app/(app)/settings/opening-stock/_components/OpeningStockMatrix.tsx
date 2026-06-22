"use client";

import { useState } from "react";

import { RoleGate } from "@/components/auth/RoleGate";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { OpeningBalances } from "@/server/inventory/opening";
import { OpeningStockInput } from "./OpeningStockInput";

const cellKey = (locationId: number, typeId: number) => `${locationId}:${typeId}`;

// Матрица начальных остатков тары: строки = Завод (первой, выделена) + фермеры,
// колонки = типы тары. Ячейка = текущий opening, автосейв по blur. admin правит,
// остальные видят read-only (раздел Settings и так admin-only — это запасной guard).
export function OpeningStockMatrix({ locations, types, values }: OpeningBalances) {
  const [valueMap, setValueMap] = useState(
    () =>
      new Map(values.map((v) => [cellKey(v.locationId, v.packagingTypeId), v.quantity])),
  );

  function handleSaved(key: string, value: number | null) {
    setValueMap((prev) => {
      const next = new Map(prev);
      if (value == null) next.delete(key);
      else next.set(key, value);
      return next;
    });
  }

  return (
    <TooltipProvider>
      <div className="grid gap-4">
        <div>
          <h2 className="text-lg font-medium">Начальные остатки тары</h2>
          <p className="text-sm text-muted-foreground">
            Стартовое количество единиц тары на заводе и у фермеров (целое, штук).
            Пусто или 0 — остатка нет. Задаётся один раз, далее правится склад-движениями.
          </p>
        </div>

        {locations.length === 0 || types.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нужны активные типы тары (и фермеры).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-30 border-b border-r bg-background px-3 py-2 text-left font-medium">
                    Локация
                  </th>
                  {types.map((t) => (
                    <th
                      key={t.id}
                      className="border-b px-3 py-2 text-left font-medium whitespace-nowrap"
                    >
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {locations.map((loc) => (
                  <tr key={loc.id} className={cn(loc.isFactory && "bg-muted/40")}>
                    <th
                      className={cn(
                        "sticky left-0 z-20 border-b border-r bg-background px-3 py-2 text-left font-medium whitespace-nowrap",
                        loc.isFactory && "bg-muted/40",
                      )}
                    >
                      {loc.name}
                    </th>
                    {types.map((t) => {
                      const key = cellKey(loc.id, t.id);
                      const savedValue = valueMap.get(key);
                      return (
                        <td key={t.id} className="border-b px-1.5 py-1">
                          <RoleGate
                            allow={["admin"]}
                            fallback={
                              <span className="block w-24 px-2 text-right tabular-nums">
                                {savedValue ?? "—"}
                              </span>
                            }
                          >
                            <OpeningStockInput
                              key={key}
                              locationId={loc.id}
                              packagingTypeId={t.id}
                              savedValue={savedValue}
                              onSaved={(v) => handleSaved(key, v)}
                            />
                          </RoleGate>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
