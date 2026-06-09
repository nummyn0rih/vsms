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

export const cultureSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно"),
  color: z.string().trim().regex(HEX_COLOR, "Цвет в формате #RRGGBB"),
  acceptance_type: z.enum(["simple", "calibre"]),
  // Приходит из Select строкой: "none" | числовой id. Нормализуем в action.
  packaging_type_id: z.string().optional(),
});

export type CultureInput = z.infer<typeof cultureSchema>;

// Вью-тип для клиентских компонентов. packaging_type_name — из связи, чтобы
// показать имя даже у деактивированного типа (в таблице и edit-форме).
export type CultureRow = {
  id: number;
  name: string;
  color: string;
  acceptance_type: "simple" | "calibre";
  packaging_type_id: number | null;
  packaging_type_name: string | null;
  active: boolean;
};

// Опции для Select типа тары в форме (только active).
export type PackagingOption = { id: number; name: string };
