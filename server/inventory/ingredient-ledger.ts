import { Prisma } from "@/lib/generated/prisma/client";
import type { MovementType } from "@/lib/generated/prisma/client";
import {
  FACTORY_LOCATION_ID,
  TRANSFER_TRANSIT,
  TRANSIT_TO_FARMER,
} from "@/server/shipments/packaging";

// ingredients-factory-source: сводка леджера пары (локация × ингредиент) —
// «остаток на начало · поступило с завода · израсходовано в производство».
//
// Файл БЕЗ prisma и БЕЗ requireRole — ядро покрывается юнит-тестами без БД и сессии
// (эталон — contracts/execution-core.ts, analytics/culture-agg.ts). Загрузчик живёт
// в ./balances (getIngredientMovements), который и так тянет ВСЕ движения пары для
// drill-down: второй свёртки и второго запроса к БД тут не появляется.
//
// Всё в Prisma.Decimal: quantity — Decimal(15,6), микродозы (аскорбинка ~0,00005)
// в number по пути не переводим.

// Чистый DTO — загрузчик маппит из Prisma-результата.
export type LedgerRow = {
  from_location_id: number | null;
  to_location_id: number | null;
  movement_type: MovementType;
  quantity: Prisma.Decimal;
};

export type IngredientLedgerSummary = {
  openingQty: Prisma.Decimal; // movement_type=opening (from=null → локация)
  receivedQty: Prisma.Decimal; // нетто доставок с завода: (−2 → F) − (F → −2)
  transferNet: Prisma.Decimal; // нетто переносов между фермерами через −3, со знаком
  consumedQty: Prisma.Decimal; // нетто расхода в производство: (F → null) − (null → F)
  otherNet: Prisma.Decimal; // всё прочее (adjustment и т.п.) — держит тождество
  balance: Prisma.Decimal; // Σ(to === F) − Σ(from === F), считается независимо
};

const zero = () => new Prisma.Decimal(0);

/**
 * Свёртка движений пары в сводку. `rows` — ВСЕ движения, где локация участвует хотя бы
 * одной стороной (ровно то, что отдаёт запрос drill-down).
 *
 * Тождество, выполняющееся всегда (по построению — каждое движение попадает ровно в одну
 * категорию, а `balance` считается отдельным проходом):
 *
 *   openingQty + receivedQty + transferNet + otherNet − consumedQty === balance
 *
 * Инвариант из спеки «начало + поступило − израсходовано = остаток» — его частный случай
 * для фермера без переносов и ручных правок. Переносы фермер→фермер (−3) выведены в
 * отдельную величину: без неё тождество ломалось бы у любого участника переноса.
 *
 * Нетто, а не «по существованию»: откаты — сторно-движения (append, не delete), поэтому
 * сторно доставки (F → −2) вычитается из receivedQty, а сторно расхода (null → F) — из
 * consumedQty. Полный цикл «доставка → откат → доставка» возвращает исходные величины.
 */
export function summarizeIngredientLedger(
  rows: LedgerRow[],
  locationId: number,
): IngredientLedgerSummary {
  let openingQty = zero();
  let receivedQty = zero();
  let transferNet = zero();
  let consumedQty = zero();
  let otherNet = zero();
  let balance = zero();

  for (const m of rows) {
    const isIn = m.to_location_id === locationId;
    const isOut = m.from_location_id === locationId;
    if (!isIn && !isOut) continue; // движение чужой пары — в выборку попасть не должно

    // Знак для ЭТОЙ локации: приход +, расход −. Движение «сам в себя» даёт 0.
    let signed = zero();
    if (isIn) signed = signed.plus(m.quantity);
    if (isOut) signed = signed.minus(m.quantity);
    balance = balance.plus(signed);

    // Вторая сторона движения — она определяет, откуда/куда ушло относительно локации.
    const counterpart = isIn ? m.from_location_id : m.to_location_id;

    switch (m.movement_type) {
      case "opening":
        openingQty = openingQty.plus(signed);
        break;
      case "consumption":
        // Расход уводит из системы (F → null): signed отрицателен, показатель растёт.
        consumedQty = consumedQty.minus(signed);
        break;
      case "delivery":
        if (counterpart === TRANSFER_TRANSIT) {
          transferNet = transferNet.plus(signed);
        } else if (
          counterpart === TRANSIT_TO_FARMER ||
          counterpart === FACTORY_LOCATION_ID
        ) {
          receivedQty = receivedQty.plus(signed);
        } else {
          otherNet = otherNet.plus(signed);
        }
        break;
      default:
        otherNet = otherNet.plus(signed);
    }
  }

  return {
    openingQty,
    receivedQty,
    transferNet,
    consumedQty,
    otherNet,
    balance,
  };
}
