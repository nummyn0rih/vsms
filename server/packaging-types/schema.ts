import { z } from "zod";

// Единый источник валидации PackagingType: импортируется и формой (zodResolver),
// и server actions (safeParse). Не дублировать правила в двух местах.

// Человекочитаемые подписи enum. В БД храним сам enum (box/barrel),
// в UI показываем эти подписи (таблица, опции Select).
export const PACKAGING_KIND_LABELS: Record<"box" | "barrel", string> = {
  box: "Ящик",
  barrel: "Бочка",
};

// capacity_kg приходит из формы строкой (Input). Пустая строка = «не задано».
// Условие (DOMAIN.md §2): barrel → ёмкость обязательна; box → ёмкость = null.
// superRefine на плоском объекте (не discriminatedUnion) — чтобы у формы был
// единый shape и удобный RHF watch. В Zod 4 ctx.path удалён, поэтому ошибку
// вешаем на поле явным path в addIssue.
export const packagingTypeSchema = z
  .object({
    name: z.string().trim().min(1, "Название обязательно"),
    kind: z.enum(["box", "barrel"]),
    capacity_kg: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.kind !== "barrel") return; // для ящика ёмкость игнорируется
    const raw = val.capacity_kg?.trim();
    const n = raw ? Number(raw) : NaN;
    if (!raw || Number.isNaN(n) || n <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["capacity_kg"],
        message: "Для бочки укажите ёмкость в кг (> 0)",
      });
    }
  });

export type PackagingTypeInput = z.infer<typeof packagingTypeSchema>;

// Вью-тип для клиентских компонентов: Prisma.Decimal не сериализуется через
// границу server→client, поэтому capacity_kg отдаём как number | null.
export type PackagingTypeRow = {
  id: number;
  name: string;
  kind: "box" | "barrel";
  capacity_kg: number | null;
  active: boolean;
};
