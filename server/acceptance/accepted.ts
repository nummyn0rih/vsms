// Чистые хелперы приёмки (без prisma) — переиспользуются лентой и сервером.

// Принятый вес позиции из акта (BR-10, одноступенчато: база = факт). Считается из ТОЧНЫХ
// значений, НЕ округляется (округление — только на показе, фикс 9). Возвращает кг (number)
// или null, если веса нет.
//   simple  (нет категорий) → actual × (1 − brak%/100)
//   calibre (есть категории) → actual × Σ(percent где is_accepted) / 100
//   (брак — одна из долей 100% факта наравне с категориями, отдельно НЕ вычитается)
export function computeAcceptedKg(
  actualKg: number | null,
  brakPercent: number | null,
  calibres: { percent: number; isAccepted: boolean }[],
): number | null {
  if (actualKg == null) return null;
  if (calibres.length === 0) {
    const brak = brakPercent ?? 0;
    return actualKg * (1 - brak / 100); // simple
  }
  const acceptedPct = calibres
    .filter((c) => c.isAccepted)
    .reduce((s, c) => s + c.percent, 0);
  return (actualKg * acceptedPct) / 100;
}

// Средневзвешенный брак по фактическому весу: Σ(actual×brak%) / Σ actual.
// Пустой набор ИЛИ Σ actual = 0 → 0. База — факт (BR-10/§5). Единая формула для
// печатной приёмки и аналитики (per-culture + total).
export function computeWeightedBrak(
  rows: { actualKg: number; brakPercent: number }[],
): number {
  const den = rows.reduce((s, r) => s + r.actualKg, 0);
  if (den <= 0) return 0;
  return rows.reduce((s, r) => s + r.brakPercent * r.actualKg, 0) / den;
}

// Подпись калибр-категории для показа (чипы зоны 3). Размерная — из min/max (см),
// безразмерная (оба null) — label категории. Числа уже в см (number|null).
export function calibreRangeLabel(
  minCm: number | null,
  maxCm: number | null,
  fallbackLabel: string,
): string {
  if (minCm != null && maxCm != null) return `${minCm}–${maxCm} см`;
  if (minCm != null) return `>${minCm} см`;
  if (maxCm != null) return `<${maxCm} см`;
  return fallbackLabel;
}

// Смарт-дефолт даты прибытия (BR-24б): плановая в прошлом → берём её (отгрузка
// задним числом); иначе сегодня. Общий хелпер — зовут десктопная MarkArrivedButton
// и мобильный MobileArrivalSheet, без дублирования расчёта.
export function arrivalDateDefault(plannedArrivalDate: string | null): {
  today: string;
  planned: string | null;
  plannedIsPast: boolean;
  defaultChoice: "planned" | "today";
} {
  const today = new Date().toISOString().slice(0, 10);
  const planned = plannedArrivalDate ?? null;
  const plannedIsPast = planned != null && planned < today;
  return {
    today,
    planned,
    plannedIsPast,
    defaultChoice: plannedIsPast ? "planned" : "today",
  };
}

// № акта в рамках сезона (BR-9): хранится с префиксом года сезона «{season}-{введённое}».
// Глобальный @unique на act_number => уникум по паре (сезон, введённое) без миграции.
export function withSeasonPrefix(input: string, season: number): string {
  return `${season}-${input}`;
}

// Снять префикс сезона для показа в инпуте/тултипе. Если хранимое значение не начинается
// с «{season}-» (старые данные без префикса) — вернуть как есть.
export function stripSeasonPrefix(stored: string, season: number): string {
  const prefix = `${season}-`;
  return stored.startsWith(prefix) ? stored.slice(prefix.length) : stored;
}
