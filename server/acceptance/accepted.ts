import { todayLocalISO } from "@/server/shipments/workdays";

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

// --- BR-33. Корректировка расчёта с поставщиком (оплачиваемый вес) ---

// Категория калибра для разноса доплаты. contractLineId — CalibreResult.contract_line_id.
export type SettlementCalibre = {
  percent: number;
  isAccepted: boolean;
  contractLineId: number | null;
};

// Доля ДОПЛАТЫ на строку контракта (не принятого веса — его разносит
// attributeAcceptedToLines в contracts/execution.ts; формулу не дублируем).
export type SettlementAllocation = { contractLineId: number | null; kg: number };

export type Settlement = {
  paidKg: number; // оплачиваемый = принятый + доплата (база ДЕНЕГ)
  surchargeKg: number; // доплата сверх принятого (в тонны выполнения НЕ идёт)
  allocation: SettlementAllocation[]; // разнос доплаты по строкам оплаты
};

// Оплачиваемый вес позиции (BR-33). settlementPercent — ИТОГОВЫЙ % к оплате от ФАКТА
// по договорённости (напр. 97), null = корректировки нет → оплачиваемый = принятый.
//   доплата% = settlement% − принятый%   (принятый% = accepted/actual×100)
//   доплата кг = actual × доплата%/100 ;  оплачиваемый = принятый + доплата
// Доплата разносится по ПРИНЯТЫМ категориям пропорционально их percent, каждая доля —
// по цене СВОЕЙ строки; simple — целиком на строку позиции. Точные значения, без
// округления (округление — только на показе), как computeAcceptedKg.
export function computeSettlement(input: {
  actualKg: number | null;
  acceptedKg: number | null; // из computeAcceptedKg — единый источник формулы принятого
  settlementPercent: number | null;
  itemLineId: number | null; // строка позиции: simple + fallback принятых категорий
  calibres: SettlementCalibre[]; // [] для simple
}): Settlement {
  const { actualKg, acceptedKg, settlementPercent, itemLineId, calibres } = input;
  const none: Settlement = {
    paidKg: acceptedKg ?? 0,
    surchargeKg: 0,
    allocation: [],
  };
  if (
    actualKg == null ||
    acceptedKg == null ||
    settlementPercent == null ||
    actualKg <= 0
  ) {
    return none;
  }

  const acceptedPct = (acceptedKg / actualKg) * 100;
  const surchargePct = settlementPercent - acceptedPct;
  if (surchargePct <= 0) return none; // договорённость не выше принятого — доплаты нет
  const surchargeKg = (actualKg * surchargePct) / 100;

  // simple: вся доплата на строку позиции.
  if (calibres.length === 0) {
    return {
      paidKg: acceptedKg + surchargeKg,
      surchargeKg,
      allocation: [{ contractLineId: itemLineId, kg: surchargeKg }],
    };
  }

  // calibre: пропорционально percent принятых категорий.
  const accepted = calibres.filter((c) => c.isAccepted);
  const den = accepted.reduce((s, c) => s + c.percent, 0);
  // Σ принятых = 0 → разносить доплату НЕКУДА (и такой акт всё равно не оплачивается):
  // отдаём 0 вместо деления на ноль.
  if (den <= 0) return none;

  return {
    paidKg: acceptedKg + surchargeKg,
    surchargeKg,
    allocation: accepted.map((c) => ({
      contractLineId: c.contractLineId ?? itemLineId,
      kg: (surchargeKg * c.percent) / den,
    })),
  };
}

// --- BR-33 × C3d-2: несовместимость двух механизмов оплаты нестандарта ---

// Категория для проверки конфликта. label — ГОТОВАЯ подпись для сообщения
// (calibreRangeLabel на сервере, rangeText в диалогах).
export type SettlementConflictCalibre = {
  label: string;
  isAccepted: boolean;
  contractLineId: number | null;
};

// Непринятая категория оплачивается ЛИБО своей строкой контракта (C3d-2: гейт оплаты —
// contract_line_id != null, см. contracts/execution.ts), ЛИБО через settlement_percent
// (BR-33: доплата от факта). Вместе — двойной счёт: нестандарт попадает и в стоимость
// своей строки, и внутрь доплаты. Реальный дефект прод-данных (+712,4 кг / +39 894 ₽ на
// одной партии), поэтому комбинация запрещается валидацией, а не «складывается аккуратнее».
// Возвращает подпись ПЕРВОЙ конфликтной категории или null, если конфликта нет.
export function findSettlementConflict(
  settlementPercent: number | null,
  calibres: SettlementConflictCalibre[],
): string | null {
  if (settlementPercent == null) return null;
  const bad = calibres.find((c) => !c.isAccepted && c.contractLineId != null);
  return bad ? bad.label : null;
}

// Единый текст отказа — один источник для сервера (saveAct) и подсказки в форме акта.
export function settlementConflictMessage(label: string): string {
  return (
    `Нельзя одновременно: категория «${label}» оплачивается по строке контракта ` +
    `и задан процент к оплате. Уберите строку контракта у непринятой категории ` +
    `или очистите процент — иначе вес оплатится дважды.`
  );
}

// Принятый % от факта — база сравнения для валидации settlement_percent (BR-33) и
// для показа в форме. simple: 100 − brak% · calibre: Σ percent принятых категорий.
export function computeAcceptedPercent(
  brakPercent: number | null,
  calibres: { percent: number; isAccepted: boolean }[],
): number {
  if (calibres.length === 0) return 100 - (brakPercent ?? 0);
  return calibres.filter((c) => c.isAccepted).reduce((s, c) => s + c.percent, 0);
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
  const today = todayLocalISO();
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
