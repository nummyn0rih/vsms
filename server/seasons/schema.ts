import { z } from "zod";

// Единый источник валидации SeasonConfig: форма (zodResolver) и server actions
// (safeParse). Рабочие дни хранятся как массив номеров дней недели (BR-18).

// 0=Пн … 6=Вс. Порядок важен — на нём строится отображение и сортировка.
export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 0, label: "Пн" },
  { value: 1, label: "Вт" },
  { value: 2, label: "Ср" },
  { value: 3, label: "Чт" },
  { value: 4, label: "Пт" },
  { value: 5, label: "Сб" },
  { value: 6, label: "Вс" },
];

// Дефолты BR-18: лето Пн–Сб (6 дней), зима Пн–Пт (5 дней).
export const DEFAULT_SUMMER_WORKDAYS = [0, 1, 2, 3, 4, 5];
export const DEFAULT_WINTER_WORKDAYS = [0, 1, 2, 3, 4];

// Год сезона = год начала (июнь, BR-17). Диапазон — здравые границы.
const SEASON_YEAR_MIN = 2000;
const SEASON_YEAR_MAX = 2100;

const workdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, "Выберите хотя бы один день");

// summer_start/summer_end приходят строкой из <input type="date"> (YYYY-MM-DD).
export const seasonSchema = z
  .object({
    // Строкой из Input (как capacity_kg в packaging) — число резолвим в actions,
    // чтобы input-тип резолвера совпадал с типом полей формы.
    season_year: z
      .string()
      .trim()
      .min(1, "Укажите год")
      .refine((v) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= SEASON_YEAR_MIN && n <= SEASON_YEAR_MAX;
      }, `Год в диапазоне ${SEASON_YEAR_MIN}–${SEASON_YEAR_MAX}`),
    summer_start: z.string().trim().min(1, "Укажите начало лета"),
    summer_end: z.string().trim().min(1, "Укажите конец лета"),
    summer_workdays: workdaysSchema,
    winter_workdays: workdaysSchema,
  })
  .superRefine((val, ctx) => {
    if (val.summer_start && val.summer_end && val.summer_end < val.summer_start) {
      ctx.addIssue({
        code: "custom",
        path: ["summer_end"],
        message: "Конец лета раньше начала",
      });
    }
  });

export type SeasonInput = z.infer<typeof seasonSchema>;

// Вью-тип для клиента: даты как ISO-строки YYYY-MM-DD (Date через границу
// server→client не сериализуем напрямую).
export type SeasonRow = {
  id: number;
  season_year: number;
  summer_start: string;
  summer_end: string;
  summer_workdays: number[];
  winter_workdays: number[];
};

// Массив дней → "Пн, Вт, …" в порядке недели. Используется и в таблице.
export function formatWorkdays(days: number[]): string {
  return WEEKDAYS.filter((d) => days.includes(d.value))
    .map((d) => d.label)
    .join(", ");
}
