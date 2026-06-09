"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";

import {
  packagingTypeSchema,
  type PackagingTypeInput,
  type PackagingTypeRow,
} from "@/server/packaging-types/schema";
import {
  createPackagingType,
  updatePackagingType,
} from "@/server/packaging-types/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props =
  | { mode: "create"; row?: undefined }
  | { mode: "edit"; row: PackagingTypeRow };

export function PackagingTypeFormDialog({ mode, row }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<PackagingTypeInput>({
    resolver: zodResolver(packagingTypeSchema),
    defaultValues: {
      name: row?.name ?? "",
      kind: row?.kind ?? "box",
      capacity_kg: row?.capacity_kg != null ? String(row.capacity_kg) : "",
    },
  });

  // Поле ёмкости показываем только для бочки (DOMAIN.md §2).
  // useWatch (а не form.watch) — реактивно и совместимо с React Compiler.
  const kind = useWatch({ control: form.control, name: "kind" });

  async function onSubmit(values: PackagingTypeInput) {
    const res =
      mode === "edit"
        ? await updatePackagingType(row.id, values)
        : await createPackagingType(values);

    if (res.ok) {
      toast.success(mode === "edit" ? "Сохранено" : "Тип тары создан");
      setOpen(false);
      if (mode === "create") form.reset();
      router.refresh();
      return;
    }

    // Ошибки валидации с сервера — на конкретные поля; прочие — тостом.
    if (res.fieldErrors) {
      for (const [field, messages] of Object.entries(res.fieldErrors)) {
        if (messages?.[0]) {
          form.setError(field as keyof PackagingTypeInput, { message: messages[0] });
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
            <Plus className="size-4" /> Добавить тип тары
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Редактировать тип тары" : "Новый тип тары"}
          </DialogTitle>
          <DialogDescription>Заполните данные типа тары.</DialogDescription>
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
                    <Input placeholder="Напр. Ящик овощной" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Тип</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      // Переключение на ящик — ёмкость не нужна, сбрасываем.
                      if (v === "box") form.setValue("capacity_kg", "");
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите тип" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="box">Ящик</SelectItem>
                      <SelectItem value="barrel">Бочка</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {kind === "barrel" && (
              <FormField
                control={form.control}
                name="capacity_kg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ёмкость, кг</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        placeholder="200 / 250"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
