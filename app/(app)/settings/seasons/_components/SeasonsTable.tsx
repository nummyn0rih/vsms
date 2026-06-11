"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { formatWorkdays, type SeasonRow } from "@/server/seasons/schema";
import { deleteSeason } from "@/server/seasons/actions";
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
import { SeasonFormDialog } from "./SeasonFormDialog";

function DeleteButton({ row }: { row: SeasonRow }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await deleteSeason(row.id);
    if (res.ok) {
      toast.success("Сезон удалён");
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
          <AlertDialogTitle>Удалить сезон {row.season_year}?</AlertDialogTitle>
          <AlertDialogDescription>
            Настройка сезона будет удалена безвозвратно.
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

export function SeasonsTable({ rows }: { rows: SeasonRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Год</TableHead>
          <TableHead>Лето</TableHead>
          <TableHead>Рабочие дни (лето)</TableHead>
          <TableHead>Рабочие дни (зима)</TableHead>
          <TableHead className="w-24 text-right">Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              Сезоны ещё не заведены
            </TableCell>
          </TableRow>
        )}
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">{row.season_year}</TableCell>
            <TableCell>
              {row.summer_start} — {row.summer_end}
            </TableCell>
            <TableCell>{formatWorkdays(row.summer_workdays)}</TableCell>
            <TableCell>{formatWorkdays(row.winter_workdays)}</TableCell>
            <TableCell className="text-right">
              <RoleGate allow={["admin"]}>
                <div className="flex justify-end gap-1">
                  <SeasonFormDialog mode="edit" row={row} />
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
