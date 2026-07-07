"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";

import type { Farmer } from "@/lib/generated/prisma/client";
import type { FarmerContacts } from "@/server/farmers/schema";
import { setFarmerActive } from "@/server/farmers/actions";
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
import { FarmerFormDialog } from "./FarmerFormDialog";

// contacts хранится объектом в Json-колонке.
function readContacts(value: Farmer["contacts"]): Partial<FarmerContacts> {
  return value && typeof value === "object"
    ? (value as Partial<FarmerContacts>)
    : {};
}

function ContactsCell({ farmer }: { farmer: Farmer }) {
  const c = readContacts(farmer.contacts);
  if (!c.phone) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col">
      <a href={`tel:${normalizePhone(c.phone)}`} className="hover:underline">
        {formatPhone(c.phone)}
      </a>
      {c.contactPerson && (
        <span className="text-xs text-muted-foreground">{c.contactPerson}</span>
      )}
    </div>
  );
}

function DeactivateButton({ farmer }: { farmer: Farmer }) {
  const router = useRouter();

  async function onConfirm() {
    const res = await setFarmerActive(farmer.id, false);
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

function ActivateButton({ farmer }: { farmer: Farmer }) {
  const router = useRouter();

  async function onClick() {
    const res = await setFarmerActive(farmer.id, true);
    if (res.ok) {
      toast.success("Фермер активирован");
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
            <TableCell className="font-medium">
              <Link href={`/reference/farmers/${farmer.id}`} className="hover:underline">
                {farmer.name}
              </Link>
            </TableCell>
            <TableCell>
              <ContactsCell farmer={farmer} />
            </TableCell>
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
                  {farmer.active ? (
                    <DeactivateButton farmer={farmer} />
                  ) : (
                    <ActivateButton farmer={farmer} />
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
