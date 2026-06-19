import { z } from "zod";

// Источник истины по форме/валидации целей плана (BR-20/21/22). Чистый модуль —
// без prisma, можно импортировать в client-компоненты (типы сетки PlanWeek).

export const ENTITY = "WeeklyPlan";

const positiveInt = z.number().int().positive();
// Дата дневной цели приходит строкой YYYY-MM-DD (как в seasons/shipments).
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Некорректная дата");

// Ключ (неделя, культура) + признак гранулярности через date (null = недельная).
export const planKeySchema = z.object({
  seasonYear: positiveInt,
  isoYear: positiveInt,
  isoWeek: z.number().int().min(1).max(53),
  cultureId: positiveInt,
});
export type PlanKey = z.infer<typeof planKeySchema>;

// target в тоннах, хранится Decimal(12,3) → 3 знака (милли-тонны) точно.
const targetTons = z.number().positive("Цель должна быть больше 0");

export const upsertPlanTargetSchema = planKeySchema.extend({
  date: isoDate.nullable(),
  targetTons,
});
export type UpsertPlanTargetInput = z.infer<typeof upsertPlanTargetSchema>;

export const deletePlanTargetSchema = planKeySchema.extend({
  date: isoDate.nullable(),
});
export type DeletePlanTargetInput = z.infer<typeof deletePlanTargetSchema>;

// --- Типы формы сетки (заполняются board.ts, читаются PlanView) ---

export type PlanDay = {
  date: string; // YYYY-MM-DD
  weekdayName: string;
};

export type PlanRow = {
  cultureId: number;
  cultureName: string;
  color: string;
  mode: "day" | "week";
  weekTarget: number | null; // mode === "week"
  dayTargets: Record<string, number>; // mode === "day": date → тонны
};

export type PlanWeek = {
  seasonYear: number;
  isoYear: number;
  isoWeek: number;
  startDate: string;
  endDate: string;
  days: PlanDay[]; // рабочие дни недели (колонки сетки)
  rows: PlanRow[]; // по активным культурам
};
