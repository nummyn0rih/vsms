// Токены статусов отгрузки (CLAUDE.md «Дизайн») и бейдж. Без клиентских хуков —
// модуль без цикла, его делят и форма, и кнопки действий, и лента.
export type ShipmentStatus = "planned" | "sent" | "arrived" | "accepted";

// color — текст бейджа, bg — фон бейджа, zone — фон левой зоны машины в ленте
// (тот же оттенок; у accepted приглушённый).
export const STATUS_STYLE: Record<
  ShipmentStatus,
  { label: string; color: string; bg: string; zone: string }
> = {
  planned: { label: "Черновик", color: "#888888", bg: "#f5f5f5", zone: "#f5f5f5" },
  sent: { label: "Отправлена", color: "#0070f3", bg: "#d3e5ff", zone: "#d3e5ff" },
  arrived: { label: "Прибыла", color: "#f5a623", bg: "#ffefcf", zone: "#ffefcf" },
  accepted: { label: "Принята", color: "#29bc9b", bg: "#aaffec", zone: "#eafff9" },
};

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium leading-none"
      style={{ color: s.color, backgroundColor: s.bg }}
    >
      {s.label}
    </span>
  );
}
