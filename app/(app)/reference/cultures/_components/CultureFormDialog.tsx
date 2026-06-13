"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  cultureSchema,
  ACCEPTANCE_TYPE_LABELS,
  type CultureInput,
  type CultureRow,
  type PackagingOption,
} from "@/server/cultures/schema";
import { createCulture, updateCulture } from "@/server/cultures/actions";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_COLOR = "#22c55e";

type Props =
  | { mode: "create"; packagingOptions: PackagingOption[]; row?: undefined }
  | { mode: "edit"; packagingOptions: PackagingOption[]; row: CultureRow };

export function CultureFormDialog({ mode, row, packagingOptions }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm<CultureInput>({
    resolver: zodResolver(cultureSchema),
    defaultValues: {
      name: row?.name ?? "",
      color: row?.color ?? DEFAULT_COLOR,
      acceptance_type: row?.acceptance_type ?? "simple",
      packaging_type_ids: row?.packagingTypes.map((pt) => String(pt.id)) ?? [],
      default_packaging_type_id:
        row?.packagingTypes.find((pt) => pt.is_default)?.id.toString() ?? "",
      ranges: row?.ranges ?? [],
    },
  });

  // Блок калибров показываем только при acceptance_type=calibre (RHF watch).
  const acceptanceType = useWatch({ control: form.control, name: "acceptance_type" });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "ranges",
  });

  // Предупреждение о «дырах» между диапазонами — НЕ блокирует сохранение
  // (бизнес может намеренно оставить пропуск). Считаем по отсортированным min.
  const watchedRanges = useWatch({ control: form.control, name: "ranges" });
  const hasGap = (() => {
    const sorted = (watchedRanges ?? [])
      .map((r) => ({ min: Number(r.min_cm), max: r.max_cm ? Number(r.max_cm) : null }))
      .filter((r) => Number.isFinite(r.min))
      .sort((a, b) => a.min - b.min);
    for (let k = 1; k < sorted.length; k++) {
      const prevMax = sorted[k - 1].max;
      if (prevMax != null && sorted[k].min > prevMax) return true;
    }
    return false;
  })();

  // Опции типов тары = активные + (в edit) уже выбранные, но деактивированные
  // (FK-Select паттерн: не теряем текущую связь). Помечаем неактивные.
  const typeOptions: (PackagingOption & { inactive?: boolean })[] = [
    ...packagingOptions,
  ];
  if (mode === "edit") {
    for (const pt of row.packagingTypes) {
      if (!typeOptions.some((o) => o.id === pt.id)) {
        typeOptions.push({ id: pt.id, name: pt.name, inactive: true });
      }
    }
  }

  const selectedTypeIds = useWatch({
    control: form.control,
    name: "packaging_type_ids",
  });
  const defaultTypeId = useWatch({
    control: form.control,
    name: "default_packaging_type_id",
  });

  // Чек/расчек типа: при добавлении первого — сразу дефолт; при снятии дефолта —
  // дефолт уезжает на первый оставшийся (или пусто).
  function toggleType(id: string, checked: boolean) {
    const cur = selectedTypeIds ?? [];
    const next = checked ? [...cur, id] : cur.filter((v) => v !== id);
    form.setValue("packaging_type_ids", next, { shouldValidate: true });
    if (checked && next.length === 1) {
      form.setValue("default_packaging_type_id", id, { shouldValidate: true });
    } else if (!checked && defaultTypeId === id) {
      form.setValue("default_packaging_type_id", next[0] ?? "", {
        shouldValidate: true,
      });
    }
  }

  async function onSubmit(values: CultureInput) {
    const res =
      mode === "edit"
        ? await updateCulture(row.id, values)
        : await createCulture(values);

    if (res.ok) {
      toast.success(mode === "edit" ? "Сохранено" : "Культура создана");
      setOpen(false);
      if (mode === "create") form.reset();
      router.refresh();
      return;
    }

    // Ошибки валидации с сервера — на конкретные поля; прочие — тостом.
    if (res.fieldErrors) {
      for (const [field, messages] of Object.entries(res.fieldErrors)) {
        if (messages?.[0]) {
          form.setError(field as keyof CultureInput, { message: messages[0] });
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
            <Plus className="size-4" /> Добавить культуру
          </Button>
        )}
      </DialogTrigger>

      {/* Flex-колонка: header и footer закреплены (shrink-0), середина скроллится.
          max-h-[85vh] — модалка не вылезает за экран при 10+ категориях. */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-0">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {mode === "edit" ? "Редактировать культуру" : "Новая культура"}
          </DialogTitle>
          <DialogDescription>Заполните данные культуры.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col"
          >
            {/* Скроллируемый контент: ошибки нижних категорий видны при прокрутке. */}
            <div className="grid flex-1 gap-4 overflow-y-auto px-1 py-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Название</FormLabel>
                  <FormControl>
                    <Input placeholder="Напр. Томаты" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Цвет</FormLabel>
                  <FormControl>
                    {/* Нативный color picker + текстовое поле hex (оба на field). */}
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        className="h-9 w-12 cursor-pointer rounded border bg-transparent p-1"
                        value={field.value}
                        onChange={field.onChange}
                      />
                      <Input
                        placeholder="#RRGGBB"
                        className="font-mono"
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="acceptance_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Тип приёмки</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите тип приёмки" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="simple">
                        {ACCEPTANCE_TYPE_LABELS.simple}
                      </SelectItem>
                      <SelectItem value="calibre">
                        {ACCEPTANCE_TYPE_LABELS.calibre}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Типы тары: чекбокс = разрешён, radio = дефолтный (один из выбранных).
                Ни одного = навал (без тары). */}
            <FormItem>
              <FormLabel>Типы тары</FormLabel>
              <div className="grid gap-1.5 rounded-md border p-3">
                {typeOptions.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Нет активных типов тары — заведите в справочнике.
                  </p>
                )}
                {typeOptions.map((o) => {
                  const idStr = String(o.id);
                  const checked = (selectedTypeIds ?? []).includes(idStr);
                  return (
                    <div key={o.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`pt-${o.id}`}
                        checked={checked}
                        onChange={(e) => toggleType(idStr, e.target.checked)}
                        className="size-4"
                      />
                      <label htmlFor={`pt-${o.id}`} className="flex-1 text-sm">
                        {o.name}
                        {o.inactive && (
                          <span className="text-muted-foreground"> (неактивен)</span>
                        )}
                      </label>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input
                          type="radio"
                          name="default_packaging_type"
                          disabled={!checked}
                          checked={defaultTypeId === idStr}
                          onChange={() =>
                            form.setValue("default_packaging_type_id", idStr, {
                              shouldValidate: true,
                            })
                          }
                          className="size-3.5"
                        />
                        по умолчанию
                      </label>
                    </div>
                  );
                })}
              </div>
              {form.formState.errors.default_packaging_type_id && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.default_packaging_type_id.message}
                </p>
              )}
            </FormItem>

            {/* Блок калибров — только для acceptance_type=calibre. Здесь задаются
                ТОЛЬКО диапазоны (границы + принят/не принят), без процентов:
                проценты вносятся на приёмке (CalibreResult). */}
            {acceptanceType === "calibre" && (
              <div className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Калибры</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      append({ label: "", min_cm: "", max_cm: "", is_accepted: true })
                    }
                  >
                    <Plus className="size-4" /> Диапазон
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Границы в см необязательны. Оба поля пустые = безразмерная категория
                  (например «Брак»). Верхнюю размерную можно оставить открытой (пустой «до»).
                </p>

                {fields.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Нет диапазонов — добавьте хотя бы один.
                  </p>
                )}

                {fields.map((f, i) => (
                  <div key={f.id} className="grid gap-2 rounded border p-2">
                    <div className="flex items-end gap-2">
                      <FormField
                        control={form.control}
                        name={`ranges.${i}.label`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel className="text-xs">Метка</FormLabel>
                            <FormControl>
                              <Input placeholder="6-9" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`ranges.${i}.min_cm`}
                        render={({ field }) => (
                          <FormItem className="w-20">
                            <FormLabel className="text-xs">от, см</FormLabel>
                            <FormControl>
                              <Input type="number" inputMode="decimal" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`ranges.${i}.max_cm`}
                        render={({ field }) => (
                          <FormItem className="w-20">
                            <FormLabel className="text-xs">до, см</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                inputMode="decimal"
                                placeholder="∞"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        title="Удалить диапазон"
                        onClick={() => remove(i)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name={`ranges.${i}.is_accepted`}
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="text-xs font-normal">
                            Принимается
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  </div>
                ))}

                {/* Ошибка уровня массива (нет диапазонов, нет принятых, пересечение). */}
                {form.formState.errors.ranges?.message && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.ranges.message}
                  </p>
                )}
                {/* Предупреждение о дырах — не блокирует сохранение. */}
                {hasGap && (
                  <p className="text-sm text-amber-600">
                    Между диапазонами есть пропуск — это допустимо, но проверьте.
                  </p>
                )}
              </div>
            )}
            </div>

            <DialogFooter className="shrink-0">
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
