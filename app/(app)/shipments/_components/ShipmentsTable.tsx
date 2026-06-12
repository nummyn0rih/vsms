"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";

import { getShipment, deleteShipment } from "@/server/shipments/actions";
import type {
  ShipmentListRow,
  ShipmentDetail,
  ShipmentOptions,
} from "@/server/shipments/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ShipmentFormDialog } from "./ShipmentFormDialog";

// Статус-бейджи (CLAUDE.md «Дизайн»). Цвет/фон зашиты как токены статусов.
const STATUS_STYLE: Record<
  ShipmentListRow["status"],
  { label: string; color: string; bg: string }
> = {
  planned: { label: "Черновик", color: "#888888", bg: "#f5f5f5" },
  sent: { label: "Отправлена", color: "#0070f3", bg: "#d3e5ff" },
  arrived: { label: "Прибыла", color: "#f5a623", bg: "#ffefcf" },
  accepted: { label: "Принята", color: "#29bc9b", bg: "#aaffec" },
};

function StatusBadge({ status }: { status: ShipmentListRow["status"] }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ color: s.color, backgroundColor: s.bg }}
    >
      {s.label}
    </span>
  );
}

// Вес с разделением тысяч и tabular-nums (числа выровнены).
const nf = new Intl.NumberFormat("ru-RU");
function formatWeight(kg: string): string {
  return nf.format(Number(kg));
}

export function ShipmentsTable({
  rows,
  options,
}: {
  rows: ShipmentListRow[];
  options: ShipmentOptions;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">№</TableHead>
          <TableHead className="w-44">Даты</TableHead>
          <TableHead className="w-32">Статус</TableHead>
          <TableHead className="w-48">Водитель · ТК</TableHead>
          <TableHead>Позиции</TableHead>
          <TableHead>Комментарий</TableHead>
          <TableHead className="w-24 text-right">Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground">
              Отгрузок нет
            </TableCell>
          </TableRow>
        )}
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono tabular-nums">{row.code}</TableCell>
            <TableCell className="font-mono text-xs tabular-nums">
              {row.departure_date ?? "—"} → {row.arrival_date ?? "—"}
            </TableCell>
            <TableCell>
              <StatusBadge status={row.status} />
            </TableCell>
            <TableCell>
              {row.driver_name ? (
                <span>
                  {row.driver_name}
                  {row.transport_company_name && (
                    <span className="text-muted-foreground">
                      {" · "}
                      {row.transport_company_name}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">не назначен</span>
              )}
            </TableCell>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                {row.items.map((it) => (
                  <span key={it.id} className="flex items-center gap-1.5 text-sm">
                    <span
                      className="inline-block size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: it.color }}
                    />
                    <span>{it.culture_name}</span>
                    <span className="tabular-nums">
                      {formatWeight(it.planned_weight_kg)} кг
                    </span>
                    <span className="text-muted-foreground">— {it.farmer_name}</span>
                  </span>
                ))}
              </div>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {row.comment ?? ""}
            </TableCell>
            <TableCell className="text-right">
              <RoleGate allow={["admin"]}>
                <div className="flex justify-end gap-1">
                  <EditShipmentButton id={row.id} options={options} />
                  <DeleteShipmentButton row={row} />
                </div>
              </RoleGate>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Правка: деталь грузим лениво по клику, открываем форму в edit (контролируемый open).
function EditShipmentButton({
  id,
  options,
}: {
  id: number;
  options: ShipmentOptions;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);

  async function onClick() {
    const d = await getShipment(id);
    if (!d) {
      toast.error("Отгрузка не найдена");
      return;
    }
    setDetail(d);
    setOpen(true);
  }

  return (
    <>
      <Button variant="ghost" size="icon-sm" title="Редактировать" onClick={onClick}>
        <Pencil className="size-4" />
      </Button>
      {detail && (
        <ShipmentFormDialog
          mode="edit"
          row={detail}
          options={options}
          open={open}
          onOpenChange={setOpen}
          showTrigger={false}
        />
      )}
    </>
  );
}

function DeleteShipmentButton({ row }: { row: ShipmentListRow }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await deleteShipment(row.id);
    if (res.ok) {
      toast.success("Отгрузка удалена");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Удалить">
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить отгрузку №{row.code}?</AlertDialogTitle>
          <AlertDialogDescription>
            Черновик отгрузки и все его позиции будут удалены безвозвратно.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Удалить</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
