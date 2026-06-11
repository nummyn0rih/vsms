import { z } from "zod";

// Два режима сетки норм. Обе таблицы — пара (farmer, culture) → Decimal, уникум пары.
export type NormKind = "packaging" | "trip";

// Значение нормы > 0 (ноль/отрицательные невалидны — пусто = «нормы нет», не ноль).
export const normValueSchema = z.number().finite().positive();

// Метаданные режима: имя сущности для ChangeLog + поле-значение.
export const KIND_META: Record<
  NormKind,
  { entity: string; valueField: string }
> = {
  packaging: { entity: "PackagingNorm", valueField: "avg_unit_weight_kg" },
  trip: { entity: "TripWeightNorm", valueField: "planned_trip_weight_kg" },
};

// Одна заполненная ячейка (запись нормы существует в БД).
export type NormCell = {
  farmer_id: number;
  culture_id: number;
  value: number;
};

// Строки сетки — активные фермеры.
export type FarmerRow = { id: number; name: string };

// Колонки сетки — активные культуры. has_packaging: задан ли тип тары (нужно для режима тары).
export type CultureCol = {
  id: number;
  name: string;
  color: string;
  has_packaging: boolean;
};
