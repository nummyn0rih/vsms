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
import { upsertNorm, deleteNorm } from "@/server/norms/actions";
import type { NormKind } from "@/server/norms/schema";

type CellStatus = "idle" | "saving" | "saved" | "error";

// Одна ячейка нормы с автосейвом по blur. Переиспользуется матрицей (однотиповые
// культуры) и редактором многотиповых норм. packagingTypeId обязателен для packaging.
// Должен рендериться с key, привязанным к ячейке (значение читается из savedValue
// при монтировании). onSaved(value|null) — апдейт родительской карты.
export function NormInput({
  mode,
  farmerId,
  cultureId,
  packagingTypeId,
  savedValue,
  onSaved,
}: {
  mode: NormKind;
  farmerId: number;
  cultureId: number;
  packagingTypeId?: number;
  savedValue: number | undefined;
  onSaved: (value: number | null) => void;
}) {
  const [value, setValue] = useState(savedValue != null ? String(savedValue) : "");
  const [status, setStatus] = useState<CellStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  // Счётчик версий: при повторном сохранении той же ячейки старый ответ игнорируется.
  const seqRef = useRef(0);
  const savedRef = useRef<number | undefined>(savedValue);

  // Короткая зелёная вспышка после успешного сохранения.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 900);
    return () => clearTimeout(t);
  }, [status]);

  async function commit() {
    const trimmed = value.trim();

    // Пусто: удалить норму, если была; иначе ничего.
    if (trimmed === "") {
      if (savedRef.current == null) {
        setStatus("idle");
        return;
      }
      const mySeq = ++seqRef.current;
      setStatus("saving");
      const res = await deleteNorm(mode, farmerId, cultureId, packagingTypeId);
      if (mySeq !== seqRef.current) return;
      if (res.ok) {
        savedRef.current = undefined;
        onSaved(null);
        setStatus("saved");
      } else {
        setStatus("error");
        setErrorMsg(res.error);
      }
      return;
    }

    const num = Number(trimmed);
    if (!Number.isFinite(num) || num <= 0) {
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
    const res = await upsertNorm(mode, farmerId, cultureId, num, packagingTypeId);
    if (mySeq !== seqRef.current) return;
    if (res.ok) {
      savedRef.current = num;
      onSaved(num);
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
