import { KG_PER_TON } from "@/server/analytics/culture-agg";

// Средний фактический вес рейса и прогноз «осталось ~N машин» — БЕЗ prisma, чтобы ими могли
// пользоваться чистые ядра (server/farmers/analytics-agg.ts тестируется без БД). Раньше
// aggregateActualTripWeight жила в ./dashboard, который импортирует prisma на верхнем уровне.
// Тело перенесено вербатим; dashboard её ре-экспортирует (тот же приём, что с week-axis.ts).

// Средний фактический вес овощного рейса за сезон (BR-14, §5). Вход — по одной записи
// на овощную машину (arrived/accepted, уже отфильтрованную по сезону): список
// actual_weight_kg её позиций (null = не взвешена). Позиции без факта не считаются нулём;
// машина исключается целиком, только если факта нет ни у одной позиции. Чистая — тестируема.
export function aggregateActualTripWeight(
  trips: { itemActualsKg: (number | null)[] }[],
): { avgActualTripWeightT: number | null; weighedTripsCount: number } {
  let sumKg = 0;
  let count = 0;
  for (const t of trips) {
    const weighed = t.itemActualsKg.filter((w): w is number => w != null);
    if (weighed.length === 0) continue; // машина без перевески — исключаем
    sumKg += weighed.reduce((s, w) => s + w, 0); // tripWeight = Σ факт позиций
    count += 1;
  }
  return {
    avgActualTripWeightT: count > 0 ? sumKg / count / KG_PER_TON : null,
    weighedTripsCount: count,
  };
}

// «Осталось ~N машин» по одной контрактной строке/культуре (DOMAIN §5).
// ⚠ Три исхода намеренно различны:
//   null — базы нет (ни перевешенных рейсов, ни нормы) → UI рисует «—», не ноль;
//   0    — перевыполнение: остаток отрицательный, машин больше не нужно;
//   ceil — машина неделима, половину рейса не пришлёшь.
// Отрицательный остаток НЕ превращается в отрицательное число машин.
export function remainingTripsOf(
  remainingKg: number,
  avgTripKg: number | null,
): number | null {
  if (avgTripKg == null || avgTripKg <= 0) return null;
  if (remainingKg <= 0) return 0;
  return Math.ceil(remainingKg / avgTripKg);
}
