"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { setActualWeight } from "@/server/acceptance/actions";
import { formatWeight } from "@/app/(app)/shipments/_components/shipment-actions";

type CellStatus = "idle" | "saving" | "saved" | "error";

// Мобильный вариант WeightInput.tsx: та же autosave-логика (onBlur, seqRef против
// гонок, setActualWeight), крупная разметка под тач (.weighfield/.weigh-done,
// mobile-v1.html). inputMode=decimal (не numeric прототипа) — вес может быть дробным.
// Ошибка — инлайн-текст под полем (тултип на тач неудобен).
export function MobileWeightInput({
  shipmentItemId,
  savedValue,
  disabled,
  locked,
}: {
  shipmentItemId: number;
  savedValue: number | null;
  disabled?: boolean;
  locked?: boolean;
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

  if (locked || disabled) {
    return (
      <div className="weighrow">
        <div className="weighfield filled">
          <label>факт, кг</label>
          <input
            type="text"
            readOnly
            value={savedValue != null ? formatWeight(savedValue) : "—"}
            aria-label="Фактический вес, кг"
          />
          <span className="u">кг</span>
        </div>
      </div>
    );
  }

  async function commit() {
    setEditing(false);
    const cleaned = value.replace(/\s|кг/gi, "").replace(",", ".").trim();

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
      // Первый вес у sent-машины переводит её в arrived (зона 1→2).
      router.refresh();
    } else {
      setStatus("error");
      setErrorMsg(res.error);
    }
  }

  const display =
    editing || status === "saving" ? value : saved != null ? formatWeight(saved) : "";

  return (
    <div>
      <div className="weighrow">
        <div className={`weighfield${saved != null ? " filled" : ""}${status === "error" ? " error" : ""}`}>
          <label>факт, кг</label>
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
          />
          <span className="u">кг</span>
        </div>
        <div className={`weigh-done${saved != null ? " on" : ""}`} title="Ввести вес">
          {status === "saving" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Check />
          )}
        </div>
      </div>
      {status === "error" && <div className="weighfield-err">{errorMsg}</div>}
    </div>
  );
}
