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

// Одна заполненная ячейка (запись нормы существует в БД). packaging_type_id —
// только для packaging (норма по тройке); для trip null.
export type NormCell = {
  farmer_id: number;
  culture_id: number;
  packaging_type_id: number | null;
  value: number;
};

// Строки сетки — активные фермеры.
export type FarmerRow = { id: number; name: string };

// Колонки сетки — активные культуры. packaging_type_ids — разрешённые типы тары
// (матрица показывает только культуры РОВНО с одним типом; многотиповые — в отдельном
// редакторе). Пусто = навал, в режиме тары не показывается.
export type CultureCol = {
  id: number;
  name: string;
  color: string;
  packaging_type_ids: number[];
};

// Тип тары для редактора многотиповых норм (колонки таблицы).
export type PackagingTypeCol = { id: number; name: string };
