import type { LucideIcon } from "lucide-react";

// Общее пустое состояние вкладок карточки (нет контрактов / отгрузок / балансов).
export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border bg-muted/20 px-6 py-14 text-center">
      <div className="mb-1 grid size-11 place-items-center rounded-[10px] border bg-background text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
      <p className="max-w-[380px] text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
