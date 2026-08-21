import type { FarmerSettlement } from "@/server/farmers/settlement-agg";

// Ссылка на печатный лист расчёта (/print/settlement/[farmerId]).
//
// ⚠ Период берётся из НОРМАЛИЗОВАННОГО data.period, а не из сырого URL страницы:
// resolveSettlementPeriod уже уронил битые значения («2026-02-30», from > to, чужой
// period) в «сезон», и лист обязан напечатать ровно то, что видно на экране. Сырой
// ?from= протащил бы мусор на бумагу.
//
// Для month/week отдаём только `from` — он ЯКОРЬ (любая дата внутри периода), границы
// лист пересчитает сам тем же resolveSettlementPeriod. `to` в ссылке был бы дублем,
// который может разъехаться с якорем.
export function settlementPrintHref(
  d: Pick<FarmerSettlement, "farmer" | "season" | "period">,
): string {
  const base = `/print/settlement/${d.farmer.id}?season=${d.season}`;
  const p = d.period;

  if (p.kind === "custom" && p.from != null && p.to != null) {
    return `${base}&period=custom&from=${p.from}&to=${p.to}`;
  }
  if ((p.kind === "month" || p.kind === "week") && p.from != null) {
    return `${base}&period=${p.kind}&from=${p.from}`;
  }
  // Сезон (и любой период без границ) — параметров периода не добавляем: лист сам
  // упадёт в сезон, это его дефолт.
  return base;
}
