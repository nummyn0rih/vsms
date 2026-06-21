"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { setActualWeight } from "@/server/acceptance/actions";
import { formatWeight } from "@/app/(app)/shipments/_components/shipment-actions";

type CellStatus = "idle" | "saving" | "saved" | "error";

// Инлайн-поле фактического веса позиции (перевеска, B4b). Autosave по blur —
// образец settings/norms/NormInput: seqRef против гонок, зелёная вспышка/красная
// рамка+tooltip, Enter=blur. Пусто = очистка (actual_weight_kg → null).
// Отображение (B4b-fix): сырой ввод при фокусе, форматированное «13 945 кг» после
// blur. disabled (роль user) → read-only span «{вес} кг» / «—» (без инпута).
// Серверный requireRole — истина (RBAC не на UI).
export function WeightInput({
  shipmentItemId,
  savedValue,
  disabled,
  locked,
}: {
  shipmentItemId: number;
  savedValue: number | null;
  disabled?: boolean;
  locked?: boolean; // позиция принята: вес зафиксирован актом, правка — через диалог (фикс 4)
}) {
  const router = useRouter();
  const [value, setValue] = useState(savedValue != null ? String(savedValue) : "");
  const [saved, setSaved] = useState<number | null>(savedValue);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<CellStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const seqRef = useRef(0);

  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 900);
    return () => clearTimeout(t);
  }, [status]);

  // Принята (locked) или роль user (disabled): read-only, без поля ввода. Принятый
  // вес зафиксирован актом — правка только через «Редактировать акт» (фикс 4).
  // h-8 + justify-end: read-only значение на одной высоте/линии с инпутом соседних строк.
  if (locked) {
    return (
      <span className="flex h-8 items-center justify-end text-sm tabular-nums text-[#888888]">
        {savedValue != null ? `${formatWeight(savedValue)} кг` : "—"}
      </span>
    );
  }
  if (disabled) {
    return (
      <span className="flex h-8 items-center justify-end text-sm tabular-nums text-muted-foreground">
        {savedValue != null ? `${formatWeight(savedValue)} кг` : "—"}
      </span>
    );
  }

  async function commit() {
    setEditing(false);
    // Парсинг сырого ввода: убрать пробелы/«кг», запятую → точку.
    const cleaned = value.replace(/\s|кг/gi, "").replace(",", ".").trim();

    // Пусто: очистить факт, если был; иначе ничего.
    if (cleaned === "") {
      if (saved == null) {
        setStatus("idle");
        return;
      }
      const mySeq = ++seqRef.current;
      setStatus("saving");
      const res = await setActualWeight({ shipmentItemId, actualWeightKg: null });
      if (mySeq !== seqRef.current) return;
      if (res.ok) {
        setSaved(null);
        setValue("");
        setStatus("saved");
        router.refresh();
      } else {
        setStatus("error");
        setErrorMsg(res.error);
      }
      return;
    }

    const num = Number(cleaned);
    if (!Number.isFinite(num) || num <= 0) {
      setStatus("error");
      setErrorMsg("Вес должен быть больше 0");
      return;
    }
    if (num === saved) {
      setStatus("idle");
      return;
    }

    const mySeq = ++seqRef.current;
    setStatus("saving");
    const res = await setActualWeight({ shipmentItemId, actualWeightKg: num });
    if (mySeq !== seqRef.current) return;
    if (res.ok) {
      setSaved(num);
      setStatus("saved");
      // Первый вес у sent-машины переводит её в arrived (зона 1→2): обновляем серверную страницу.
      router.refresh();
    } else {
      setStatus("error");
      setErrorMsg(res.error);
    }
  }

  // Что показываем в поле: при фокусе/правке — сырое value; иначе форматированное.
  const display =
    editing || status === "saving"
      ? value
      : saved != null
        ? `${formatWeight(saved)} кг`
        : "";

  const input = (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onFocus={() => {
          setEditing(true);
          setValue(saved != null ? String(saved) : "");
        }}
        onChange={(e) => {
          setValue(e.target.value);
          if (status === "error") setStatus("idle");
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="0"
        aria-label="Фактический вес, кг"
        className={cn(
          "h-8 w-28 rounded-md border border-[var(--hairline)] bg-[var(--canvas)] px-2.5 text-right text-sm tabular-nums outline-none transition-colors",
          "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
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
