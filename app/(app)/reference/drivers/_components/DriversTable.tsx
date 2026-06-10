"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";

import type { DriverRow, TransportCompanyOption } from "@/server/drivers/schema";
import { setDriverActive } from "@/server/drivers/actions";
import { normalizePhone, formatPhone } from "@/lib/validators";
import { RoleGate } from "@/components/auth/RoleGate";
import { Badge } from "@/components/ui/badge";
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
import { DriverFormDialog } from "./DriverFormDialog";

function DeactivateButton({ row }: { row: DriverRow }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await setDriverActive(row.id, false);
    if (res.ok) {
      toast.success("Водитель деактивирован");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Деактивировать">
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Деактивировать водителя?</AlertDialogTitle>
          <AlertDialogDescription>
            «{row.full_name}» станет неактивным и скроется из списков. Данные и
            связи сохранятся (мягкое удаление).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Деактивировать</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ActivateButton({ row }: { row: DriverRow }) {
  const router = useRouter();

  async function onClick() {
    const res = await setDriverActive(row.id, true);
    if (res.ok) {
      toast.success("Водитель активирован");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <Button variant="ghost" size="icon-sm" title="Активировать" onClick={onClick}>
      <RotateCcw className="size-4" />
    </Button>
  );
}

export function DriversTable({
  rows,
  companyOptions,
}: {
  rows: DriverRow[];
  companyOptions: TransportCompanyOption[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ФИО</TableHead>
          <TableHead>Телефон</TableHead>
          <TableHead>Компания</TableHead>
          <TableHead>Инфо</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead className="w-24 text-right">Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground">
              Ничего не найдено
            </TableCell>
          </TableRow>
        )}
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">{row.full_name}</TableCell>
            <TableCell>
              {row.phone ? (
                <a
                  href={`tel:${normalizePhone(row.phone)}`}
                  className="hover:underline"
                >
                  {formatPhone(row.phone)}
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              {row.transport_company_name ?? (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">
              {row.info ?? "—"}
            </TableCell>
            <TableCell>
              {row.active ? (
                <Badge variant="secondary">Активен</Badge>
              ) : (
                <Badge variant="outline">Неактивен</Badge>
              )}
            </TableCell>
            <TableCell className="text-right">
              <RoleGate allow={["admin"]}>
                <div className="flex justify-end gap-1">
                  <DriverFormDialog
                    mode="edit"
                    row={row}
                    companyOptions={companyOptions}
                  />
                  {row.active ? (
                    <DeactivateButton row={row} />
                  ) : (
                    <ActivateButton row={row} />
                  )}
                </div>
              </RoleGate>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
