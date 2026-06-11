"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import {
  getContract,
  deleteContract,
} from "@/server/contracts/actions";
import type {
  ContractListRow,
  ContractDetail,
  FarmerOption,
  SeasonOption,
  CultureOption,
} from "@/server/contracts/schema";
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
import { Pencil } from "lucide-react";
import { ContractViewDialog } from "./ContractViewDialog";
import { ContractFormDialog } from "./ContractFormDialog";

type Options = {
  farmers: FarmerOption[];
  seasons: SeasonOption[];
  cultures: CultureOption[];
};

export function ContractsTable({
  rows,
  options,
}: {
  rows: ContractListRow[];
  options: Options;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Фермер</TableHead>
          <TableHead className="w-24">Сезон</TableHead>
          <TableHead className="w-20 text-right">Строк</TableHead>
          <TableHead>Объём по культурам</TableHead>
          <TableHead className="w-32 text-right">Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              Контрактов нет
            </TableCell>
          </TableRow>
        )}
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">{row.farmer_name}</TableCell>
            <TableCell>{row.season_year}</TableCell>
            <TableCell className="text-right">{row.lines_count}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                {row.volume_by_culture.map((v) => (
                  <span
                    key={v.culture_id}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
                  >
                    <span
                      className="inline-block size-2.5 rounded-full"
                      style={{ backgroundColor: v.color }}
                    />
                    {v.culture_name}: {v.tons} т
                  </span>
                ))}
              </div>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <ContractViewDialog id={row.id} />
                <RoleGate allow={["admin"]}>
                  <EditContractButton id={row.id} options={options} />
                  <DeleteContractButton row={row} />
                </RoleGate>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Правка: деталь контракта (со строками+ценами) грузим лениво по клику, затем
// открываем форму в edit-режиме (контролируемый open, без собственного триггера).
function EditContractButton({ id, options }: { id: number; options: Options }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ContractDetail | null>(null);

  async function onClick() {
    if (!detail) {
      const d = await getContract(id);
      if (!d) {
        toast.error("Контракт не найден");
        return;
      }
      setDetail(d);
    }
    setOpen(true);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Редактировать"
        onClick={onClick}
      >
        <Pencil className="size-4" />
      </Button>
      {detail && (
        <ContractFormDialog
          mode="edit"
          row={detail}
          open={open}
          onOpenChange={setOpen}
          showTrigger={false}
          {...options}
        />
      )}
    </>
  );
}

function DeleteContractButton({ row }: { row: ContractListRow }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await deleteContract(row.id);
    if (res.ok) {
      toast.success("Контракт удалён");
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
          <AlertDialogTitle>Удалить контракт?</AlertDialogTitle>
          <AlertDialogDescription>
            Контракт «{row.farmer_name}, сезон {row.season_year}» и все его строки
            будут удалены безвозвратно. Если строки используются в отгрузках или
            приёмке — удаление будет заблокировано.
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
