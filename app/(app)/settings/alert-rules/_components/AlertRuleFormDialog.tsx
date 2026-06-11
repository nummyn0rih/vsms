"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";

import {
  alertRuleSchema,
  ITEM_KIND_LABELS,
  LOCATION_ANY,
  type AlertRuleInput,
  type AlertRuleRow,
  type ItemOption,
  type FarmerOption,
} from "@/server/alert-rules/schema";
import {
  createAlertRule,
  updateAlertRule,
} from "@/server/alert-rules/actions";
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

type Options = {
  packaging: ItemOption[];
  ingredients: ItemOption[];
  farmers: FarmerOption[];
};

type Props =
  | { mode: "create"; options: Options; row?: undefined }
  | { mode: "edit"; options: Options; row: AlertRuleRow };

export function AlertRuleFormDialog({ mode, row, options }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<AlertRuleInput>({
    resolver: zodResolver(alertRuleSchema),
    defaultValues: {
      item_kind: row?.item_kind ?? "packaging",
      item_id: row ? String(row.item_id) : "",
      location_scope:
        row == null || row.location_scope == null
          ? LOCATION_ANY
          : String(row.location_scope),
      threshold: row ? String(row.threshold) : "",
    },
  });

  // Select позиции зависит от выбранного типа (тара | ингредиент).
  const itemKind = useWatch({ control: form.control, name: "item_kind" });
  const itemOptions =
    itemKind === "packaging" ? options.packaging : options.ingredients;

  // В edit правило может ссылаться на деактивированную позицию (её нет в active-
  // списке). Добавляем опцию, чтобы значение не терялось.
  const shownItems = [...itemOptions];
  if (
    mode === "edit" &&
    row.item_kind === itemKind &&
    !shownItems.some((o) => o.id === row.item_id)
  ) {
    shownItems.unshift({ id: row.item_id, name: `${row.item_name} (неактивна)` });
  }

  async function onSubmit(values: AlertRuleInput) {
    const res =
      mode === "edit"
        ? await updateAlertRule(row.id, values)
        : await createAlertRule(values);

    if (res.ok) {
      toast.success(mode === "edit" ? "Сохранено" : "Правило создано");
      setOpen(false);
      if (mode === "create") form.reset();
      router.refresh();
      return;
    }

    if (res.fieldErrors) {
      for (const [field, messages] of Object.entries(res.fieldErrors)) {
        if (messages?.[0]) {
          form.setError(field as keyof AlertRuleInput, { message: messages[0] });
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
            <Plus className="size-4" /> Добавить правило
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Редактировать правило" : "Новое правило"}
          </DialogTitle>
          <DialogDescription>
            Порог дефицита для тары или ингредиента у фермера.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="item_kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Тип позиции</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      // Смена типа — старая позиция невалидна, сбрасываем.
                      form.setValue("item_id", "");
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите тип" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="packaging">
                        {ITEM_KIND_LABELS.packaging}
                      </SelectItem>
                      <SelectItem value="ingredient">
                        {ITEM_KIND_LABELS.ingredient}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="item_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Позиция</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите позицию" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {shownItems.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          Нет активных позиций
                        </div>
                      ) : (
                        shownItems.map((o) => (
                          <SelectItem key={o.id} value={String(o.id)}>
                            {o.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="location_scope"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Где</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={LOCATION_ANY}>
                        У любого фермера
                      </SelectItem>
                      {options.farmers.map((f) => (
                        <SelectItem key={f.id} value={String(f.id)}>
                          {f.name}
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
              name="threshold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Порог</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="Напр. 100"
                      {...field}
                    />
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
