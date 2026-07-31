import { describe, expect, it } from "vitest";

import { Prisma } from "@/lib/generated/prisma/client";
import type { ExecItem } from "@/server/contracts/execution-core";
import {
  UNBOUND_LINE,
  buildSettlementSheet,
  isInPeriod,
  resolveSettlementPeriod,
  shiftSettlementPeriod,
  type SheetItem,
  type SheetLine,
} from "./settlement-agg";

// Инварианты расчётного листа: Σ партий = итог строки, две базы веса (выполнение — от
// принятого, деньги — от оплачиваемого), два скоупа (деньги за период, план за сезон),
// исчерпывающее разбиение веса (ни один килограмм не теряется). Формулы здесь не
// проверяются — они покрыты accepted.test.ts и scripts/settlement-verify.ts.

const D = (n: number | string) => new Prisma.Decimal(n);
const SEASON = 2026;
const TODAY = "2026-08-14"; // пятница, ISO-неделя 33

// --- Эталон BR-33 (тот же, что в scripts/settlement-verify.ts) ---
// Огурцы, факт 6850 кг: 6–9 см 53,7% · 9–12 см 34,5% (принятые, строки 101/102),
// >12 нестандарт 10,4% (без строки), брак 1,4%. Договорённость — 97% от факта.
const ACTUAL = 6850;
const L69 = 101;
const L912 = 102;
const PRICE_69 = 38;
const PRICE_912 = 30;

const REF_CALIBRES = [
  { percent: 53.7, isAccepted: true, contractLineId: L69 },
  { percent: 34.5, isAccepted: true, contractLineId: L912 },
  { percent: 10.4, isAccepted: false, contractLineId: null },
];

function line(p: Partial<SheetLine> & { lineId: number }): SheetLine {
  return {
    lineId: p.lineId,
    contractId: p.contractId ?? 1,
    cultureId: p.cultureId ?? 1,
    cultureName: p.cultureName ?? "Огурец",
    color: p.color ?? "#2f6f3e",
    label: p.label ?? "",
    volumeTons: p.volumeTons ?? D(100),
    price: p.price ?? D(PRICE_69),
  };
}

function exec(p: Partial<ExecItem> = {}): ExecItem {
  return {
    actualKg: p.actualKg !== undefined ? p.actualKg : D(ACTUAL),
    brakPercent: p.brakPercent !== undefined ? p.brakPercent : 1.4,
    contractLineId: p.contractLineId !== undefined ? p.contractLineId : L69,
    calibres: p.calibres ?? [],
    settlementPercent: p.settlementPercent !== undefined ? p.settlementPercent : null,
  };
}

function item(p: Partial<SheetItem> & { itemId: number }): SheetItem {
  return {
    itemId: p.itemId,
    actNumber: p.actNumber ?? `${p.itemId}`,
    date: p.date !== undefined ? p.date : "2026-08-10",
    cultureName: p.cultureName ?? "Огурец",
    color: p.color ?? "#2f6f3e",
    status: p.status ?? "accepted",
    plannedKg: p.plannedKg ?? 7000,
    exec: p.exec !== undefined ? p.exec : exec(),
  };
}

function sheet(p: {
  lines: SheetLine[];
  items: SheetItem[];
  period?: ReturnType<typeof resolveSettlementPeriod>;
}) {
  return buildSettlementSheet({
    farmer: { id: 1, name: "Тестовый" },
    season: SEASON,
    period: p.period ?? resolveSettlementPeriod({ season: SEASON, today: TODAY }),
    lines: p.lines,
    items: p.items,
    generatedAt: TODAY,
  });
}

const monthOf = (anchor: string) =>
  resolveSettlementPeriod({ period: "month", from: anchor, season: SEASON, today: TODAY });

describe("resolveSettlementPeriod", () => {
  it("по умолчанию — сезон целиком (границы null, isSeason)", () => {
    const p = resolveSettlementPeriod({ season: SEASON, today: TODAY });
    expect(p).toMatchObject({ kind: "season", from: null, to: null, isSeason: true });
    expect(p.label).toBe("Сезон 2026");
  });

  it("месяц: границы календарные, включительные", () => {
    const p = monthOf("2026-08-14");
    expect(p).toMatchObject({ kind: "month", from: "2026-08-01", to: "2026-08-31" });
    expect(p.label).toBe("Август 2026");
  });

  it("месяц: февраль високосного года берёт 29 число", () => {
    expect(monthOf("2028-02-10").to).toBe("2028-02-29");
  });

  it("месяц без from — текущий по todayLocalISO", () => {
    const p = resolveSettlementPeriod({ period: "month", season: SEASON, today: TODAY });
    expect(p.from).toBe("2026-08-01");
  });

  it("неделя: понедельник–воскресенье ISO", () => {
    const p = resolveSettlementPeriod({
      period: "week",
      from: "2026-08-14",
      season: SEASON,
      today: TODAY,
    });
    expect(p).toMatchObject({ kind: "week", from: "2026-08-10", to: "2026-08-16" });
    expect(p.label).toBe("Неделя 33 · 10–16 авг");
  });

  it("свой диапазон: обе границы валидны и from ≤ to", () => {
    const p = resolveSettlementPeriod({
      period: "custom",
      from: "2026-07-12",
      to: "2026-07-20",
      season: SEASON,
      today: TODAY,
    });
    expect(p).toMatchObject({ kind: "custom", from: "2026-07-12", to: "2026-07-20" });
    expect(p.label).toBe("12.07.2026 – 20.07.2026");
  });

  it("невалид падает в сезон: чужой формат, несуществующая дата, from > to, нет пары", () => {
    const bad = [
      { period: "custom", from: "12.07.2026", to: "2026-07-20" },
      { period: "custom", from: "2026-02-30", to: "2026-03-05" },
      { period: "custom", from: "2026-07-20", to: "2026-07-12" },
      { period: "custom", from: "2026-07-12" },
      { period: "quarter", from: "2026-07-12", to: "2026-07-20" },
    ];
    for (const b of bad) {
      expect(resolveSettlementPeriod({ ...b, season: SEASON, today: TODAY }).kind).toBe(
        "season",
      );
    }
  });

  it("устаревший to в URL месяц/неделю не портит — границы считаются от якоря", () => {
    const p = resolveSettlementPeriod({
      period: "month",
      from: "2026-08-14",
      to: "2026-01-01",
      season: SEASON,
      today: TODAY,
    });
    expect(p.to).toBe("2026-08-31");
  });
});

describe("shiftSettlementPeriod", () => {
  it("месяц: назад через границу года", () => {
    const p = shiftSettlementPeriod(monthOf("2026-01-15"), -1);
    expect(p).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("месяц: вперёд с 31-го числа не перескакивает через месяц", () => {
    const p = shiftSettlementPeriod(monthOf("2026-01-31"), 1);
    expect(p).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("неделя: ровно ±7 дней", () => {
    const w = resolveSettlementPeriod({
      period: "week",
      from: "2026-08-14",
      season: SEASON,
      today: TODAY,
    });
    expect(shiftSettlementPeriod(w, -1)).toMatchObject({ from: "2026-08-03", to: "2026-08-09" });
    expect(shiftSettlementPeriod(w, 1)).toMatchObject({ from: "2026-08-17", to: "2026-08-23" });
  });

  it("сезон не сдвигается (стрелок у него нет)", () => {
    const s = resolveSettlementPeriod({ season: SEASON, today: TODAY });
    expect(shiftSettlementPeriod(s, 1)).toEqual(s);
  });
});

describe("isInPeriod", () => {
  const aug = monthOf("2026-08-14");

  it("границы включительные с обеих сторон", () => {
    expect(isInPeriod("2026-08-01", aug)).toBe(true);
    expect(isInPeriod("2026-08-31", aug)).toBe(true);
    expect(isInPeriod("2026-07-31", aug)).toBe(false);
    expect(isInPeriod("2026-09-01", aug)).toBe(false);
  });

  it("позиция без даты входит только в сезон", () => {
    const season = resolveSettlementPeriod({ season: SEASON, today: TODAY });
    expect(isInPeriod(null, season)).toBe(true);
    expect(isInPeriod(null, aug)).toBe(false);
  });
});

describe("buildSettlementSheet — эталон BR-33 (calibre, две строки)", () => {
  const lines = [
    line({ lineId: L69, label: "6–9 см", price: D(PRICE_69), volumeTons: D(100) }),
    line({ lineId: L912, label: "9–12 см", price: D(PRICE_912), volumeTons: D(50) }),
  ];
  const items = [
    item({
      itemId: 1,
      exec: exec({ calibres: REF_CALIBRES, settlementPercent: 97 }),
    }),
  ];
  const s = sheet({ lines, items });
  const l69 = s.lines.find((l) => l.lineId === L69)!;
  const l912 = s.lines.find((l) => l.lineId === L912)!;

  it("зачтено по строкам = actual × percent категории", () => {
    expect(l69.countedKg).toBeCloseTo(ACTUAL * 0.537, 9);
    expect(l912.countedKg).toBeCloseTo(ACTUAL * 0.345, 9);
  });

  it("доплата разнесена пропорционально принятым категориям", () => {
    const surcharge = (ACTUAL * (97 - 88.2)) / 100;
    expect(l69.surchargeKg).toBeCloseTo((surcharge * 53.7) / 88.2, 9);
    expect(l912.surchargeKg).toBeCloseTo((surcharge * 34.5) / 88.2, 9);
    expect(l69.surchargeKg + l912.surchargeKg).toBeCloseTo(surcharge, 9);
  });

  it("к оплате = зачтено + доплата; сумма = к оплате × цена строки", () => {
    expect(l69.paidKg).toBeCloseTo(l69.countedKg + l69.surchargeKg, 9);
    expect(l69.costRub).toBeCloseTo(l69.paidKg * PRICE_69, 9);
    expect(l912.costRub).toBeCloseTo(l912.paidKg * PRICE_912, 9);
  });

  it("Σ партий = итог строки (тождественно, по всем четырём величинам)", () => {
    for (const l of s.lines) {
      const sum = l.batches.reduce(
        (a, b) => ({
          counted: a.counted + b.countedKg,
          surcharge: a.surcharge + b.surchargeKg,
          paid: a.paid + b.paidKg,
          cost: a.cost + b.costRub,
        }),
        { counted: 0, surcharge: 0, paid: 0, cost: 0 },
      );
      expect(sum.counted).toBeCloseTo(l.countedKg, 9);
      expect(sum.surcharge).toBeCloseTo(l.surchargeKg, 9);
      expect(sum.paid).toBeCloseTo(l.paidKg, 9);
      expect(sum.cost).toBeCloseTo(l.costRub, 9);
    }
  });

  it("доплата НЕ идёт в тонны выполнения (BR-33): season.countedKg без неё", () => {
    expect(l69.season.countedKg).toBeCloseTo(ACTUAL * 0.537, 9);
    expect(l69.season.pct).toBeCloseTo(((ACTUAL * 0.537) / 100_000) * 100, 9);
    expect(l69.season.countedKg).toBeLessThan(l69.paidKg);
  });

  it("нестандарт без строки не оплачивается и не попадает в «без привязки»", () => {
    // По DOMAIN §5 это статистика, а не непривязанные деньги: он и в принятый вес не входит.
    expect(s.unpaid).toHaveLength(0);
    expect(s.lines.reduce((a, l) => a + l.countedKg, 0)).toBeCloseTo(ACTUAL * 0.882, 9);
  });

  it("контекст партии: принято по акту ≠ зачтено в строку, факт не суммируется", () => {
    const b = l69.batches[0];
    expect(b.position.acceptedKg).toBeCloseTo(6041.7, 6);
    expect(b.position.acceptedPercent).toBeCloseTo(88.2, 9);
    expect(b.position.nonStandardPercent).toBeCloseTo(10.4, 9);
    expect(b.position.linesCount).toBe(2); // партия делится на две строки
    expect(b.countedKg).not.toBeCloseTo(b.position.acceptedKg!, 6);
    expect(s.notes.splitBatchCount).toBe(1);
    expect(s.notes.hasSurcharge).toBe(true);
  });

  it("итоги = Σ по строкам, % выполнения от принятого", () => {
    expect(s.totals.countedKg).toBeCloseTo(l69.countedKg + l912.countedKg, 9);
    expect(s.totals.costRub).toBeCloseTo(l69.costRub + l912.costRub, 9);
    expect(s.totals.season.targetKg).toBeCloseTo(150_000, 9);
    expect(s.totals.season.pct).toBeCloseTo(
      (s.totals.season.countedKg / 150_000) * 100,
      9,
    );
  });
});

describe("buildSettlementSheet — simple без корректировки", () => {
  const s = sheet({
    lines: [line({ lineId: L69, volumeTons: D(10) })],
    items: [item({ itemId: 1, exec: exec({ brakPercent: 5, calibres: [] }) })],
  });
  const l = s.lines[0];

  it("доплата 0, к оплате = зачтено = actual × (1 − брак%)", () => {
    expect(l.countedKg).toBeCloseTo(ACTUAL * 0.95, 9);
    expect(l.surchargeKg).toBe(0);
    expect(l.paidKg).toBeCloseTo(l.countedKg, 9);
    expect(l.costRub).toBeCloseTo(l.countedKg * PRICE_69, 9);
    expect(s.notes.hasSurcharge).toBe(false);
  });

  it("для simple зачтённое = принятому по акту (нестандарта нет)", () => {
    const b = l.batches[0];
    expect(b.countedKg).toBeCloseTo(b.position.acceptedKg!, 9);
    expect(b.position.linesCount).toBe(1);
    expect(b.position.nonStandardPercent).toBe(0);
  });
});

describe("buildSettlementSheet — два скоупа (период vs сезон)", () => {
  const lines = [line({ lineId: L69, volumeTons: D(100) })];
  const items = [
    item({ itemId: 1, date: "2026-07-10", exec: exec({ brakPercent: 0 }) }),
    item({ itemId: 2, date: "2026-08-10", exec: exec({ brakPercent: 0 }) }),
    item({ itemId: 3, date: "2026-09-10", exec: exec({ brakPercent: 0 }) }),
  ];

  it("period = сезон → периодные и сезонные числа тождественны", () => {
    const s = sheet({ lines, items });
    expect(s.lines[0].countedKg).toBeCloseTo(s.lines[0].season.countedKg, 9);
    expect(s.totals.countedKg).toBeCloseTo(s.totals.season.countedKg, 9);
  });

  it("узкий период режет деньги, но НЕ план и не выполнение", () => {
    const aug = sheet({ lines, items, period: monthOf("2026-08-14") });
    expect(aug.lines[0].countedKg).toBeCloseTo(ACTUAL, 9); // одна партия августа
    expect(aug.lines[0].batches).toHaveLength(1);
    // Заявлено/выполнение остаются сезонными — по всем трём партиям.
    expect(aug.lines[0].season.countedKg).toBeCloseTo(ACTUAL * 3, 9);
    expect(aug.lines[0].season.targetKg).toBeCloseTo(100_000, 9);
    expect(aug.lines[0].season.remainingKg).toBeCloseTo(100_000 - ACTUAL * 3, 9);
  });

  it("Σ по месяцам = сезон (партиция без потерь на границах июнь→май)", () => {
    // Крайние даты сезона (BR-17): 1 июня 2026 и 31 мая 2027 — ловят off-by-one
    // на первом и последнем месяце.
    const edged = [
      ...items,
      item({ itemId: 4, date: "2026-06-01", exec: exec({ brakPercent: 0 }) }),
      item({ itemId: 5, date: "2027-05-31", exec: exec({ brakPercent: 0 }) }),
    ];
    const season = sheet({ lines, items: edged });
    let sum = 0;
    for (let m = 5; m <= 16; m += 1) {
      const anchor = `${m < 12 ? 2026 : 2027}-${String((m % 12) + 1).padStart(2, "0")}-15`;
      sum += sheet({ lines, items: edged, period: monthOf(anchor) }).totals.countedKg;
    }
    expect(sum).toBeCloseTo(season.totals.countedKg, 9);
    expect(season.totals.countedKg).toBeCloseTo(ACTUAL * 5, 9);
    expect(season.notes.undatedCount).toBe(0);
  });

  it("позиция без даты: в сезон входит, в узкое окно — никогда, и посчитана в notes", () => {
    const withUndated = [...items, item({ itemId: 4, date: null, exec: exec({ brakPercent: 0 }) })];
    const season = sheet({ lines, items: withUndated });
    const aug = sheet({ lines, items: withUndated, period: monthOf("2026-08-14") });
    expect(season.totals.countedKg).toBeCloseTo(ACTUAL * 4, 9);
    expect(aug.lines[0].countedKg).toBeCloseTo(ACTUAL, 9);
    expect(season.notes.undatedCount).toBe(1);
  });
});

describe("buildSettlementSheet — вес есть, денег нет", () => {
  const lines = [line({ lineId: L69, volumeTons: D(10) })];

  it("позиция без строки контракта → no_line, весь принятый вес в секции, суммы нет", () => {
    const s = sheet({
      lines,
      items: [item({ itemId: 1, exec: exec({ contractLineId: null, brakPercent: 5 }) })],
    });
    expect(s.lines[0].countedKg).toBe(0);
    expect(s.lines[0].batches).toHaveLength(0);
    expect(s.unpaid).toHaveLength(1);
    expect(s.unpaid[0]).toMatchObject({ reason: "no_line", foreignLineId: null, partial: false });
    expect(s.unpaid[0].unpaidKg).toBeCloseTo(ACTUAL * 0.95, 9);
    expect(s.totals.costRub).toBe(0);
  });

  it("привязка к строке вне листа (чужой контракт/сезон) → foreign_line с id", () => {
    const s = sheet({
      lines,
      items: [item({ itemId: 1, exec: exec({ contractLineId: 999, brakPercent: 5 }) })],
    });
    expect(s.unpaid[0]).toMatchObject({ reason: "foreign_line", foreignLineId: 999 });
    expect(s.unpaid[0].unpaidKg).toBeCloseTo(ACTUAL * 0.95, 9);
  });

  it("частичная непривязка: строка оплачена, остаток отдельной записью с partial", () => {
    // Строка позиции не задана; категория 6–9 привязана явно, 9–12 — нет → падает
    // на строку позиции, которой нет → в бакет UNBOUND_LINE.
    const s = sheet({
      lines,
      items: [
        item({
          itemId: 1,
          exec: exec({
            contractLineId: null,
            calibres: [
              { percent: 53.7, isAccepted: true, contractLineId: L69 },
              { percent: 34.5, isAccepted: true, contractLineId: null },
            ],
          }),
        }),
      ],
    });
    expect(s.lines[0].countedKg).toBeCloseTo(ACTUAL * 0.537, 9);
    expect(s.unpaid).toHaveLength(1);
    expect(s.unpaid[0]).toMatchObject({ reason: "no_line", partial: true });
    expect(s.unpaid[0].unpaidKg).toBeCloseTo(ACTUAL * 0.345, 9);
  });

  it("ни один килограмм не потерян: Σ(строки) + Σ(без привязки) = Σ оплачиваемого", () => {
    const s = sheet({
      lines,
      items: [
        item({ itemId: 1, exec: exec({ brakPercent: 5 }) }),
        item({ itemId: 2, exec: exec({ contractLineId: null, brakPercent: 5 }) }),
        item({ itemId: 3, exec: exec({ contractLineId: 999, brakPercent: 5 }) }),
      ],
    });
    expect(s.totals.paidKg + s.unpaidTotals.unpaidKg).toBeCloseTo(ACTUAL * 0.95 * 3, 9);
    expect(s.unpaidTotals.positions).toBe(2);
  });

  it("акт есть, перевески нет → no_weight без NaN", () => {
    const s = sheet({
      lines,
      items: [item({ itemId: 1, exec: exec({ actualKg: null }) })],
    });
    expect(s.unpaid[0]).toMatchObject({ reason: "no_weight", actualKg: null, unpaidKg: 0 });
    expect(s.lines[0].countedKg).toBe(0);
    expect(Number.isNaN(s.totals.costRub)).toBe(false);
  });

  it("UNBOUND_LINE не может совпасть с id строки контракта (autoincrement ≥ 1)", () => {
    expect(UNBOUND_LINE).toBeLessThan(1);
  });
});

describe("buildSettlementSheet — краевые случаи и служебные флаги", () => {
  it("объём строки 0 → выполнение 0, без Infinity", () => {
    const s = sheet({
      lines: [line({ lineId: L69, volumeTons: D(0) })],
      items: [item({ itemId: 1, exec: exec({ brakPercent: 0 }) })],
    });
    expect(s.lines[0].season.pct).toBe(0);
    expect(s.totals.season.pct).toBe(0);
    expect(Number.isFinite(s.lines[0].season.pct)).toBe(true);
  });

  it("цена 0: вес есть, сумма 0, флаг hasZeroPrice поднят", () => {
    const s = sheet({
      lines: [line({ lineId: L69, price: D(0), volumeTons: D(10) })],
      items: [item({ itemId: 1, exec: exec({ brakPercent: 0 }) })],
    });
    expect(s.lines[0].countedKg).toBeCloseTo(ACTUAL, 9);
    expect(s.lines[0].costRub).toBe(0);
    expect(s.notes.hasZeroPrice).toBe(true);
  });

  it("позиции без акта → блок «ожидают приёмки», в расчёт не входят", () => {
    const s = sheet({
      lines: [line({ lineId: L69, volumeTons: D(10) })],
      items: [
        item({ itemId: 1, exec: exec({ brakPercent: 0 }) }),
        item({ itemId: 2, status: "arrived", exec: null }),
        item({ itemId: 3, status: "sent", exec: null, date: "2026-01-05" }),
      ],
    });
    expect(s.pending.map((p) => p.itemId)).toEqual([3, 2]); // по дате
    expect(s.lines[0].batches).toHaveLength(1);
    expect(s.totals.countedKg).toBeCloseTo(ACTUAL, 9);
  });

  it("позиция без акта не теряется даже при статусе accepted (аномалия данных)", () => {
    const s = sheet({
      lines: [line({ lineId: L69, volumeTons: D(10) })],
      items: [item({ itemId: 1, status: "accepted", exec: null })],
    });
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0].status).toBe("accepted");
    expect(s.totals.countedKg).toBe(0);
  });

  it("ожидающие приёмки фильтруются периодом вместе со всем остальным", () => {
    const s = sheet({
      lines: [line({ lineId: L69, volumeTons: D(10) })],
      items: [item({ itemId: 2, status: "arrived", exec: null, date: "2026-01-05" })],
      period: monthOf("2026-08-14"),
    });
    expect(s.pending).toHaveLength(0);
  });

  it("строка без движения остаётся в листе с нулями (план виден)", () => {
    const s = sheet({
      lines: [line({ lineId: L69, volumeTons: D(10) }), line({ lineId: L912, volumeTons: D(5) })],
      items: [item({ itemId: 1, exec: exec({ brakPercent: 0 }) })],
    });
    const idle = s.lines.find((l) => l.lineId === L912)!;
    expect(idle.countedKg).toBe(0);
    expect(idle.costRub).toBe(0);
    expect(idle.season.targetKg).toBeCloseTo(5000, 9);
    expect(idle.season.remainingKg).toBeCloseTo(5000, 9);
  });
});
