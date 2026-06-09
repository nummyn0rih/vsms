// Заглушка раздела на время каркаса. Заменяется реальной страницей по роадмапу.
export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {note ?? "Раздел в разработке."}
      </p>
    </div>
  );
}
