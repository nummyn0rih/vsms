// Компактный прогресс выполнения строки контракта — общий для вкладок «Контракты» и
// «Расчёты». Тот же визуальный язык, что ProgressCell в contracts/_components/
// ContractViewDialog.tsx (там функция не экспортируется).
// Перевыполнение (>100%) не обрезает подпись, только заливку.
export function ProgressCell({ pct }: { pct: number }) {
  const over = pct > 100;
  const width = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${over ? "bg-foreground" : "bg-foreground/70"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span
        className={`w-11 shrink-0 text-right text-xs tabular-nums ${
          over ? "font-medium text-foreground" : "text-muted-foreground"
        }`}
      >
        {Math.round(pct)}%
      </span>
    </div>
  );
}
