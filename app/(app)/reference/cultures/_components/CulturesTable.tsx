"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";

import {
  ACCEPTANCE_TYPE_LABELS,
  type CultureRow,
  type PackagingOption,
} from "@/server/cultures/schema";
import { setCultureActive } from "@/server/cultures/actions";
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
import { CultureFormDialog } from "./CultureFormDialog";

function DeactivateButton({ row }: { row: CultureRow }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await setCultureActive(row.id, false);
    if (res.ok) {
      toast.success("Культура деактивирована");
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
          <AlertDialogTitle>Деактивировать культуру?</AlertDialogTitle>
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

function ActivateButton({ row }: { row: CultureRow }) {
  const router = useRouter();

  async function onClick() {
    const res = await setCultureActive(row.id, true);
    if (res.ok) {
      toast.success("Культура активирована");
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

export function CulturesTable({
  rows,
  packagingOptions,
}: {
  rows: CultureRow[];
  packagingOptions: PackagingOption[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Название</TableHead>
          <TableHead>Тип приёмки</TableHead>
          <TableHead>Тип тары</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead className="w-24 text-right">Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              Ничего не найдено
            </TableCell>
          </TableRow>
        )}
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">
              <span className="flex items-center gap-2">
                {/* Цвет динамический → inline style (Tailwind не умеет рантайм-цвет). */}
                <span
                  className="inline-block size-3 shrink-0 rounded-full border"
                  style={{ backgroundColor: row.color }}
                  title={row.color}
                />
                {row.name}
              </span>
            </TableCell>
            <TableCell>{ACCEPTANCE_TYPE_LABELS[row.acceptance_type]}</TableCell>
            <TableCell>
              {row.packagingTypes.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {row.packagingTypes.map((pt) => (
                    <span
                      key={pt.id}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs"
                      title={pt.is_default ? "Тип по умолчанию" : undefined}
                    >
                      {pt.is_default && <span className="text-amber-500">★</span>}
                      {pt.name}
                      {!pt.active && (
                        <span className="text-muted-foreground">(неактивен)</span>
                      )}
                    </span>
                  ))}
                </span>
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
                  <CultureFormDialog
                    mode="edit"
                    row={row}
                    packagingOptions={packagingOptions}
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
