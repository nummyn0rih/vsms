import type { CultureTotal } from "@/server/shipments/feed";

// Тоннаж из кг (DESIGN §2): кг/1000, до 1 знака, tabular-nums форматируется в месте.
const tonsFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
export function formatTons(kg: number): string {
  return tonsFmt.format(kg / 1000);
}

// Чип культуры с недельной/дневной суммой (т). Полный цвет культуры — точка.
export function CultureChip({ culture }: { culture: CultureTotal }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#ebebeb] bg-card px-2 py-0.5 text-xs text-foreground/80">
      <span
        className="inline-block size-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: culture.color }}
      />
      {culture.name}
      <b className="font-semibold tabular-nums text-foreground">
        {formatTons(culture.totalKg)} т
      </b>
    </span>
  );
}
