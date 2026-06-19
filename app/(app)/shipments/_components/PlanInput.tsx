"use client";

import { useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/lib/action-result";

type CellStatus = "idle" | "saving" | "saved" | "error";

// Ячейка цели плана с автосейвом по blur (механика как в Нормах: seqRef против
// гонок, статусы, Enter→blur, пустая = удалить). Стиль — .ptin из макета B4.
// onSaved(value|null) → апдейт локального состояния матрицы (Σ недели, tfoot).
export function PlanInput({
  savedValue,
  ariaLabel,
  weekCol,
  disabled,
  onSave,
  onDelete,
  onSaved,
}: {
  savedValue: number | undefined;
  ariaLabel: string;
  weekCol?: boolean;
  disabled?: boolean;
  onSave: (value: number) => Promise<ActionResult>;
  onDelete: () => Promise<ActionResult>;
  onSaved: (value: number | null) => void;
}) {
  // savedValue читается только при монтировании. Внешние изменения недели/конверсии
  // приходят через смену key в PlanView (ремоунт) — поэтому sync-эффект не нужен;
  // свой автосейв обновляет локальное состояние и не теряет зелёную вспышку.
  const [value, setValue] = useState(savedValue != null ? String(savedValue) : "");
  const [status, setStatus] = useState<CellStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const seqRef = useRef(0);
  const savedRef = useRef<number | undefined>(savedValue);

  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 900);
    return () => clearTimeout(t);
  }, [status]);

  async function commit() {
    const trimmed = value.trim().replace(",", ".");

    if (trimmed === "") {
      if (savedRef.current == null) {
        setStatus("idle");
        return;
      }
      const mySeq = ++seqRef.current;
      setStatus("saving");
      const res = await onDelete();
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
      setErrorMsg("Цель должна быть больше 0");
      return;
    }
    if (num === savedRef.current) {
      setStatus("idle");
      return;
    }

    const mySeq = ++seqRef.current;
    setStatus("saving");
    const res = await onSave(num);
    if (mySeq !== seqRef.current) return;
    if (res.ok) {
      savedRef.current = num;
      onSaved(num);
      setValue(String(num));
      setStatus("saved");
    } else {
      setStatus("error");
      setErrorMsg(res.error);
    }
  }

  const empty = value.trim() === "";
  const cls = [
    "ptin",
    weekCol ? "week-col-in" : "",
    empty ? "empty" : "",
    status === "saved" ? "saved" : "",
    status === "error" ? "err" : "",
    status === "saving" ? "busy" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <span className={cls}>
        <input
          type="number"
          inputMode="decimal"
          step="0.001"
          min="0"
          value={value}
          placeholder="—"
          aria-label={ariaLabel}
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="u">т</span>
      </span>
      {status === "error" && <span className="ptin-err">{errorMsg}</span>}
    </>
  );
}
