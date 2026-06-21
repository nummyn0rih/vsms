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
