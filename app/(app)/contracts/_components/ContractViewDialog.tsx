"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import { getContractView } from "@/server/contracts/actions";
import type { ContractDetailView } from "@/server/contracts/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Карточка контракта (read-only): шапка + таблица строк. Детали с ценой грузим
// лениво при открытии (в списке цены нет — только агрегаты).
export function ContractViewDialog({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ContractDetailView | null>(null);
  const [loading, setLoading] = useState(false);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && !detail) {
      setLoading(true);
      const d = await getContractView(id);
      setDetail(d);
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Просмотр">
          <Eye className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {detail ? `Контракт: ${detail.farmer_name}` : "Контракт"}
          </DialogTitle>
          <DialogDescription>
            {detail ? `Сезон ${detail.season_year}` : "Загрузка…"}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        )}

        {detail && (
          <div className="grid gap-4">
            {detail.notes && (
              <p className="text-sm text-muted-foreground">{detail.notes}</p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Культура</TableHead>
                  <TableHead>Метка</TableHead>
                  <TableHead className="text-right">Объём, т</TableHead>
                  <TableHead className="text-right">Цена, ₽/кг</TableHead>
                  <TableHead className="text-right">Принято, кг</TableHead>
                  <TableHead className="w-40">Выполнение</TableHead>
                  <TableHead className="text-right">Стоимость, ₽</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block size-3 rounded-full"
                          style={{ backgroundColor: l.color }}
                        />
                        {l.culture_name}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {l.label || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.volume_tons}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.price_per_kg}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Math.round(l.acceptedKg).toLocaleString("ru-RU")}
                    </TableCell>
                    <TableCell>
                      <ProgressCell pct={l.pct} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Math.round(l.costRub).toLocaleString("ru-RU")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {detail.hasMissingLine && (
              <p className="text-xs text-muted-foreground">
                Есть принятый вес без привязанной строки контракта — он не учтён в
                стоимости.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Компактный прогресс выполнения строки: текст «{pct}%» + тонкая нейтральная полоса.
// Перевыполнение (>100%): полоса упёрта в 100%, текст помечен акцентом.
function ProgressCell({ pct }: { pct: number }) {
  const over = pct > 100;
  const width = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${over ? "bg-foreground" : "bg-foreground/70"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span
        className={`w-12 shrink-0 text-right text-xs tabular-nums ${
          over ? "font-medium text-foreground" : "text-muted-foreground"
        }`}
      >
        {Math.round(pct)}%
      </span>
    </div>
  );
}
