"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import type { Farmer } from "@/lib/generated/prisma/client";
import { deactivateFarmer } from "@/server/farmers/actions";
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
import { FarmerFormDialog } from "./FarmerFormDialog";

function contactsText(value: Farmer["contacts"]) {
  return typeof value === "string" && value.length > 0 ? value : "—";
}

function DeactivateButton({ farmer }: { farmer: Farmer }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await deactivateFarmer(farmer.id);
    if (res.ok) {
      toast.success("Фермер деактивирован");
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
          <AlertDialogTitle>Деактивировать фермера?</AlertDialogTitle>
          <AlertDialogDescription>
            «{farmer.name}» станет неактивным и скроется из списков. Данные и связи
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

export function FarmersTable({ farmers }: { farmers: Farmer[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Имя</TableHead>
          <TableHead>Контакты</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead className="w-24 text-right">Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {farmers.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground">
              Ничего не найдено
            </TableCell>
          </TableRow>
        )}
        {farmers.map((farmer) => (
          <TableRow key={farmer.id}>
            <TableCell className="font-medium">{farmer.name}</TableCell>
            <TableCell>{contactsText(farmer.contacts)}</TableCell>
            <TableCell>
              {farmer.active ? (
                <Badge variant="secondary">Активен</Badge>
              ) : (
                <Badge variant="outline">Неактивен</Badge>
              )}
            </TableCell>
            <TableCell className="text-right">
              <RoleGate allow={["admin"]}>
                <div className="flex justify-end gap-1">
                  <FarmerFormDialog mode="edit" farmer={farmer} />
                  {farmer.active && <DeactivateButton farmer={farmer} />}
                </div>
              </RoleGate>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
