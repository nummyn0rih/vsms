import { describe, expect, it } from "vitest";

import type { SettlementPeriod } from "@/server/farmers/settlement-period";
import { settlementPrintHref } from "./settlement-print-href";

// Инвариант: ссылка на печатный лист строится из НОРМАЛИЗОВАННОГО периода, поэтому
// на бумагу не может уехать значение, которое экран уже отверг.

const farmer = { id: 7, name: "Иванов И. И." };

function href(period: SettlementPeriod) {
  return settlementPrintHref({ farmer, season: 2026, period });
}

describe("settlementPrintHref", () => {
  it("сезон — только ?season=, параметров периода нет", () => {
    expect(
      href({ kind: "season", from: null, to: null, label: "Сезон 2026", isSeason: true }),
    ).toBe("/print/settlement/7?season=2026");
  });

  it("месяц — период и якорь from, без to", () => {
    expect(
      href({
        kind: "month",
        from: "2026-08-01",
        to: "2026-08-31",
        label: "Август 2026",
        isSeason: false,
      }),
    ).toBe("/print/settlement/7?season=2026&period=month&from=2026-08-01");
  });

  it("неделя — период и якорь from, без to", () => {
    expect(
      href({
        kind: "week",
        from: "2026-08-03",
        to: "2026-08-09",
        label: "Неделя 32 · 3–9 авг",
        isSeason: false,
      }),
    ).toBe("/print/settlement/7?season=2026&period=week&from=2026-08-03");
  });

  it("свой диапазон — обе границы", () => {
    expect(
      href({
        kind: "custom",
        from: "2026-08-01",
        to: "2026-08-15",
        label: "01.08.2026 – 15.08.2026",
        isSeason: false,
      }),
    ).toBe("/print/settlement/7?season=2026&period=custom&from=2026-08-01&to=2026-08-15");
  });

  it("период без границ вырождается в сезон, а не в битую ссылку", () => {
    expect(
      href({ kind: "month", from: null, to: null, label: "Август 2026", isSeason: false }),
    ).toBe("/print/settlement/7?season=2026");
  });
});
