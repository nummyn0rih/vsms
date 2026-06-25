"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  useForm,
  useFieldArray,
  useWatch,
  type Control,
  type UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import {
  materialShipmentSchema,
  MAX_ITEMS,
  type MaterialShipmentInput,
  type MaterialDetail,
  type MaterialOptions,
  type MaterialPackagingOption,
  type MaterialIngredientOption,
  type MaterialFarmerOption,
} from "@/server/materials/schema";
import { INGREDIENT_UNIT_LABELS } from "@/server/ingredients/schema";
import {
  createMaterialShipment,
  updateMaterialShipment,
} from "@/server/materials/actions";
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
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./material-status";

// Сдвиг даты YYYY-MM-DD на N дней (через UTC). BR-12: вторая дата ±2 дня.
const TRIP_DAYS = 2;
function shiftDate(s: string, days: number): string {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type CommonProps = {
  options: MaterialOptions;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
};

type Props =
  | ({ mode: "create"; row?: undefined } & CommonProps)
  | ({ mode: "edit"; row: MaterialDetail } & CommonProps);

const EMPTY_ITEM = {
  farmer_id: "",
  item_kind: "packaging" as const,
  packaging_type_id: "",
  ingredient_id: "",
  quantity: "",
};

export function MaterialFormDialog(props: Props) {
  const { mode, options, showTrigger = true } = props;
  const row = mode === "edit" ? props.row : undefined;
  // Правка только на planned. sent+ открываем read-only (откатите статус).
  const readOnly = mode === "edit" && row!.status !== "planned";
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = props.open !== undefined;
  const open = controlled ? props.open! : internalOpen;
  const setOpen = (v: boolean) => {
    if (controlled) props.onOpenChange?.(v);
    else setInternalOpen(v);
  };

  // FK-Select: подмешиваем выбранные в рейсе фермеров/типы тары/ингредиенты, которых
  // нет в активных опциях (деактивированы) — чтобы привязка не «потерялась» при правке.
  const farmerOptions = [...options.farmers];
  const packagingOptions = [...options.packagingTypes];
  const ingredientOptions = [...options.ingredients];
  if (row) {
    for (const it of row.items) {
      if (!farmerOptions.some((f) => f.id === it.farmer_id)) {
        farmerOptions.push({ id: it.farmer_id, name: `${it.farmer_name} (неактивен)` });
      }
      if (it.item_kind === "ingredient" && it.ingredient_id != null) {
        if (!ingredientOptions.some((g) => g.id === it.ingredient_id)) {
          ingredientOptions.push({
            id: it.ingredient_id,
            name: `${it.ingredient_name ?? "ингредиент"} (неактивен)`,
            unit: it.ingredient_unit ?? "kg",
          });
        }
      } else if (it.item_kind === "packaging" && it.packaging_type_id != null) {
        if (!packagingOptions.some((p) => p.id === it.packaging_type_id)) {
          packagingOptions.push({
            id: it.packaging_type_id,
            name: `${it.packaging_type_name ?? "тара"} (неактивен)`,
            kind: it.packaging_kind ?? "box",
            capacity_kg: it.capacity_kg,
          });
        }
      }
    }
  }

  const form = useForm<MaterialShipmentInput>({
    resolver: zodResolver(materialShipmentSchema),
    defaultValues: {
      driver_id: row?.driver_id != null ? String(row.driver_id) : "",
      source_farmer_id:
        row?.source_farmer_id != null ? String(row.source_farmer_id) : "",
      departure_date: row?.departure_date ?? "",
      arrival_date: row?.arrival_date ?? "",
      items: row
        ? row.items.map((it) => ({
            farmer_id: String(it.farmer_id),
            item_kind: it.item_kind,
            packaging_type_id:
              it.packaging_type_id != null ? String(it.packaging_type_id) : "",
            ingredient_id: it.ingredient_id != null ? String(it.ingredient_id) : "",
            quantity: it.quantity,
          }))
        : [{ ...EMPTY_ITEM }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  function onDepartureChange(value: string) {
    form.setValue("departure_date", value);
    if (value && !form.getValues("arrival_date")) {
      form.setValue("arrival_date", shiftDate(value, TRIP_DAYS));
    }
  }
  function onArrivalChange(value: string) {
    form.setValue("arrival_date", value);
    if (value && !form.getValues("departure_date")) {
      form.setValue("departure_date", shiftDate(value, -TRIP_DAYS));
    }
  }

  const driverOptions: ComboboxOption[] = options.drivers.map((d) => ({
    value: String(d.id),
    label: d.transport_company_name
      ? `${d.full_name} · ${d.transport_company_name}`
      : d.full_name,
  }));

  // Источник переноса: «Завод» (value "") + фермеры. При правке переноса от ныне
  // неактивного фермера подмешиваем его id (имени в MaterialDetail нет — архивный лейбл).
  const sourceFarmerList = [...options.farmers];
  if (
    row?.source_farmer_id != null &&
    !sourceFarmerList.some((f) => f.id === row.source_farmer_id)
  ) {
    sourceFarmerList.push({
      id: row.source_farmer_id,
      name: `Фермер #${row.source_farmer_id} (неактивен)`,
    });
  }
  const sourceOptions: ComboboxOption[] = [
    { value: "", label: "Завод" },
    ...sourceFarmerList.map((f) => ({ value: String(f.id), label: f.name })),
  ];

  // Источник для исключения self-transfer из получателей. "" = Завод (без исключения).
  const sourceId =
    (useWatch({ control: form.control, name: "source_farmer_id" }) as
      | string
      | undefined) ?? "";

  async function onSubmit(values: MaterialShipmentInput) {
    const res =
      mode === "edit"
        ? await updateMaterialShipment(row!.id, values)
        : await createMaterialShipment(values);

    if (res.ok) {
      toast.success(mode === "edit" ? "Сохранено" : "Рейс создан");
      setOpen(false);
      if (mode === "create") {
        form.reset({
          driver_id: "",
          source_farmer_id: "",
          departure_date: "",
          arrival_date: "",
          items: [{ ...EMPTY_ITEM }],
        });
      }
      router.refresh();
      return;
    }

    if (res.fieldErrors) {
      for (const [field, messages] of Object.entries(res.fieldErrors)) {
        if (messages?.[0]) {
          form.setError(field as keyof MaterialShipmentInput, { message: messages[0] });
        }
      }
    } else {
      toast.error(res.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="size-4" /> Рейс тары
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="flex max-h-[85vh] flex-col gap-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            Рейс тары
            {row && <StatusBadge status={row.status} />}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? "Рейс уже отправлен — поля заблокированы. Чтобы править, откатите статус в «Плановый»."
              : `Возврат тары завод → фермер: даты, водитель и позиции (1–${MAX_ITEMS}).`}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="grid flex-1 gap-4 overflow-y-auto px-1 py-2">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="departure_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Отправление</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          disabled={readOnly}
                          onChange={(e) => onDepartureChange(e.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="arrival_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Прибытие</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          disabled={readOnly}
                          onChange={(e) => onArrivalChange(e.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="driver_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Водитель</FormLabel>
                      <FormControl>
                        <Combobox
                          options={driverOptions}
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          placeholder="Выберите водителя"
                          searchPlaceholder="Поиск по фамилии…"
                          emptyText="Водитель не найден"
                          disabled={readOnly}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Источник: «Завод» (доставка, дефолт) или фермер (перенос -3). */}
                <FormField
                  control={form.control}
                  name="source_farmer_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Источник</FormLabel>
                      <FormControl>
                        <Combobox
                          options={sourceOptions}
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          placeholder="Завод"
                          searchPlaceholder="Поиск по фермеру…"
                          emptyText="Не найдено"
                          disabled={readOnly}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Позиции (1–4): фермер · тип тары · кол-во. */}
              <div className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Позиции</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={readOnly || fields.length >= MAX_ITEMS}
                    onClick={() => append({ ...EMPTY_ITEM })}
                  >
                    <Plus className="size-4" /> Позиция
                  </Button>
                </div>

                {fields.map((f, i) => (
                  <ItemRow
                    key={f.id}
                    index={i}
                    form={form}
                    farmerOptions={farmerOptions}
                    packagingOptions={packagingOptions}
                    ingredientOptions={ingredientOptions}
                    excludeFarmerId={sourceId}
                    readOnly={readOnly}
                    canRemove={fields.length > 1}
                    onRemove={() => remove(i)}
                  />
                ))}

                {form.formState.errors.items?.message && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.items.message}
                  </p>
                )}
              </div>
            </div>

            <DialogFooter className="shrink-0">
              {readOnly ? (
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Закрыть
                </Button>
              ) : (
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Сохранение…" : "Сохранить"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// Сегмент-тоггл вида позиции (Тара | Ингредиент). Без toggle-group (нет в проекте) —
// инлайн из двух кнопок, нейтральный hairline-хром.
function KindToggle({
  value,
  onChange,
  disabled,
}: {
  value: "packaging" | "ingredient";
  onChange: (v: "packaging" | "ingredient") => void;
  disabled?: boolean;
}) {
  const opts: { key: "packaging" | "ingredient"; label: string }[] = [
    { key: "packaging", label: "Тара" },
    { key: "ingredient", label: "Ингредиент" },
  ];
  return (
    <div className="inline-flex h-10 items-center rounded-md border border-input p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={cn(
            "h-full rounded-[5px] px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
            value === o.key
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Строка позиции рейса: фермер · вид (тара/ингредиент) · пикер по виду · кол-во.
// Локальный watch держим тут, чтобы не ре-рендерить всю форму на каждый ввод.
function ItemRow({
  index,
  form,
  farmerOptions,
  packagingOptions,
  ingredientOptions,
  excludeFarmerId,
  readOnly,
  canRemove,
  onRemove,
}: {
  index: number;
  form: UseFormReturn<MaterialShipmentInput>;
  farmerOptions: MaterialFarmerOption[];
  packagingOptions: MaterialPackagingOption[];
  ingredientOptions: MaterialIngredientOption[];
  // Фермер-источник переноса ("" = Завод) — его опцию в получателях дизейблим
  // (self-transfer запрещён; сервер тоже режет).
  excludeFarmerId: string;
  readOnly: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const control = form.control as Control<MaterialShipmentInput>;
  const kind =
    (useWatch({ control, name: `items.${index}.item_kind` }) as
      | "packaging"
      | "ingredient"
      | undefined) ?? "packaging";
  const ingredientId = useWatch({
    control,
    name: `items.${index}.ingredient_id`,
  }) as string | undefined;

  const isIngredient = kind === "ingredient";
  const selectedIngredient = ingredientOptions.find(
    (g) => String(g.id) === ingredientId,
  );
  const unitLabel = isIngredient
    ? selectedIngredient
      ? INGREDIENT_UNIT_LABELS[selectedIngredient.unit]
      : "ед."
    : "шт";

  // Переключение вида: чистим противоположный FK, чтобы не «висел» лишний id.
  function switchKind(next: "packaging" | "ingredient") {
    if (next === kind) return;
    form.setValue(`items.${index}.item_kind`, next, { shouldDirty: true });
    if (next === "ingredient") {
      form.setValue(`items.${index}.packaging_type_id`, "", { shouldDirty: true });
    } else {
      form.setValue(`items.${index}.ingredient_id`, "", { shouldDirty: true });
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-2 rounded border p-2">
      <FormField
        control={form.control}
        name={`items.${index}.farmer_id`}
        render={({ field }) => (
          <FormItem className="min-w-[160px] flex-1">
            <FormLabel className="text-xs">Фермер</FormLabel>
            <Select value={field.value} onValueChange={field.onChange} disabled={readOnly}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Фермер" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {farmerOptions.map((farmer) => (
                  <SelectItem
                    key={farmer.id}
                    value={String(farmer.id)}
                    disabled={
                      excludeFarmerId !== "" &&
                      String(farmer.id) === excludeFarmerId
                    }
                  >
                    {farmer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormItem className="shrink-0">
        <FormLabel className="text-xs">Вид</FormLabel>
        <div>
          <KindToggle value={kind} onChange={switchKind} disabled={readOnly} />
        </div>
      </FormItem>

      {isIngredient ? (
        <FormField
          control={form.control}
          name={`items.${index}.ingredient_id`}
          render={({ field }) => (
            <FormItem className="min-w-[160px] flex-1">
              <FormLabel className="text-xs">Ингредиент</FormLabel>
              <Select value={field.value ?? ""} onValueChange={field.onChange} disabled={readOnly}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Ингредиент" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {ingredientOptions.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.name} ({INGREDIENT_UNIT_LABELS[g.unit]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <FormField
          control={form.control}
          name={`items.${index}.packaging_type_id`}
          render={({ field }) => (
            <FormItem className="min-w-[160px] flex-1">
              <FormLabel className="text-xs">Тип тары</FormLabel>
              <Select value={field.value ?? ""} onValueChange={field.onChange} disabled={readOnly}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Тип тары" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {packagingOptions.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <FormField
        control={form.control}
        name={`items.${index}.quantity`}
        render={({ field }) => (
          <FormItem className="w-28">
            <FormLabel className="text-xs">Кол-во, {unitLabel}</FormLabel>
            <FormControl>
              <Input
                type="number"
                inputMode={isIngredient ? "decimal" : "numeric"}
                min={isIngredient ? undefined : 1}
                step={isIngredient ? 0.001 : 1}
                {...field}
                disabled={readOnly}
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
        title="Удалить позицию"
        className="mt-6"
        disabled={readOnly || !canRemove}
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
