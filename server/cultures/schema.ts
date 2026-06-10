import { z } from "zod";

// Единый источник валидации Culture: импортируется и формой (zodResolver),
// и server actions (safeParse). Не дублировать правила в двух местах.

// Человекочитаемые подписи acceptance_type. В БД храним enum (simple/calibre),
// в UI показываем эти подписи (таблица, опции Select).
// simple = приёмка %принято/брак; calibre = калибровка (схему добавим следующим промптом).
export const ACCEPTANCE_TYPE_LABELS: Record<"simple" | "calibre", string> = {
  simple: "Простая",
  calibre: "Калибровка",
};

// Sentinel «без тары» для Select: Radix запрещает SelectItem value="".
// В action нормализуем обратно в null.
export const NO_PACKAGING = "none";

// color обязателен (DOMAIN.md §2): цветовая метка используется во всём приложении
// (лента, heatmap, аналитика). Нативный <input type="color"> всегда отдаёт #rrggbb,
// regex — страховка от ручного ввода/paste.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Один диапазон калибра в форме. Числа приходят строками (как capacity_kg у
// PackagingType): min_cm обязателен (>0), max_cm пуст = открытый верхний диапазон.
// Процентов тут НЕТ — они вносятся на приёмке (CalibreResult, этап C).
export const calibreRangeSchema = z.object({
  label: z.string().trim().min(1, "Метка обязательна"),
  min_cm: z.string().trim(),
  max_cm: z.string().trim().optional(),
  is_accepted: z.boolean(),
});

export type CalibreRangeInput = z.infer<typeof calibreRangeSchema>;

// Парс числа диапазона; "" / невалид → null.
function parseCm(v: string | undefined): number | null {
  const t = v?.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const cultureSchema = z
  .object({
    name: z.string().trim().min(1, "Название обязательно"),
    color: z.string().trim().regex(HEX_COLOR, "Цвет в формате #RRGGBB"),
    acceptance_type: z.enum(["simple", "calibre"]),
    // Приходит из Select строкой: "none" | числовой id. Нормализуем в action.
    packaging_type_id: z.string().optional(),
    // Схема калибров — только для acceptance_type=calibre (см. superRefine).
    ranges: z.array(calibreRangeSchema).optional(),
  })
  .superRefine((val, ctx) => {
    // Для simple схема калибров не нужна и не валидируется.
    if (val.acceptance_type !== "calibre") return;
    const rows = val.ranges ?? [];

    // 1. Минимум один диапазон.
    if (rows.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["ranges"],
        message: "Добавьте хотя бы один диапазон калибра",
      });
      return;
    }

    // Построчные проверки: число min_cm, max_cm, уникальность label.
    const seenLabels = new Set<string>();
    rows.forEach((r, i) => {
      const min = parseCm(r.min_cm);
      const max = parseCm(r.max_cm);
      const hasMax = (r.max_cm?.trim() ?? "") !== "";

      // 2. min_cm > 0.
      if (min === null || min <= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["ranges", i, "min_cm"],
          message: "Укажите число > 0",
        });
      }
      // 2. где max задан — min < max.
      if (hasMax) {
        if (max === null) {
          ctx.addIssue({
            code: "custom",
            path: ["ranges", i, "max_cm"],
            message: "Число или оставьте пустым",
          });
        } else if (min !== null && min >= max) {
          ctx.addIssue({
            code: "custom",
            path: ["ranges", i, "max_cm"],
            message: "Должно быть больше min",
          });
        }
      }
      // 3. открытый (max пуст) допустим только у последнего диапазона.
      if (!hasMax && i !== rows.length - 1) {
        ctx.addIssue({
          code: "custom",
          path: ["ranges", i, "max_cm"],
          message: "Открытым может быть только последний диапазон",
        });
      }
      // 5. label уникален в пределах схемы.
      const key = r.label.trim().toLowerCase();
      if (key && seenLabels.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["ranges", i, "label"],
          message: "Метка уже использована",
        });
      }
      seenLabels.add(key);
    });

    // 1. Минимум один принятый диапазон.
    if (!rows.some((r) => r.is_accepted)) {
      ctx.addIssue({
        code: "custom",
        path: ["ranges"],
        message: "Хотя бы один диапазон должен быть принятым",
      });
    }

    // 3. Диапазоны не пересекаются по [min, max). Открытый max = +∞.
    // Сортируем копию по min; смежные не должны налезать.
    const sorted = rows
      .map((r) => ({ min: parseCm(r.min_cm), max: parseCm(r.max_cm) }))
      .filter((r): r is { min: number; max: number | null } => r.min !== null)
      .sort((a, b) => a.min - b.min);
    for (let k = 1; k < sorted.length; k++) {
      const prevMax = sorted[k - 1].max ?? Infinity;
      if (sorted[k].min < prevMax) {
        ctx.addIssue({
          code: "custom",
          path: ["ranges"],
          message: "Диапазоны калибров пересекаются",
        });
        break;
      }
    }
  });

export type CultureInput = z.infer<typeof cultureSchema>;

// Вью-тип для клиентских компонентов. packaging_type_name — из связи, чтобы
// показать имя даже у деактивированного типа (в таблице и edit-форме).
// ranges — текущая схема калибров (для edit-формы); пусто для simple.
export type CultureRow = {
  id: number;
  name: string;
  color: string;
  acceptance_type: "simple" | "calibre";
  packaging_type_id: number | null;
  packaging_type_name: string | null;
  ranges: CalibreRangeInput[];
  active: boolean;
};

// Опции для Select типа тары в форме (только active).
export type PackagingOption = { id: number; name: string };
