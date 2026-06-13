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


// color обязателен (DOMAIN.md §2): цветовая метка используется во всём приложении
// (лента, heatmap, аналитика). Нативный <input type="color"> всегда отдаёт #rrggbb,
// regex — страховка от ручного ввода/paste.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Одна категория приёмки в форме (CalibreRange). Числа приходят строками (как
// capacity_kg у PackagingType). Размеры опциональны: оба пустых = БЕЗРАЗМЕРНАЯ
// категория («Брак»). min задан → размерная; max пуст у размерной = открытый верх.
// Процентов тут НЕТ — они вносятся на приёмке (CalibreResult, этап C).
export const calibreRangeSchema = z.object({
  label: z.string().trim().min(1, "Метка обязательна"),
  min_cm: z.string().trim().optional(),
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
    // Разрешённые типы тары культуры (id строками). Пусто = навал (валидно).
    packaging_type_ids: z.array(z.string()).optional(),
    // Дефолтный тип — должен входить в packaging_type_ids, если те непусты.
    default_packaging_type_id: z.string().optional(),
    // Схема калибров — только для acceptance_type=calibre (см. superRefine).
    ranges: z.array(calibreRangeSchema).optional(),
  })
  .superRefine((val, ctx) => {
    // Типы тары: если выбран хотя бы один — ровно один дефолт из выбранных.
    const typeIds = val.packaging_type_ids ?? [];
    if (typeIds.length > 0) {
      const def = val.default_packaging_type_id?.trim();
      if (!def || !typeIds.includes(def)) {
        ctx.addIssue({
          code: "custom",
          path: ["default_packaging_type_id"],
          message: "Отметьте дефолтный тип тары из выбранных",
        });
      }
    }

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

    // Индекс последней РАЗМЕРНОЙ категории — открытый верх допустим только у неё.
    const dimensional = (r: CalibreRangeInput) =>
      (r.min_cm?.trim() ?? "") !== "" || (r.max_cm?.trim() ?? "") !== "";
    let lastDimIdx = -1;
    rows.forEach((r, i) => {
      if (dimensional(r)) lastDimIdx = i;
    });

    // Построчные проверки: размеры (только у размерных), уникальность label.
    const seenLabels = new Set<string>();
    rows.forEach((r, i) => {
      const min = parseCm(r.min_cm);
      const max = parseCm(r.max_cm);
      const hasMin = (r.min_cm?.trim() ?? "") !== "";
      const hasMax = (r.max_cm?.trim() ?? "") !== "";

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

      // Безразмерная категория (оба поля пусты, напр. «Брак») — валидна, размеры не проверяем.
      if (!hasMin && !hasMax) return;

      // 2. размерная: min обязателен и > 0.
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
      // 3. открытый (max пуст) допустим только у последней РАЗМЕРНОЙ категории.
      if (hasMin && !hasMax && i !== lastDimIdx) {
        ctx.addIssue({
          code: "custom",
          path: ["ranges", i, "max_cm"],
          message: "Открытым может быть только последний диапазон",
        });
      }
    });

    // 1. Минимум одна принятая категория.
    if (!rows.some((r) => r.is_accepted)) {
      ctx.addIssue({
        code: "custom",
        path: ["ranges"],
        message: "Хотя бы один диапазон должен быть принятым",
      });
    }

    // 3. Размерные категории не пересекаются по [min, max). Безразмерные (min=null)
    // отфильтрованы. Открытый max = +∞.
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

// Один разрешённый тип тары культуры (для таблицы и edit-формы). active — чтобы
// показать пометку «неактивен» у деактивированного типа, не теряя связь.
export type CulturePackagingTypeRow = {
  id: number; // packaging_type_id
  name: string;
  is_default: boolean;
  active: boolean;
};

// Вью-тип для клиентских компонентов. packagingTypes — разрешённые типы тары
// (с пометкой дефолта). ranges — текущая схема калибров (edit); пусто для simple.
export type CultureRow = {
  id: number;
  name: string;
  color: string;
  acceptance_type: "simple" | "calibre";
  packagingTypes: CulturePackagingTypeRow[];
  ranges: CalibreRangeInput[];
  active: boolean;
};

// Опции для multi-select типа тары в форме (только active).
export type PackagingOption = { id: number; name: string };
