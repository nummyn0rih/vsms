"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";

import { farmerSchema, type FarmerInput } from "@/server/farmers/schema";
import { createFarmer, updateFarmer } from "@/server/farmers/actions";
import type { Farmer } from "@/lib/generated/prisma/client";
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

type Props =
  | { mode: "create"; farmer?: undefined }
  | { mode: "edit"; farmer: Farmer };

export function FarmerFormDialog({ mode, farmer }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<FarmerInput>({
    resolver: zodResolver(farmerSchema),
    defaultValues: {
      name: farmer?.name ?? "",
      contacts: typeof farmer?.contacts === "string" ? farmer.contacts : "",
      notes: farmer?.notes ?? "",
    },
  });

  async function onSubmit(values: FarmerInput) {
    const res =
      mode === "edit"
        ? await updateFarmer(farmer.id, values)
        : await createFarmer(values);

    if (res.ok) {
      toast.success(mode === "edit" ? "Сохранено" : "Фермер создан");
      setOpen(false);
      if (mode === "create") form.reset();
      router.refresh();
      return;
    }

    // Ошибки валидации с сервера — на конкретные поля; прочие — тостом.
    if (res.fieldErrors) {
      for (const [field, messages] of Object.entries(res.fieldErrors)) {
        if (messages?.[0]) {
          form.setError(field as keyof FarmerInput, { message: messages[0] });
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
            <Plus className="size-4" /> Добавить фермера
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Редактировать фермера" : "Новый фермер"}
          </DialogTitle>
          <DialogDescription>Заполните данные фермера.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Имя</FormLabel>
                  <FormControl>
                    <Input placeholder="Название хозяйства / ФИО" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contacts"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Контакты</FormLabel>
                  <FormControl>
                    <Input placeholder="Телефон, e-mail…" {...field} />
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
                    <Input placeholder="Примечание" {...field} />
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
