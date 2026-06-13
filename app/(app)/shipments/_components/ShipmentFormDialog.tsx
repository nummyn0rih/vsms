"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import {
  shipmentSchema,
  MAX_ITEMS,
  type ShipmentInput,
  type ShipmentDetail,
  type ShipmentOptions,
} from "@/server/shipments/schema";
import { createShipment, updateShipment } from "@/server/shipments/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useShipmentItemField } from "./useShipmentItemField";

// Сдвиг даты YYYY-MM-DD на N дней (через UTC, чтобы не плыло от таймзоны). BR-12: ±2.
const TRIP_DAYS = 2;
function shiftDate(s: string, days: number): string {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type CommonProps = {
  options: ShipmentOptions;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
};

type Props =
  | ({ mode: "create"; row?: undefined } & CommonProps)
  | ({ mode: "edit"; row: ShipmentDetail } & CommonProps);

const EMPTY_ITEM = {
  farmer_id: "",
  culture_id: "",
  planned_weight_kg: "",
  packaging_type_id: "",
  contract_line_id: "",
};

export function ShipmentFormDialog(props: Props) {
  const { mode, options, showTrigger = true } = props;
  const row = mode === "edit" ? props.row : undefined;
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = props.open !== undefined;
  const open = controlled ? props.open! : internalOpen;
  const setOpen = (v: boolean) => {
    if (controlled) props.onOpenChange?.(v);
    else setInternalOpen(v);
  };

  // Подписи строк контракта, которых нет в опциях текущего сезона (для edit) —
  // чтобы выбранная привязка не «потерялась» в комбобоксе. Образец FK-Select.
  const extraLineLabels: Record<number, string> = {};
  if (row) {
    for (const it of row.items) {
      if (it.contract_line_id != null) {
        extraLineLabels[it.contract_line_id] =
          it.contract_line_label ?? `строка #${it.contract_line_id}`;
      }
    }
  }

  const form = useForm<ShipmentInput>({
    resolver: zodResolver(shipmentSchema),
    defaultValues: {
      driver_id: row?.driver_id != null ? String(row.driver_id) : "",
      departure_date: row?.departure_date ?? "",
      arrival_date: row?.arrival_date ?? "",
      comment: row?.comment ?? "",
      items: row
        ? row.items.map((it) => ({
            farmer_id: String(it.farmer_id),
            culture_id: String(it.culture_id),
            planned_weight_kg: it.planned_weight_kg,
            packaging_type_id:
              it.packaging_type_id != null ? String(it.packaging_type_id) : "",
            contract_line_id:
              it.contract_line_id != null ? String(it.contract_line_id) : "",
          }))
        : [{ ...EMPTY_ITEM }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  // BR-12: вводится одна дата, вторая подставляется ±2 дня. Простой вариант:
  // авто-заполняем ТОЛЬКО пустую вторую дату; когда обе заданы, правка одной
  // вторую не трогает (пользователь доводит руками).
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

  async function onSubmit(values: ShipmentInput) {
    const res =
      mode === "edit"
        ? await updateShipment(row!.id, values)
        : await createShipment(values);

    if (res.ok) {
      toast.success(mode === "edit" ? "Сохранено" : "Отгрузка создана");
      setOpen(false);
      if (mode === "create") {
        form.reset({
          driver_id: "",
          departure_date: "",
          arrival_date: "",
          comment: "",
          items: [{ ...EMPTY_ITEM }],
        });
      }
      router.refresh();
      return;
    }

    if (res.fieldErrors) {
      for (const [field, messages] of Object.entries(res.fieldErrors)) {
        if (messages?.[0]) {
          form.setError(field as keyof ShipmentInput, { message: messages[0] });
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
            <Plus className="size-4" /> Отгрузка
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="flex max-h-[85vh] flex-col gap-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {mode === "edit" ? "Редактировать отгрузку" : "Новая отгрузка"}
          </DialogTitle>
          <DialogDescription>
            Черновик рейса: даты, водитель (необязателен) и позиции (1–{MAX_ITEMS}).
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="grid flex-1 gap-4 overflow-y-auto px-1 py-2">
              {/* Даты: ввод одной подставляет вторую ±2 дня, обе правятся вручную. */}
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
                          onChange={(e) => onArrivalChange(e.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
                        placeholder="Не назначен"
                        searchPlaceholder="Поиск по фамилии…"
                        emptyText="Водитель не найден"
                        clearable
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="comment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Комментарий</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Необязательно"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Позиции (1–4). Строка контракта появляется после фермера+культуры. */}
              <div className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Позиции</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={fields.length >= MAX_ITEMS}
                    onClick={() => append({ ...EMPTY_ITEM })}
                  >
                    <Plus className="size-4" /> Позиция
                  </Button>
                </div>

                {fields.map((f, i) => (
                  <ItemRow
                    key={f.id}
                    index={i}
                    control={form.control}
                    options={options}
                    extraLineLabels={extraLineLabels}
                    canRemove={fields.length > 1}
                    onRemove={() => remove(i)}
                    setLine={(v) =>
                      form.setValue(`items.${i}.contract_line_id`, v)
                    }
                    setPackagingType={(v) =>
                      form.setValue(`items.${i}.packaging_type_id`, v)
                    }
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

// Одна позиция. Строка контракта фильтруется по выбранным фермеру+культуре
// (текущий сезон). Если ровно одна подходящая — подставляем автоматически.
function ItemRow({
  index,
  control,
  options,
  extraLineLabels,
  canRemove,
  onRemove,
  setLine,
  setPackagingType,
}: {
  index: number;
  control: Control<ShipmentInput>;
  options: ShipmentOptions;
  extraLineLabels: Record<number, string>;
  canRemove: boolean;
  onRemove: () => void;
  setLine: (value: string) => void;
  setPackagingType: (value: string) => void;
}) {
  // Весь каскад позиции — в одном хуке (единая точка истины, B3 срез 1).
  const {
    packagingTypes,
    singleType,
    showPackagingSelect,
    resolvedTypeId,
    tareInfo,
    lineOptions,
    showLine,
  } = useShipmentItemField({
    index,
    control,
    options,
    extraLineLabels,
    setLine,
    setPackagingType,
  });

  return (
    <div className="grid gap-2 rounded border p-2">
      <div className="flex items-start gap-2">
        <FormField
          control={control}
          name={`items.${index}.farmer_id`}
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormLabel className="text-xs">Фермер</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Фермер" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {options.farmers.map((farmer) => (
                    <SelectItem key={farmer.id} value={String(farmer.id)}>
                      {farmer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`items.${index}.culture_id`}
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormLabel className="text-xs">Культура</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Культура" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {options.cultures.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block size-3 rounded-full"
                          style={{ backgroundColor: c.color }}
                        />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="flex items-start gap-2">
        <FormField
          control={control}
          name={`items.${index}.planned_weight_kg`}
          render={({ field }) => (
            <FormItem className="w-36">
              <FormLabel className="text-xs">Плановый вес, кг</FormLabel>
              <FormControl>
                <Input type="number" inputMode="decimal" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {singleType && (
          // Одно-типовая культура: select не нужен, тип проставлен авто. Статичная
          // приглушённая метка — чтобы видеть применяемую тару. Высота под инпут веса.
          <FormItem className="w-40">
            <FormLabel className="text-xs">Тип тары</FormLabel>
            <div className="flex h-10 items-center text-sm text-muted-foreground">
              {singleType.name}
            </div>
          </FormItem>
        )}
        {showPackagingSelect && (
          <FormField
            control={control}
            name={`items.${index}.packaging_type_id`}
            render={({ field }) => (
              <FormItem className="w-40">
                <FormLabel className="text-xs">Тип тары</FormLabel>
                <Select value={resolvedTypeId} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Тип тары" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {packagingTypes.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                        {t.is_default ? " (по умолч.)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        {showLine && (
          <FormField
            control={control}
            name={`items.${index}.contract_line_id`}
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="text-xs">Строка контракта</FormLabel>
                <FormControl>
                  <Combobox
                    options={lineOptions}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    placeholder="Не привязана"
                    searchPlaceholder="Поиск строки…"
                    emptyText="Нет строк для фермера/культуры"
                    clearable
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>

      {/* Инфо-строка тары (плановая потребность). Норма по тройке; на отправке —
          источник истины сервер. Нет нормы → предупреждение, planned сохранить можно. */}
      {tareInfo &&
        (tareInfo.ok ? (
          <p className="text-xs text-muted-foreground">
            Тара: ≈ <span className="tabular-nums">{tareInfo.units}</span>{" "}
            {tareInfo.typeName}
          </p>
        ) : (
          <p className="text-xs text-amber-600">
            Нет нормы тары для этого типа — отправка будет заблокирована
          </p>
        ))}
    </div>
  );
}
