"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { upsertNorm, deleteNorm } from "@/server/norms/actions";
import type {
  CultureCol,
  FarmerRow,
  NormCell,
  NormKind,
} from "@/server/norms/schema";

type Props = {
  farmers: FarmerRow[];
  cultures: CultureCol[];
  packagingNorms: NormCell[];
  tripNorms: NormCell[];
};

const cellKey = (farmerId: number, cultureId: number) =>
  `${farmerId}:${cultureId}`;

function toMap(cells: NormCell[]): Map<string, number> {
  return new Map(cells.map((c) => [cellKey(c.farmer_id, c.culture_id), c.value]));
}

const MODE_META: Record<NormKind, { title: string; hint: string }> = {
  packaging: { title: "Вес тары", hint: "кг на единицу тары" },
  trip: { title: "Вес рейса", hint: "плановая загрузка машины, кг" },
};

export function NormsMatrix({
  farmers,
  cultures,
  packagingNorms,
  tripNorms,
}: Props) {
  const [mode, setMode] = useState<NormKind>("packaging");
  // Источник истины после загрузки: две карты норм (обновляются по сохранению ячейки).
  const [packagingMap, setPackagingMap] = useState(() => toMap(packagingNorms));
  const [tripMap, setTripMap] = useState(() => toMap(tripNorms));

  const normMap = mode === "packaging" ? packagingMap : tripMap;
  const setNormMap = mode === "packaging" ? setPackagingMap : setTripMap;

  // Доступные ячейки режима: в «Весе тары» — только культуры с заданным типом тары.
  const availableCultures =
    mode === "packaging" ? cultures.filter((c) => c.has_packaging) : cultures;
  const totalCells = farmers.length * availableCultures.length;
  const filledCells = useMemo(() => {
    let n = 0;
    for (const f of farmers) {
      for (const c of availableCultures) {
        if (normMap.has(cellKey(f.id, c.id))) n++;
      }
    }
    return n;
  }, [farmers, availableCultures, normMap]);

  function handleSaved(
    farmerId: number,
    cultureId: number,
    value: number | null,
  ) {
    setNormMap((prev) => {
      const next = new Map(prev);
      const k = cellKey(farmerId, cultureId);
      if (value == null) next.delete(k);
      else next.set(k, value);
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
          <p className="mt-1 text-sm text-muted-foreground">
            Заполнено {filledCells} из {totalCells} доступных ячеек
          </p>
        </div>

        {farmers.length === 0 || cultures.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нужны активные фермеры и культуры — заведите их в справочниках.
          </p>
        ) : (
          // key=mode → грид перемонтируется при смене режима (ячейки берут свои значения).
          <MatrixGrid
            key={mode}
            mode={mode}
            farmers={farmers}
            cultures={cultures}
            normMap={normMap}
            onSaved={handleSaved}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function MatrixGrid({
  mode,
  farmers,
  cultures,
  normMap,
  onSaved,
}: {
  mode: NormKind;
  farmers: FarmerRow[];
  cultures: CultureCol[];
  normMap: Map<string, number>;
  onSaved: (farmerId: number, cultureId: number, value: number | null) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-30 border-b border-r bg-background px-3 py-2 text-left font-medium">
              Фермер
            </th>
            {cultures.map((c) => (
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
              {cultures.map((c) => {
                const disabled = mode === "packaging" && !c.has_packaging;
                return (
                  <td key={c.id} className="border-b px-1.5 py-1">
                    <NormInput
                      mode={mode}
                      farmerId={f.id}
                      cultureId={c.id}
                      disabled={disabled}
                      savedValue={normMap.get(cellKey(f.id, c.id))}
                      onSaved={onSaved}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type CellStatus = "idle" | "saving" | "saved" | "error";

function NormInput({
  mode,
  farmerId,
  cultureId,
  disabled,
  savedValue,
  onSaved,
}: {
  mode: NormKind;
  farmerId: number;
  cultureId: number;
  disabled: boolean;
  savedValue: number | undefined;
  onSaved: (farmerId: number, cultureId: number, value: number | null) => void;
}) {
  const [value, setValue] = useState(
    savedValue != null ? String(savedValue) : "",
  );
  const [status, setStatus] = useState<CellStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  // Счётчик версий: при повторном сохранении той же ячейки старый ответ игнорируется.
  const seqRef = useRef(0);
  // Последнее сохранённое значение (для определения «изменилось ли»).
  const savedRef = useRef<number | undefined>(savedValue);

  // Короткая зелёная вспышка после успешного сохранения.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 900);
    return () => clearTimeout(t);
  }, [status]);

  async function commit() {
    if (disabled) return;
    const trimmed = value.trim();

    // Пусто: удалить норму, если она была; иначе ничего не делать.
    if (trimmed === "") {
      if (savedRef.current == null) {
        setStatus("idle");
        return;
      }
      const mySeq = ++seqRef.current;
      setStatus("saving");
      const res = await deleteNorm(mode, farmerId, cultureId);
      if (mySeq !== seqRef.current) return; // перебито более новым сохранением
      if (res.ok) {
        savedRef.current = undefined;
        onSaved(farmerId, cultureId, null);
        setStatus("saved");
      } else {
        setStatus("error");
        setErrorMsg(res.error);
      }
      return;
    }

    const num = Number(trimmed);
    if (!Number.isFinite(num) || num <= 0) {
      // Невалидно: не сохранять, значение НЕ откатывать — дать исправить.
      setStatus("error");
      setErrorMsg("Значение должно быть больше 0");
      return;
    }
    if (num === savedRef.current) {
      setStatus("idle");
      return;
    }

    const mySeq = ++seqRef.current;
    setStatus("saving");
    const res = await upsertNorm(mode, farmerId, cultureId, num);
    if (mySeq !== seqRef.current) return;
    if (res.ok) {
      savedRef.current = num;
      onSaved(farmerId, cultureId, num);
      setStatus("saved");
    } else {
      setStatus("error");
      setErrorMsg(res.error);
    }
  }

  const input = (
    <div className="relative">
      <Input
        type="number"
        inputMode="decimal"
        step="0.001"
        min="0"
        disabled={disabled}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (status === "error") setStatus("idle");
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={cn(
          "h-8 w-24 text-right tabular-nums transition-colors",
          status === "saved" && "border-green-500 ring-1 ring-green-500",
          status === "error" && "border-red-500 ring-1 ring-red-500",
          status === "saving" && "opacity-70",
          disabled && "bg-muted text-muted-foreground",
        )}
      />
      {status === "saving" && (
        <Loader2 className="pointer-events-none absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
    </div>
  );

  const tooltipMsg = disabled
    ? "У культуры не задан тип тары"
    : status === "error"
      ? errorMsg
      : null;

  if (!tooltipMsg) return input;

  return (
    <Tooltip open={status === "error" ? true : undefined}>
      <TooltipTrigger asChild>
        <span className="inline-block">{input}</span>
      </TooltipTrigger>
      <TooltipContent>{tooltipMsg}</TooltipContent>
    </Tooltip>
  );
}
