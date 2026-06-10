"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";

import {
  transportCompanySchema,
  type TransportCompanyInput,
  type TransportCompanyRow,
} from "@/server/transport-companies/schema";
import {
  createTransportCompany,
  updateTransportCompany,
} from "@/server/transport-companies/actions";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props =
  | { mode: "create"; row?: undefined }
  | { mode: "edit"; row: TransportCompanyRow };

export function TransportCompanyFormDialog({ mode, row }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<TransportCompanyInput>({
    resolver: zodResolver(transportCompanySchema),
    defaultValues: {
      name: row?.name ?? "",
      notes: row?.notes ?? "",
    },
  });

  async function onSubmit(values: TransportCompanyInput) {
    const res =
      mode === "edit"
        ? await updateTransportCompany(row.id, values)
        : await createTransportCompany(values);

    if (res.ok) {
      toast.success(mode === "edit" ? "Сохранено" : "Компания создана");
      setOpen(false);
      if (mode === "create") form.reset();
      router.refresh();
      return;
    }

    // Ошибки валидации с сервера — на конкретные поля; прочие — тостом.
    if (res.fieldErrors) {
      for (const [field, messages] of Object.entries(res.fieldErrors)) {
        if (messages?.[0]) {
          form.setError(field as keyof TransportCompanyInput, { message: messages[0] });
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
            <Plus className="size-4" /> Добавить компанию
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Редактировать компанию" : "Новая компания"}
          </DialogTitle>
          <DialogDescription>Заполните данные транспортной компании.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Название</FormLabel>
                  <FormControl>
                    <Input placeholder="Напр. АвтоЛогистика" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Заметки</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Примечание" {...field} />
                  </FormControl>
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
