"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";

import type { TransportCompanyRow } from "@/server/transport-companies/schema";
import { setTransportCompanyActive } from "@/server/transport-companies/actions";
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
import { TransportCompanyFormDialog } from "./TransportCompanyFormDialog";

function DeactivateButton({ row }: { row: TransportCompanyRow }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await setTransportCompanyActive(row.id, false);
    if (res.ok) {
      toast.success("Компания деактивирована");
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
          <AlertDialogTitle>Деактивировать компанию?</AlertDialogTitle>
          <AlertDialogDescription>
            «{row.name}» станет неактивной и скроется из списков. Данные и связи
            сохранятся (мягкое удаление).
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

function ActivateButton({ row }: { row: TransportCompanyRow }) {
  const router = useRouter();

  async function onClick() {
    const res = await setTransportCompanyActive(row.id, true);
    if (res.ok) {
      toast.success("Компания активирована");
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

export function TransportCompaniesTable({ rows }: { rows: TransportCompanyRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Название</TableHead>
          <TableHead>Заметки</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead className="w-24 text-right">Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground">
              Ничего не найдено
            </TableCell>
          </TableRow>
        )}
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell>
              {row.notes ? (
                row.notes
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              {row.active ? (
                <Badge variant="secondary">Активна</Badge>
              ) : (
                <Badge variant="outline">Неактивна</Badge>
              )}
            </TableCell>
            <TableCell className="text-right">
              <RoleGate allow={["admin"]}>
                <div className="flex justify-end gap-1">
                  <TransportCompanyFormDialog mode="edit" row={row} />
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
