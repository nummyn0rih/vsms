"use client";

import { Check, TriangleAlert } from "lucide-react";

import {
  CULTURE_PALETTE,
  isPaletteColor,
  normalizeHex,
} from "@/lib/culture-palette";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Swatch-пикер цвета культуры. Controlled над RHF-полем color: value=field.value,
// onChange=field.onChange (пишет hex-строку). Заменяет нативный <input type=color>.
// Палитра — единственный источник CULTURE_PALETTE (lib/culture-palette.ts).
type Props = {
  value: string;
  onChange: (hex: string) => void;
  // нормализованныйHex → название культуры (по ДРУГИМ активным культурам).
  taken: Record<string, string>;
  // Показывать секцию «свой цвет» (только edit культуры с off-palette цветом).
  allowCustom: boolean;
};

export function ColorSwatchPicker({ value, onChange, taken, allowCustom }: Props) {
  const norm = value ? normalizeHex(value) : "";
  const selectedIsPalette = isPaletteColor(value);
  // Название культуры, занявшей текущий выбранный цвет (для taken-note).
  const takenByCurrent = norm ? taken[norm] : undefined;

  return (
    <div className="grid gap-2">
      {/* Сетка 12 образцов. Цвет динамический → inline style. */}
      <div className="grid grid-cols-6 gap-2">
        {CULTURE_PALETTE.map((c) => {
          const isSel = norm === c.hex.toUpperCase();
          const takenBy = taken[c.hex.toUpperCase()];
          return (
            <button
              key={c.hex}
              type="button"
              onClick={() => onChange(c.hex)}
              title={takenBy ? `${c.label} — занят: ${takenBy}` : c.label}
              aria-label={takenBy ? `${c.label} (занят: ${takenBy})` : c.label}
              aria-pressed={isSel}
              className={cn(
                "relative aspect-square rounded-md ring-1 ring-inset ring-black/15 transition",
                isSel && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
              )}
              style={{ backgroundColor: c.hex }}
            >
              {isSel && (
                <Check
                  className="absolute inset-0 m-auto size-4 stroke-[3] text-white drop-shadow"
                  aria-hidden
                />
              )}
              {takenBy && (
                <span
                  className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-amber-500 ring-2 ring-background"
                  aria-hidden
                >
                  <TriangleAlert className="size-2 text-white" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Readout: что выбрано / ничего не выбрано. */}
      {selectedIsPalette ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="inline-block size-2.5 shrink-0 rounded-sm ring-1 ring-inset ring-black/15"
            style={{ backgroundColor: value }}
          />
          Выбран:{" "}
          <span className="font-medium text-foreground">
            {CULTURE_PALETTE.find((c) => c.hex.toUpperCase() === norm)?.label}
          </span>
          <span className="font-mono uppercase">{value}</span>
        </p>
      ) : (
        !allowCustom && (
          <p className="text-xs text-muted-foreground">
            Цвет не выбран — выберите из палитры.
          </p>
        )
      )}

      {/* Предупреждение: выбранный цвет уже занят другой культурой. Не блокирует. */}
      {takenByCurrent && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Цвет уже занят культурой{" "}
            <b className="font-semibold">«{takenByCurrent}»</b>. Можно оставить —
            но одинаковые цвета мешают различать культуры в ленте и на графиках.
          </span>
        </div>
      )}

      {/* «Свой цвет» — только при правке культуры с off-palette цветом (fallback). */}
      {allowCustom && (
        <div className="mt-1 grid gap-2 border-t border-dashed pt-2.5">
          <span className="text-xs text-muted-foreground">Свой цвет</span>
          <div className="flex items-center gap-2">
            <span
              className="size-9 shrink-0 rounded-md ring-1 ring-inset ring-black/15"
              style={{ backgroundColor: value }}
            />
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="#RRGGBB"
              className="w-32 font-mono uppercase"
            />
            <span className="text-xs leading-tight text-muted-foreground">
              Цвет вне палитры.
              <br />
              Сохраняется как есть.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
