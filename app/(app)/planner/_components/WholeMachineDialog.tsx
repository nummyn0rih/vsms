"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Truck } from "lucide-react";

import type { ShipmentOptions } from "@/server/shipments/schema";
import type { BoardColumn } from "@/server/board/schema";
import {
  createWholeMachines,
  getTripWeightNorm,
} from "@/server/shipments/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
function shortWeekday(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  return WEEKDAY_SHORT[(d.getUTCDay() + 6) % 7];
}
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function WholeMachineDialog({
  options,
  columns,
  open,
  onOpenChange,
  onSuccess,
}: {
  options: ShipmentOptions;
  columns: BoardColumn[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void | Promise<void>;
}) {
  const [farmerId, setFarmerId] = useState("");
  const [cultureId, setCultureId] = useState("");
  const [weight, setWeight] = useState("");
  const [packagingTypeId, setPackagingTypeId] = useState(""); // "" = навал/не выбран
  const [normMissing, setNormMissing] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Типы тары пары: только разрешённые культуре И имеющие норму фасовки (PackagingNorm)
  // — гарантия, что тара уедет при planned→sent. Навал — только если у культуры нет типов.
  function pairTypesFor(f: string, c: string) {
    const culture = options.cultures.find((cc) => String(cc.id) === c);
    const cultureTypes = culture?.packagingTypes ?? [];
    const normTypeIds = new Set(
      options.packagingNorms
        .filter((n) => String(n.farmer_id) === f && String(n.culture_id) === c)
        .map((n) => n.packaging_type_id),
    );
    return {
      hasCulture: Boolean(culture),
      cultureTypes,
      pairTypes: cultureTypes.filter((t) => normTypeIds.has(t.id)),
    };
  }

  const { hasCulture, cultureTypes, pairTypes } = pairTypesFor(farmerId, cultureId);
  const isBulk = hasCulture && cultureTypes.length === 0;
  // Культура с типами, но без единой нормы для пары → выбрать нечего, создание блокируем.
  const typedNoNorm = hasCulture && cultureTypes.length > 0 && pairTypes.length === 0;

  // Смена пары (в обработчике, не в эффекте): дефолт тары + автозаполнение веса из нормы.
  function applyPair(f: string, c: string) {
    const { pairTypes: pt } = pairTypesFor(f, c);
    setPackagingTypeId(pt.length > 0 ? String(pt[0].id) : "");
    if (!f || !c) {
      setNormMissing(false);
      return;
    }
    void getTripWeightNorm(Number(f), Number(c)).then((norm) => {
      setNormMissing(norm == null);
      setWeight(norm != null ? String(norm) : "");
    });
  }

  function onFarmerChange(v: string) {
    setFarmerId(v);
    applyPair(v, cultureId);
  }
  function onCultureChange(v: string) {
    setCultureId(v);
    applyPair(farmerId, v);
  }

  function toggleDay(dateISO: string) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dateISO)) next.delete(dateISO);
      else next.add(dateISO);
      return next;
    });
  }

  const weightNum = Number(weight.trim().replace(",", "."));
  const weightOk = Number.isFinite(weightNum) && weightNum > 0;
  const packagingOk = isBulk || (!typedNoNorm && packagingTypeId !== "");
  const count = selectedDays.size;
  const canSubmit =
    Boolean(farmerId) && Boolean(cultureId) && weightOk && packagingOk && count > 0;

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const res = await createWholeMachines({
      farmerId: Number(farmerId),
      cultureId: Number(cultureId),
      plannedWeightKg: weight,
      packagingTypeId: isBulk ? null : Number(packagingTypeId),
      dayDatesISO: [...selectedDays],
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success(`Создано отгрузок: ${res.data?.created ?? count}`);
      onOpenChange(false);
      await onSuccess();
      return;
    }
    toast.error(res.error);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Truck className="size-4" /> Целая машина
          </DialogTitle>
          <DialogDescription>
            Одно-фермерские плановые отгрузки на отмеченные рабочие дни недели. Вес —
            из нормы рейса или вручную.
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 gap-4 overflow-y-auto px-1 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label className="text-xs">Фермер</Label>
              <Select value={farmerId} onValueChange={onFarmerChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Фермер" />
                </SelectTrigger>
                <SelectContent>
                  {options.farmers.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs">Культура</Label>
              <Select value={cultureId} onValueChange={onCultureChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Культура" />
                </SelectTrigger>
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
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label className="text-xs">Вес рейса, кг</Label>
              <Input
                type="number"
                inputMode="decimal"
                className="tabular-nums"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="напр. 19000"
              />
              {farmerId && cultureId && normMissing && (
                <p className="text-xs text-amber-600">Нормы рейса нет — введите вес вручную</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs">Тип тары</Label>
              {isBulk ? (
                <div className="flex h-10 items-center text-sm text-muted-foreground">
                  навал (без тары)
                </div>
              ) : typedNoNorm ? (
                <div className="flex h-10 items-center text-xs text-amber-600">
                  Нет нормы тары для пары
                </div>
              ) : (
                <Select
                  value={packagingTypeId}
                  onValueChange={setPackagingTypeId}
                  disabled={!cultureId || pairTypes.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Тип тары" />
                  </SelectTrigger>
                  <SelectContent>
                    {pairTypes.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Дни недели (рабочие)</Label>
            <div className="flex flex-wrap gap-2">
              {columns.map((col) => {
                const past = col.dateISO < todayISO();
                const checked = selectedDays.has(col.dateISO);
                return (
                  <button
                    key={col.dateISO}
                    type="button"
                    disabled={past}
                    onClick={() => toggleDay(col.dateISO)}
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs tabular-nums transition ${
                      past
                        ? "cursor-not-allowed border-dashed text-muted-foreground opacity-50"
                        : checked
                          ? "border-foreground bg-foreground text-background"
                          : "border-input hover:border-foreground"
                    }`}
                  >
                    <span>{shortWeekday(col.dateISO)}</span>
                    <span>{dayMonthFmt.format(new Date(`${col.dateISO}T00:00:00Z`))}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="button" onClick={onSubmit} disabled={!canSubmit || submitting}>
            {submitting ? "Создание…" : `Создать (${count})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
