"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";

import {
  seasonSchema,
  WEEKDAYS,
  DEFAULT_SUMMER_WORKDAYS,
  DEFAULT_WINTER_WORKDAYS,
  type SeasonInput,
  type SeasonRow,
} from "@/server/seasons/schema";
import { createSeason, updateSeason } from "@/server/seasons/actions";
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
import { cn } from "@/lib/utils";

type Props =
  | { mode: "create"; row?: undefined }
  | { mode: "edit"; row: SeasonRow };

// Год начала сезона по сегодняшней дате (BR-17: сезон с июня). Июнь = месяц 5.
function defaultSeasonYear(): number {
  const now = new Date();
  return now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
}

// Ряд переключателей дней недели. Значение поля — number[] (0=Пн … 6=Вс),
// храним отсортированным по порядку недели.
function WeekdaysToggle({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  function toggle(day: number) {
    const next = value.includes(day)
      ? value.filter((d) => d !== day)
      : [...value, day];
    onChange(next.sort((a, b) => a - b));
  }

  return (
    <div className="flex flex-wrap gap-1">
      {WEEKDAYS.map((d) => {
        const on = value.includes(d.value);
        return (
          <Button
            key={d.value}
            type="button"
            variant={on ? "default" : "outline"}
            size="sm"
            className={cn("w-11", !on && "text-muted-foreground")}
            onClick={() => toggle(d.value)}
          >
            {d.label}
          </Button>
        );
      })}
    </div>
  );
}

export function SeasonFormDialog({ mode, row }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const year = row?.season_year ?? defaultSeasonYear();

  const form = useForm<SeasonInput>({
    resolver: zodResolver(seasonSchema),
    defaultValues: {
      season_year: String(year),
      summer_start: row?.summer_start ?? `${year}-06-01`,
      summer_end: row?.summer_end ?? `${year}-09-30`,
      summer_workdays: row?.summer_workdays ?? DEFAULT_SUMMER_WORKDAYS,
      winter_workdays: row?.winter_workdays ?? DEFAULT_WINTER_WORKDAYS,
    },
  });

  async function onSubmit(values: SeasonInput) {
    const res =
      mode === "edit"
        ? await updateSeason(row.id, values)
        : await createSeason(values);

    if (res.ok) {
      toast.success(mode === "edit" ? "Сохранено" : "Сезон создан");
      setOpen(false);
      if (mode === "create") form.reset();
      router.refresh();
      return;
    }

    if (res.fieldErrors) {
      for (const [field, messages] of Object.entries(res.fieldErrors)) {
        if (messages?.[0]) {
          form.setError(field as keyof SeasonInput, { message: messages[0] });
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
            <Plus className="size-4" /> Добавить сезон
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Редактировать сезон" : "Новый сезон"}
          </DialogTitle>
          <DialogDescription>
            Год начала сезона (июнь), границы лета и рабочие дни недели.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="season_year"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Год сезона</FormLabel>
                  <FormControl>
                    <Input type="number" inputMode="numeric" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="summer_start"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Начало лета</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="summer_end"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Конец лета</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="summer_workdays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Рабочие дни летом</FormLabel>
                  <WeekdaysToggle value={field.value} onChange={field.onChange} />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="winter_workdays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Рабочие дни зимой</FormLabel>
                  <WeekdaysToggle value={field.value} onChange={field.onChange} />
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
