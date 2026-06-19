// Токены статусов отгрузки (CLAUDE.md «Дизайн») и бейдж. Без клиентских хуков —
// модуль без цикла, его делят и форма, и кнопки действий, и лента.
export type ShipmentStatus = "planned" | "sent" | "arrived" | "accepted";

// color — текст бейджа, bg — фон бейджа (soft), dot — цвет точки слева,
// zone — фон левой зоны машины в ленте (тот же оттенок; у accepted приглушённый).
export const STATUS_STYLE: Record<
  ShipmentStatus,
  { label: string; color: string; bg: string; dot: string; zone: string }
> = {
  planned: { label: "Плановая", color: "#888888", bg: "#ededed", dot: "#b3b3b3", zone: "#f5f5f5" },
  sent: { label: "Отправлена", color: "#0761d1", bg: "#d3e5ff", dot: "#0070f3", zone: "#eaf2ff" },
  arrived: { label: "Прибыла", color: "#ab570a", bg: "#ffefcf", dot: "#f5a623", zone: "#fff6e3" },
  accepted: { label: "Принята", color: "#1d8e75", bg: "#c7f6ea", dot: "#29bc9b", zone: "#ddfff7" },
};

export function StatusBadge({ status }: { status: ShipmentStatus }) {
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
      {s.label}
    </span>
  );
}
