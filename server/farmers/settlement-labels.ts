import type { SettlementUnpaid, SheetItemStatus } from "./settlement-agg";

// Подписи расчётного листа, общие для ЭКРАНА (вкладка «Расчёты») и ПЕЧАТИ
// (app/print/settlement/[farmerId]). Одна точка намеренно: печать обязана называть
// причины и статусы теми же словами, что экран, иначе фермеру показывают два разных
// документа. Скопированный текст разъезжается при первой же правке формулировки.
//
// Файл prisma-free: типы тянутся ТОЛЬКО через `import type` (стирается на сборке), сам
// модуль — голые строки. Иначе Prisma.Decimal из settlement-agg уехал бы в клиентский
// бандл вместе с SettlementPanel. Тот же приём, что у settlement-period.ts.

// «Вес есть — денег нет»: почему позиция не попала ни в одну строку листа.
export const UNPAID_REASON: Record<SettlementUnpaid["reason"], string> = {
  no_line: "нет строки контракта",
  foreign_line: "строка другого контракта или сезона",
  no_weight: "нет перевески",
};

export const PENDING_STATUS: Record<SheetItemStatus, string> = {
  planned: "запланирована",
  sent: "в пути",
  arrived: "прибыла, не принята",
  // Аномалия данных: отгрузка принята, а акта у позиции нет — считать по ней нечего.
  accepted: "принята, но акта нет",
};
