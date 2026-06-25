// Токены статусов рейса тары (status-fills, БЕЗ accepted — у тары приёмки нет) и
// бейдж. Без клиентских хуков — модуль делят форма, кнопки действий и лента.
export type MaterialStatus = "planned" | "sent" | "arrived";

// Отображаемый статус: к сырым добавляется производный "partial" (часть позиций
// прибыла) — в БД его нет, считается в feed (derivedStatus). Raw MaterialStatus
// остаётся для фильтра/enum.
export type DisplayStatus = MaterialStatus | "partial";

// color — текст бейджа, bg — фон бейджа (soft), dot — точка слева, zone — фон
// левой зоны карточки. Значения — из DESIGN-SYSTEM «status-fills».
// partial — заливка как у sent (нового токена не вводим).
export const STATUS_STYLE: Record<
  DisplayStatus,
  { label: string; color: string; bg: string; dot: string; zone: string }
> = {
  planned: { label: "Плановый", color: "#888888", bg: "#ededed", dot: "#b3b3b3", zone: "#f5f5f5" },
  sent: { label: "Отправлен", color: "#0761d1", bg: "#d3e5ff", dot: "#0070f3", zone: "#eaf2ff" },
  partial: { label: "Частично", color: "#0761d1", bg: "#d3e5ff", dot: "#0070f3", zone: "#eaf2ff" },
  arrived: { label: "Прибыл", color: "#ab570a", bg: "#ffefcf", dot: "#f5a623", zone: "#fff6e3" },
};

export function StatusBadge({
  status,
  arrivedCount,
  totalCount,
}: {
  status: DisplayStatus;
  arrivedCount?: number;
  totalCount?: number;
}) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-md px-[9px] text-xs font-medium leading-none tracking-[-0.01em]"
      style={{ color: s.color, backgroundColor: s.bg }}
    >
      <span
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: s.dot }}
      />
      {status === "partial" ? (
        <>
          {s.label}{" "}
          <span className="tabular-nums">
            {arrivedCount}/{totalCount}
          </span>
        </>
      ) : (
        s.label
      )}
    </span>
  );
}
