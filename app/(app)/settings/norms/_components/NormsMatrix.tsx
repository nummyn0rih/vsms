"use client";

import { useMemo, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  CultureCol,
  FarmerRow,
  NormCell,
  NormKind,
} from "@/server/norms/schema";
import { NormInput } from "./NormInput";

type Props = {
  farmers: FarmerRow[];
  cultures: CultureCol[];
  packagingNorms: NormCell[];
  tripNorms: NormCell[];
};

// Ключи карт значений: packaging — по тройке, trip — по паре.
const tripleKey = (f: number, c: number, t: number) => `${f}:${c}:${t}`;
const pairKey = (f: number, c: number) => `${f}:${c}`;

const MODE_META: Record<NormKind, { title: string; hint: string }> = {
  packaging: { title: "Вес тары", hint: "нетто продукта на единицу тары, кг" },
  trip: { title: "Вес рейса", hint: "плановая загрузка машины, кг" },
};

export function NormsMatrix({
  farmers,
  cultures,
  packagingNorms,
  tripNorms,
}: Props) {
  const [mode, setMode] = useState<NormKind>("packaging");

  // packaging — по тройке (матрица показывает только однотиповые культуры).
  const [packagingMap, setPackagingMap] = useState(
    () =>
      new Map(
        packagingNorms.map((c) => [
          tripleKey(c.farmer_id, c.culture_id, c.packaging_type_id!),
          c.value,
        ]),
      ),
  );
  const [tripMap, setTripMap] = useState(
    () => new Map(tripNorms.map((c) => [pairKey(c.farmer_id, c.culture_id), c.value])),
  );

  // В режиме тары — только культуры РОВНО с одним разрешённым типом (многотиповые
  // редактируются отдельным редактором ниже; навал не показываем). Trip — все.
  const visibleCultures =
    mode === "packaging"
      ? cultures.filter((c) => c.packaging_type_ids.length === 1)
      : cultures;

  const totalCells = farmers.length * visibleCultures.length;
  const filledCells = useMemo(() => {
    let n = 0;
    for (const f of farmers) {
      for (const c of visibleCultures) {
        const has =
          mode === "packaging"
            ? packagingMap.has(tripleKey(f.id, c.id, c.packaging_type_ids[0]))
            : tripMap.has(pairKey(f.id, c.id));
        if (has) n++;
      }
    }
    return n;
  }, [farmers, visibleCultures, mode, packagingMap, tripMap]);

  function handleSaved(key: string, value: number | null) {
    const setMap = mode === "packaging" ? setPackagingMap : setTripMap;
    setMap((prev) => {
      const next = new Map(prev);
      if (value == null) next.delete(key);
      else next.set(key, value);
      return next;
    });
  }

  const meta = MODE_META[mode];

  return (
    <TooltipProvider>
      <div className="grid gap-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as NormKind)}>
          <TabsList>
            <TabsTrigger value="packaging">Вес тары</TabsTrigger>
            <TabsTrigger value="trip">Вес рейса</TabsTrigger>
          </TabsList>
        </Tabs>

        <div>
          <h2 className="text-lg font-medium">{meta.title}</h2>
          <p className="text-sm text-muted-foreground">{meta.hint}</p>
          {mode === "packaging" && (
            <p className="text-sm text-muted-foreground">
              Только культуры с одним типом тары. Многотиповые — в редакторе ниже.
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Заполнено {filledCells} из {totalCells} доступных ячеек
          </p>
        </div>

        {farmers.length === 0 || visibleCultures.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {mode === "packaging"
              ? "Нет однотиповых культур или активных фермеров."
              : "Нужны активные фермеры и культуры."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-30 border-b border-r bg-background px-3 py-2 text-left font-medium">
                    Фермер
                  </th>
                  {visibleCultures.map((c) => (
                    <th
                      key={c.id}
                      className="border-b px-3 py-2 text-left font-medium whitespace-nowrap"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block size-3 shrink-0 rounded-full border"
                          style={{ backgroundColor: c.color }}
                          title={c.color}
                        />
                        {c.name}
                      </span>
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
                    {visibleCultures.map((c) => {
                      const typeId =
                        mode === "packaging" ? c.packaging_type_ids[0] : undefined;
                      const key =
                        mode === "packaging"
                          ? tripleKey(f.id, c.id, typeId!)
                          : pairKey(f.id, c.id);
                      const savedValue =
                        mode === "packaging"
                          ? packagingMap.get(key)
                          : tripMap.get(key);
                      return (
                        <td key={c.id} className="border-b px-1.5 py-1">
                          <NormInput
                            // key=mode → инпут перемонтируется при смене режима.
                            key={`${mode}-${key}`}
                            mode={mode}
                            farmerId={f.id}
                            cultureId={c.id}
                            packagingTypeId={typeId}
                            savedValue={savedValue}
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
