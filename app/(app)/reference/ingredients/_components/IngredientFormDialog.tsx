"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";

import {
  ingredientSchema,
  INGREDIENT_UNIT_LABELS,
  type IngredientInput,
  type IngredientRow,
} from "@/server/ingredients/schema";
import { createIngredient, updateIngredient } from "@/server/ingredients/actions";
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
  | { mode: "edit"; row: IngredientRow };

export function IngredientFormDialog({ mode, row }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<IngredientInput>({
    resolver: zodResolver(ingredientSchema),
    defaultValues: {
      name: row?.name ?? "",
      unit: row?.unit ?? "kg",
    },
  });

  async function onSubmit(values: IngredientInput) {
    const res =
      mode === "edit"
        ? await updateIngredient(row.id, values)
        : await createIngredient(values);

    if (res.ok) {
      toast.success(mode === "edit" ? "Сохранено" : "Ингредиент создан");
      setOpen(false);
      if (mode === "create") form.reset();
      router.refresh();
      return;
    }

    // Ошибки валидации с сервера — на конкретные поля; прочие — тостом.
    if (res.fieldErrors) {
      for (const [field, messages] of Object.entries(res.fieldErrors)) {
        if (messages?.[0]) {
          form.setError(field as keyof IngredientInput, { message: messages[0] });
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
            <Plus className="size-4" /> Добавить ингредиент
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Редактировать ингредиент" : "Новый ингредиент"}
          </DialogTitle>
          <DialogDescription>Заполните данные ингредиента.</DialogDescription>
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
                    <Input placeholder="Напр. Соль" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="unit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Единица измерения</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите единицу" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="kg">{INGREDIENT_UNIT_LABELS.kg}</SelectItem>
                      <SelectItem value="l">{INGREDIENT_UNIT_LABELS.l}</SelectItem>
                    </SelectContent>
                  </Select>
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
