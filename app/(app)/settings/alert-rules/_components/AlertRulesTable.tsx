"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import {
  ITEM_KIND_LABELS,
  type AlertRuleRow,
  type ItemOption,
  type FarmerOption,
} from "@/server/alert-rules/schema";
import { deleteAlertRule } from "@/server/alert-rules/actions";
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
import { AlertRuleFormDialog } from "./AlertRuleFormDialog";

type Options = {
  packaging: ItemOption[];
  ingredients: ItemOption[];
  farmers: FarmerOption[];
};

function DeleteButton({ row }: { row: AlertRuleRow }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await deleteAlertRule(row.id);
    if (res.ok) {
      toast.success("Правило удалено");
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
          <AlertDialogTitle>Удалить правило?</AlertDialogTitle>
          <AlertDialogDescription>
            Порог «{row.item_name}» ({row.location_name}) будет удалён безвозвратно.
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

export function AlertRulesTable({
  rows,
  options,
}: {
  rows: AlertRuleRow[];
  options: Options;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Тип</TableHead>
          <TableHead>Позиция</TableHead>
          <TableHead>Где</TableHead>
          <TableHead>Порог</TableHead>
          <TableHead className="w-24 text-right">Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              Пороги ещё не заданы
            </TableCell>
          </TableRow>
        )}
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Badge variant="secondary">{ITEM_KIND_LABELS[row.item_kind]}</Badge>
            </TableCell>
            <TableCell className="font-medium">{row.item_name}</TableCell>
            <TableCell>{row.location_name}</TableCell>
            <TableCell>{row.threshold}</TableCell>
            <TableCell className="text-right">
              <RoleGate allow={["admin"]}>
                <div className="flex justify-end gap-1">
                  <AlertRuleFormDialog mode="edit" row={row} options={options} />
                  <DeleteButton row={row} />
                </div>
              </RoleGate>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
