"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import { getContract } from "@/server/contracts/actions";
import type { ContractDetail } from "@/server/contracts/schema";
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
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(false);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && !detail) {
      setLoading(true);
      const d = await getContract(id);
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
      <DialogContent className="sm:max-w-2xl">
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
                    <TableCell className="text-right">{l.volume_tons}</TableCell>
                    <TableCell className="text-right">{l.price_per_kg}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
