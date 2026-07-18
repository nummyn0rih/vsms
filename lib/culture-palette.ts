// Курируемая палитра цветов культур — ЕДИНСТВЕННОЕ определение в коде.
// Culture.color остаётся hex-строкой (миграции нет); палитра задаёт допустимые
// значения и UI выбора (swatch-пикер в форме культуры). Off-palette цвета старых
// культур продолжают работать (fallback «свой цвет»).
// Зеркало этих hex — в docs/DESIGN-SYSTEM.md (раздел «Палитра культур»).
// Подобрана так, чтобы 6–8 культур различались рядом, работали заливкой heatmap,
// читались столбцом графика, не сливались в grayscale и не конфликтовали со
// статусными цветами отгрузок (status-fills).

export type CulturePaletteColor = { hex: string; label: string };

export const CULTURE_PALETTE: CulturePaletteColor[] = [
  { hex: "#D4322C", label: "Красный" },
  { hex: "#E8730C", label: "Оранжевый" },
  { hex: "#C99700", label: "Горчичный" },
  { hex: "#5C8A10", label: "Лаймовый" },
  { hex: "#2F9E44", label: "Зелёный" },
  { hex: "#0F766E", label: "Хвойный" },
  { hex: "#0E7490", label: "Морской" },
  { hex: "#3A56D4", label: "Индиго" },
  { hex: "#7C3AED", label: "Фиолетовый" },
  { hex: "#A21CAF", label: "Пурпурный" },
  { hex: "#BE185D", label: "Малиновый" },
  { hex: "#92561F", label: "Коричневый" },
];

// Нормализация hex для сравнения/ключей (регистр не значим): "#3f7d3a" === "#3F7D3A".
export function normalizeHex(hex: string): string {
  return hex.trim().toUpperCase();
}

// true, если цвет входит в палитру (без учёта регистра).
export function isPaletteColor(hex: string): boolean {
  const norm = normalizeHex(hex);
  return CULTURE_PALETTE.some((c) => c.hex.toUpperCase() === norm);
}
