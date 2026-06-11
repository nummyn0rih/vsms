"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  contractSchema,
  type ContractInput,
  type ContractDetail,
  type FarmerOption,
  type SeasonOption,
  type CultureOption,
} from "@/server/contracts/schema";
import { createContract, updateContract } from "@/server/contracts/actions";
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

type Options = {
  farmers: FarmerOption[];
  seasons: SeasonOption[];
  cultures: CultureOption[];
};

// Controlled open + showTrigger — для edit из таблицы деталь грузится лениво, и
// диалог открывается извне (без собственного триггера-карандаша).
type CommonProps = Options & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
};

type Props =
  | ({ mode: "create"; row?: undefined } & CommonProps)
  | ({ mode: "edit"; row: ContractDetail } & CommonProps);

const EMPTY_LINE = { culture_id: "", label: "", volume_tons: "", price_per_kg: "" };

export function ContractFormDialog(props: Props) {
  const { mode, farmers, seasons, cultures, showTrigger = true } = props;
  const row = mode === "edit" ? props.row : undefined;
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = props.open !== undefined;
  const open = controlled ? props.open! : internalOpen;
  const setOpen = (v: boolean) => {
    if (controlled) props.onOpenChange?.(v);
    else setInternalOpen(v);
  };

  const form = useForm<ContractInput>({
    resolver: zodResolver(contractSchema),
    defaultValues: {
      farmer_id: row ? String(row.farmer_id) : "",
      season_year: row ? String(row.season_year) : "",
      notes: row?.notes ?? "",
      lines: row
        ? row.lines.map((l) => ({
            culture_id: String(l.culture_id),
            label: l.label,
            volume_tons: l.volume_tons,
            price_per_kg: l.price_per_kg,
          }))
        : [{ ...EMPTY_LINE }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  async function onSubmit(values: ContractInput) {
    const res =
      mode === "edit"
        ? await updateContract(row!.id, values)
        : await createContract(values);

    if (res.ok) {
      toast.success(mode === "edit" ? "Сохранено" : "Контракт создан");
      setOpen(false);
      if (mode === "create") form.reset({ farmer_id: "", season_year: "", notes: "", lines: [{ ...EMPTY_LINE }] });
      router.refresh();
      return;
    }

    if (res.fieldErrors) {
      for (const [field, messages] of Object.entries(res.fieldErrors)) {
        if (messages?.[0]) {
          form.setError(field as keyof ContractInput, { message: messages[0] });
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
          {mode === "edit" ? (
            <Button variant="ghost" size="icon-sm" title="Редактировать">
              <Pencil className="size-4" />
            </Button>
          ) : (
            <Button>
              <Plus className="size-4" /> Создать контракт
            </Button>
          )}
        </DialogTrigger>
      )}

      {/* Header/footer закреплены, середина скроллится — при 10+ строках модалка не вылезает. */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {mode === "edit" ? "Редактировать контракт" : "Новый контракт"}
          </DialogTitle>
          <DialogDescription>
            Фермер, сезон и строки контракта (культура, объём, цена). Выполнение и
            стоимость считаются позже на приёмке.
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
                  name="farmer_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Фермер</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите фермера" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {farmers.map((f) => (
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
                  name="season_year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Сезон</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите сезон" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {seasons.map((s) => (
                            <SelectItem
                              key={s.season_year}
                              value={String(s.season_year)}
                            >
                              {s.season_year}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Примечание</FormLabel>
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

              {/* Строки контракта. Одна культура может повторяться (BR-5). */}
              <div className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Строки контракта</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ ...EMPTY_LINE })}
                  >
                    <Plus className="size-4" /> Строка
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Одну культуру можно добавить несколькими строками с разными метками
                  и ценой (напр. «стандарт» и «нестандарт &gt;12»).
                </p>

                {fields.map((f, i) => (
                  <div key={f.id} className="grid gap-2 rounded border p-2">
                    <div className="flex items-end gap-2">
                      <FormField
                        control={form.control}
                        name={`lines.${i}.culture_id`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel className="text-xs">Культура</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Культура" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {cultures.map((c) => (
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
                        title="Удалить строку"
                        disabled={fields.length === 1}
                        onClick={() => remove(i)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <div className="flex items-end gap-2">
                      <FormField
                        control={form.control}
                        name={`lines.${i}.label`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel className="text-xs">Метка</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="стандарт"
                                {...field}
                                value={field.value ?? ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`lines.${i}.volume_tons`}
                        render={({ field }) => (
                          <FormItem className="w-28">
                            <FormLabel className="text-xs">Объём, т</FormLabel>
                            <FormControl>
                              <Input type="number" inputMode="decimal" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`lines.${i}.price_per_kg`}
                        render={({ field }) => (
                          <FormItem className="w-28">
                            <FormLabel className="text-xs">Цена, ₽/кг</FormLabel>
                            <FormControl>
                              <Input type="number" inputMode="decimal" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}

                {/* Ошибка уровня массива (нет строк). */}
                {form.formState.errors.lines?.message && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.lines.message}
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
