"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { setOpeningBalance } from "@/server/inventory/opening";

type CellStatus = "idle" | "saving" | "saved" | "error";

// Ячейка начального остатка с автосейвом по blur (образец NormInput).
// Значение — целое >= 0; пусто/0 = нет остатка (opening-движение удаляется).
// Рендерить с key, привязанным к ячейке (значение читается из savedValue при монтировании).
export function OpeningStockInput({
  locationId,
  packagingTypeId,
  savedValue,
  onSaved,
}: {
  locationId: number;
  packagingTypeId: number;
  savedValue: number | undefined;
  onSaved: (value: number | null) => void;
}) {
  const [value, setValue] = useState(savedValue != null ? String(savedValue) : "");
  const [status, setStatus] = useState<CellStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  // Антигонка: при повторном сохранении той же ячейки старый ответ игнорируется.
  const seqRef = useRef(0);
  const savedRef = useRef<number | undefined>(savedValue);

  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 900);
    return () => clearTimeout(t);
  }, [status]);

  async function commit() {
    const trimmed = value.trim();
    // Пусто = 0 (нет остатка).
    const num = trimmed === "" ? 0 : Number(trimmed);

    if (!Number.isInteger(num) || num < 0) {
      setStatus("error");
      setErrorMsg("Целое число ≥ 0");
      return;
    }
    if ((savedRef.current ?? 0) === num) {
      setStatus("idle");
      return;
    }

    const mySeq = ++seqRef.current;
    setStatus("saving");
    const res = await setOpeningBalance({
      locationId,
      packagingTypeId,
      quantity: num,
    });
    if (mySeq !== seqRef.current) return;
    if (res.ok) {
      savedRef.current = num > 0 ? num : undefined;
      onSaved(num > 0 ? num : null);
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
        inputMode="numeric"
        step="1"
        min="0"
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
        )}
      />
      {status === "saving" && (
        <Loader2 className="pointer-events-none absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
    </div>
  );

  if (status !== "error") return input;

  return (
    <Tooltip open>
      <TooltipTrigger asChild>
        <span className="inline-block">{input}</span>
      </TooltipTrigger>
      <TooltipContent>{errorMsg}</TooltipContent>
    </Tooltip>
  );
}
