import Link from "next/link";
import { FileText } from "lucide-react";

import type { FarmerCard } from "@/server/farmers/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "./EmptyState";

function fmtNum(n: number, maxFractionDigits = 0): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: maxFractionDigits });
}

// Компактный прогресс выполнения строки — тот же визуальный язык, что
// ProgressCell в ContractViewDialog.tsx (contracts/_components); та функция не
// экспортируется оттуда, поэтому здесь локальная копия.
function ProgressCell({ pct }: { pct: number }) {
  const over = pct > 100;
  const width = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${over ? "bg-foreground" : "bg-foreground/70"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span
        className={`w-11 shrink-0 text-right text-xs tabular-nums ${
          over ? "font-medium text-foreground" : "text-muted-foreground"
        }`}
      >
        {Math.round(pct)}%
      </span>
    </div>
  );
}

export function ContractsPanel({ card }: { card: FarmerCard }) {
  const { contracts, farmer } = card;

  if (contracts.items.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Нет контрактов"
        description={`У поставщика нет контрактов в сезоне ${farmer.season}. Контракты заводятся в разделе «Контракты».`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {contracts.items.map((c) => {
        const totals = c.lines.reduce(
          (acc, l) => ({
            volumeTons: acc.volumeTons + Number(l.volume_tons),
            acceptedKg: acc.acceptedKg + l.acceptedKg,
            targetKg: acc.targetKg + l.targetKg,
            costRub: acc.costRub + l.costRub,
          }),
          { volumeTons: 0, acceptedKg: 0, targetKg: 0, costRub: 0 },
        );
        const totalPct = totals.targetKg > 0 ? (totals.acceptedKg / totals.targetKg) * 100 : 0;

        return (
          <div key={c.id} className="overflow-hidden rounded-lg border">
            <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-4 py-2.5">
              <span className="font-mono text-sm font-medium">Контракт #{c.id}</span>
              {c.notes && <span className="text-sm text-muted-foreground">{c.notes}</span>}
              <Link
                href={`/contracts?farmer=${farmer.id}&season=${farmer.season}`}
                className="ml-auto text-xs text-primary hover:underline"
              >
                Открыть контракт →
              </Link>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Культура</TableHead>
                  <TableHead className="text-right">План, т</TableHead>
                  <TableHead className="text-right">Принято, т</TableHead>
                  <TableHead className="w-40">Выполнение</TableHead>
                  <TableHead className="text-right">Цена, ₽/кг</TableHead>
                  <TableHead className="text-right">Стоимость, ₽</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block size-2.5 rounded-sm"
                          style={{ backgroundColor: l.color }}
                        />
                        {l.culture_name}
                        {l.label && (
                          <span className="text-xs text-muted-foreground">{l.label}</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.volume_tons}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(l.acceptedKg / 1000, 1)}
                    </TableCell>
                    <TableCell>
                      <ProgressCell pct={l.pct} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.price_per_kg}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(l.costRub)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">Итого по контракту</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {fmtNum(totals.volumeTons, 1)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {fmtNum(totals.acceptedKg / 1000, 1)}
                  </TableCell>
                  <TableCell>
                    <ProgressCell pct={totalPct} />
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right font-medium tabular-nums">
                    {fmtNum(totals.costRub)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/30 px-4 py-3">
        <span className="text-sm font-semibold">
          Итого по фермеру · сезон {farmer.season}
        </span>
        <div className="ml-auto flex flex-wrap items-baseline gap-5">
          <span className="text-sm">
            <span className="text-muted-foreground">план</span>{" "}
            <span className="font-semibold tabular-nums">
              {fmtNum(contracts.farmerTotal.targetKg / 1000, 1)} т
            </span>
          </span>
          <span className="text-sm">
            <span className="text-muted-foreground">принято</span>{" "}
            <span className="font-semibold tabular-nums">
              {fmtNum(contracts.farmerTotal.acceptedKg / 1000, 1)} т
            </span>
          </span>
          <span className="text-sm">
            <span className="text-muted-foreground">выполнение</span>{" "}
            <span className="font-semibold tabular-nums">
              {Math.round(contracts.farmerTotal.pct)}%
            </span>
          </span>
          <span className="text-sm">
            <span className="text-muted-foreground">стоимость</span>{" "}
            <span className="font-semibold tabular-nums">
              {fmtNum(contracts.farmerTotal.costRub)} ₽
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
