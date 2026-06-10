"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";

import {
  driverSchema,
  type DriverInput,
  type DriverRow,
  type TransportCompanyOption,
} from "@/server/drivers/schema";
import { createDriver, updateDriver } from "@/server/drivers/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props =
  | { mode: "create"; companyOptions: TransportCompanyOption[]; row?: undefined }
  | { mode: "edit"; companyOptions: TransportCompanyOption[]; row: DriverRow };

export function DriverFormDialog({ mode, row, companyOptions }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<DriverInput>({
    resolver: zodResolver(driverSchema),
    defaultValues: {
      full_name: row?.full_name ?? "",
      phone: row?.phone ?? "",
      transport_company_id:
        row?.transport_company_id != null ? String(row.transport_company_id) : "",
      info: row?.info ?? "",
    },
  });

  // В edit-режиме водитель может быть привязан к уже деактивированной ТК
  // (её нет в active-списке). Добавляем её опцией, чтобы значение не терялось
  // и Select не падал (паттерн как у Culture→PackagingType).
  const options = [...companyOptions];
  if (
    mode === "edit" &&
    row.transport_company_id != null &&
    !options.some((o) => o.id === row.transport_company_id)
  ) {
    options.unshift({
      id: row.transport_company_id,
      name: `${row.transport_company_name ?? "Компания"} (неактивна)`,
    });
  }

  async function onSubmit(values: DriverInput) {
    const res =
      mode === "edit"
        ? await updateDriver(row.id, values)
        : await createDriver(values);

    if (res.ok) {
      toast.success(mode === "edit" ? "Сохранено" : "Водитель создан");
      setOpen(false);
      if (mode === "create") form.reset();
      router.refresh();
      return;
    }

    // Ошибки валидации с сервера — на конкретные поля; прочие — тостом.
    if (res.fieldErrors) {
      for (const [field, messages] of Object.entries(res.fieldErrors)) {
        if (messages?.[0]) {
          form.setError(field as keyof DriverInput, { message: messages[0] });
        }
      }
    } else {
      toast.error(res.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "edit" ? (
          <Button variant="ghost" size="icon-sm" title="Редактировать">
            <Pencil className="size-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="size-4" /> Добавить водителя
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Редактировать водителя" : "Новый водитель"}
          </DialogTitle>
          <DialogDescription>Заполните данные водителя.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ФИО</FormLabel>
                  <FormControl>
                    <Input placeholder="Напр. Иванов Иван Иванович" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Телефон</FormLabel>
                  <FormControl>
                    <Input placeholder="+7 999 123-45-67" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="transport_company_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Транспортная компания</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите компанию" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {options.map((o) => (
                        <SelectItem key={o.id} value={String(o.id)}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="info"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Инфо</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Данные о машине, заметки" {...field} />
                  </FormControl>
                  <FormDescription>Данные о машине, заметки.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Сохранение…" : "Сохранить"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
