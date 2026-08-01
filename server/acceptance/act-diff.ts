// Диф калибр-категорий акта для ChangeLog (BR-16: запись на КАЖДОЕ изменённое поле).
// Чистый модуль (без prisma) — CalibreResult заменяется целиком (deleteMany+createMany
// в saveAct), поэтому «что изменилось» видно только из сравнения снимков до/после.
// Одна сводная строка на весь набор: категорий у культуры единицы, отдельная запись
// ChangeLog на каждую превратила бы журнал в шум.

export type CalibreSnapshot = {
  calibreRangeId: number;
  percent: number;
  contractLineId: number | null;
};

const EMPTY = "—";

// Проценты в журнале — как в UI: до 2 знаков, запятая. Локаль не зовём (Intl в тестах
// зависит от сборки Node), формат простой и стабильный.
function fmtPct(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

function fmtLine(id: number | null): string {
  return id == null ? EMPTY : String(id);
}

// Возвращает человекочитаемую сводку изменений или null, если набор не изменился
// (тогда записи в журнал не будет — пустой диф логировать нечем).
// Пример: «6–9 см 40 %→45 %; >12 см строка: 12→—; <4 см убрана».
export function diffCalibreResults(
  before: CalibreSnapshot[],
  after: CalibreSnapshot[],
  labelOf: (rangeId: number) => string,
): string | null {
  const beforeById = new Map(before.map((c) => [c.calibreRangeId, c]));
  const afterById = new Map(after.map((c) => [c.calibreRangeId, c]));

  const parts: string[] = [];

  // Порядок вывода — как в новом наборе (он же порядок категорий формы), удалённые
  // категории дописываются в конце.
  for (const a of after) {
    const label = labelOf(a.calibreRangeId);
    const b = beforeById.get(a.calibreRangeId);
    if (!b) {
      parts.push(`${label} добавлена ${fmtPct(a.percent)} %`);
      continue;
    }
    const bits: string[] = [];
    if (b.percent !== a.percent) {
      bits.push(`${fmtPct(b.percent)} %→${fmtPct(a.percent)} %`);
    }
    if (b.contractLineId !== a.contractLineId) {
      bits.push(`строка: ${fmtLine(b.contractLineId)}→${fmtLine(a.contractLineId)}`);
    }
    if (bits.length > 0) parts.push(`${label} ${bits.join(", ")}`);
  }

  for (const b of before) {
    if (!afterById.has(b.calibreRangeId)) {
      parts.push(`${labelOf(b.calibreRangeId)} убрана`);
    }
  }

  return parts.length > 0 ? parts.join("; ") : null;
}
