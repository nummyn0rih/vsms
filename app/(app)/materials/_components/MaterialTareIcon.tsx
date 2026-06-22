// Иконка типа тары по PackagingType.kind (НЕ по id/имени). box → ящик, barrel →
// бочка, иначе нейтральный fallback (коробка). SVG-пути — из прототипа
// docs/prototypes/material-delivery-d3.html.
export function MaterialTareIcon({
  kind,
  className = "size-[15px] shrink-0 text-muted-foreground",
}: {
  kind: "box" | "barrel" | null | undefined;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  if (kind === "barrel") {
    return (
      <svg {...common}>
        <path d="M3 6c0-1.1 4-2 9-2s9 .9 9 2-4 2-9 2-9-.9-9-2z" />
        <path d="M3 6v12c0 1.1 4 2 9 2s9-.9 9-2V6" />
      </svg>
    );
  }

  if (kind === "box") {
    return (
      <svg {...common}>
        <path d="M16.5 9.4 7.5 4.21" />
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      </svg>
    );
  }

  // Нейтральный fallback (неизвестный вид тары).
  return (
    <svg {...common}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
    </svg>
  );
}
