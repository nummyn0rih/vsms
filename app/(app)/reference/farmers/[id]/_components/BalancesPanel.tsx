import { Boxes, FlaskConical, Truck } from "lucide-react";

import type { FarmerCard } from "@/server/farmers/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "./EmptyState";

function fmtNum(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function TransitChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-dashed px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
      <Truck className="size-3" />
      {label}
    </span>
  );
}

// Тара: 3-я колонка «Всего» несёт итоговое количество, «Годная/Лом» неприменимо.
function TareTransitRow({ label, qty }: { label: string; qty: number }) {
  return (
    <TableRow className="bg-muted/30">
      <TableCell>
        <TransitChip label={label} />
      </TableCell>
      <TableCell className="text-right text-muted-foreground">—</TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {fmtNum(qty)} <span className="text-xs text-muted-foreground">шт</span>
      </TableCell>
    </TableRow>
  );
}

// Ингредиенты: колонки «Остаток»/«Ед.» — количество и единица раздельно, как в
// обычных строках.
function IngredientTransitRow({ label, qty, unit }: { label: string; qty: number; unit: string }) {
  return (
    <TableRow className="bg-muted/30">
      <TableCell>
        <TransitChip label={label} />
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">{fmtNum(qty)}</TableCell>
      <TableCell className="text-right text-muted-foreground">{unit}</TableCell>
    </TableRow>
  );
}

export function BalancesPanel({ card }: { card: FarmerCard }) {
  const { tare, ingredients } = card.balances;

  const tareEmpty =
    tare.own.every((r) => r.good === 0 && r.scrap === 0) &&
    tare.transitToFarmer.length === 0 &&
    tare.transitToFactory.length === 0;
  const ingredientsEmpty = ingredients.own.length === 0 && ingredients.transitToFarmer.length === 0;

  if (tareEmpty && ingredientsEmpty) {
    return (
      <EmptyState
        icon={Boxes}
        title="Нулевые балансы"
        description="У поставщика нет тары и ингредиентов на балансе. Строки появятся после первой отгрузки или выдачи материалов."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {!tareEmpty && (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2.5">
            <Boxes className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Тара у поставщика</span>
            <span className="ml-auto text-xs text-muted-foreground">на балансе локации</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Тип тары</TableHead>
                <TableHead className="text-right">Годная / Лом</TableHead>
                <TableHead className="text-right">Всего</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tare.own
                .filter((r) => r.good !== 0 || r.scrap !== 0)
                .map((r) => (
                  <TableRow key={r.typeId}>
                    <TableCell>{r.typeName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(r.good)} <span className="text-muted-foreground">/ {fmtNum(r.scrap)}</span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {fmtNum(r.good + r.scrap)}
                    </TableCell>
                  </TableRow>
                ))}
              {tare.transitToFarmer.map((r) => (
                <TareTransitRow key={`in-${r.typeName}`} label={`в пути · завод → фермер · ${r.typeName}`} qty={r.qty} />
              ))}
              {tare.transitToFactory.map((r) => (
                <TareTransitRow key={`out-${r.typeName}`} label={`в пути · фермер → завод · ${r.typeName}`} qty={r.qty} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!ingredientsEmpty && (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2.5">
            <FlaskConical className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Ингредиенты у поставщика</span>
            <span className="ml-auto text-xs text-muted-foreground">на балансе локации</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Позиция</TableHead>
                <TableHead className="text-right">Остаток</TableHead>
                <TableHead className="text-right">Ед.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ingredients.own.map((r) => (
                <TableRow key={r.name}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{fmtNum(r.qty)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{r.unit}</TableCell>
                </TableRow>
              ))}
              {ingredients.transitToFarmer.map((r) => (
                <IngredientTransitRow key={`ing-${r.name}`} label={`в пути · завод → фермер · ${r.name}`} qty={r.qty} unit={r.unit} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
