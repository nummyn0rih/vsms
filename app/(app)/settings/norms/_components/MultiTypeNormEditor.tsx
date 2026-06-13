"use client";

import { useMemo, useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CultureCol,
  FarmerRow,
  NormCell,
  PackagingTypeCol,
} from "@/server/norms/schema";
import { NormInput } from "./NormInput";

type Props = {
  farmers: FarmerRow[];
  cultures: CultureCol[];
  packagingTypes: PackagingTypeCol[];
  packagingNorms: NormCell[];
};

const tripleKey = (f: number, c: number, t: number) => `${f}:${c}:${t}`;

// Редактор норм тары для культур с НЕСКОЛЬКИМИ типами тары (норма по тройке
// фермер×культура×тип). Матрица такие культуры не показывает.
export function MultiTypeNormEditor({
  farmers,
  cultures,
  packagingTypes,
  packagingNorms,
}: Props) {
  const multiCultures = cultures.filter((c) => c.packaging_type_ids.length > 1);
  const [cultureId, setCultureId] = useState<number | null>(
    multiCultures[0]?.id ?? null,
  );
  const [normMap, setNormMap] = useState(
    () =>
      new Map(
        packagingNorms.map((c) => [
          tripleKey(c.farmer_id, c.culture_id, c.packaging_type_id!),
          c.value,
        ]),
      ),
  );

  const typeName = useMemo(
    () => new Map(packagingTypes.map((t) => [t.id, t.name])),
    [packagingTypes],
  );

  const selected = multiCultures.find((c) => c.id === cultureId) ?? null;

  function handleSaved(key: string, value: number | null) {
    setNormMap((prev) => {
      const next = new Map(prev);
      if (value == null) next.delete(key);
      else next.set(key, value);
      return next;
    });
  }

  if (multiCultures.length === 0) return null;

  return (
    <TooltipProvider>
      <div className="grid gap-4">
        <div>
          <h2 className="text-lg font-medium">Нормы тары — многотиповые культуры</h2>
          <p className="text-sm text-muted-foreground">
            Нетто продукта на единицу тары для каждого типа (зависит от фермера и типа).
          </p>
        </div>

        <div className="w-64">
          <Select
            value={cultureId != null ? String(cultureId) : ""}
            onValueChange={(v) => setCultureId(Number(v))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Выберите культуру" />
            </SelectTrigger>
            <SelectContent>
              {multiCultures.map((c) => (
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

        {selected && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-30 border-b border-r bg-background px-3 py-2 text-left font-medium">
                    Фермер
                  </th>
                  {selected.packaging_type_ids.map((tid) => (
                    <th
                      key={tid}
                      className="border-b px-3 py-2 text-left font-medium whitespace-nowrap"
                    >
                      {typeName.get(tid) ?? `Тип #${tid}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {farmers.map((f) => (
                  <tr key={f.id}>
                    <th className="sticky left-0 z-20 border-b border-r bg-background px-3 py-2 text-left font-medium whitespace-nowrap">
                      {f.name}
                    </th>
                    {selected.packaging_type_ids.map((tid) => {
                      const key = tripleKey(f.id, selected.id, tid);
                      return (
                        <td key={tid} className="border-b px-1.5 py-1">
                          <NormInput
                            key={key}
                            mode="packaging"
                            farmerId={f.id}
                            cultureId={selected.id}
                            packagingTypeId={tid}
                            savedValue={normMap.get(key)}
                            onSaved={(v) => handleSaved(key, v)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
