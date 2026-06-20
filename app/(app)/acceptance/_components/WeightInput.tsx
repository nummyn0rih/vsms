"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { setActualWeight } from "@/server/acceptance/actions";

type CellStatus = "idle" | "saving" | "saved" | "error";

// Инлайн-поле фактического веса позиции (перевеска, B4b). Autosave по blur —
// образец settings/norms/NormInput: seqRef против гонок, зелёная вспышка/красная
// рамка+tooltip, Enter=blur. Пусто = очистка (actual_weight_kg → null). disabled
// (роль user) — поле read-only. Серверный requireRole — истина (RBAC не на UI).
export function WeightInput({
  shipmentItemId,
  savedValue,
  disabled,
}: {
  shipmentItemId: number;
  savedValue: number | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(savedValue != null ? String(savedValue) : "");
  const [status, setStatus] = useState<CellStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const seqRef = useRef(0);
  const savedRef = useRef<number | null>(savedValue);

  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 900);
    return () => clearTimeout(t);
  }, [status]);

  async function commit() {
    const trimmed = value.trim();

    // Пусто: очистить факт, если был; иначе ничего.
    if (trimmed === "") {
      if (savedRef.current == null) {
        setStatus("idle");
        return;
      }
      const mySeq = ++seqRef.current;
      setStatus("saving");
      const res = await setActualWeight({ shipmentItemId, actualWeightKg: null });
      if (mySeq !== seqRef.current) return;
      if (res.ok) {
        savedRef.current = null;
        setStatus("saved");
        router.refresh();
      } else {
        setStatus("error");
        setErrorMsg(res.error);
      }
      return;
    }

    const num = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(num) || num <= 0) {
      setStatus("error");
      setErrorMsg("Вес должен быть больше 0");
      return;
    }
    if (num === savedRef.current) {
      setStatus("idle");
      return;
    }

    const mySeq = ++seqRef.current;
    setStatus("saving");
    const res = await setActualWeight({ shipmentItemId, actualWeightKg: num });
    if (mySeq !== seqRef.current) return;
    if (res.ok) {
      savedRef.current = num;
      setStatus("saved");
      // Первый вес у sent-машины переводит её в arrived (зона 1→2): обновляем серверную страницу.
      router.refresh();
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
        placeholder="—"
        aria-label="Фактический вес, кг"
        className={cn(
          "h-8 w-28 text-right tabular-nums transition-colors",
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
