import { describe, expect, it } from "vitest";

import {
  buildSendPreview,
  daySummary,
  feedOptionCounts,
  filterFeedWeeks,
  weekSummary,
  type FeedDay,
  type FeedFilters,
  type FeedItem,
  type FeedShipment,
  type FeedWeek,
} from "./feed";

// Лента отгрузок: фильтры (те же оси, что в приёмке, плюс статус и hidePlanned) и
// подытоги. Итоги тоннажа считаются по ПЛАНОВОМУ весу (плановые машины ещё не
// взвешены), факт и принятое суммируются отдельно; тара агрегируется по kind.

const FARMER = { ivanov: 1, petrov: 2 };
const CULTURE = { tomato: 10, cucumber: 20 };
const BOX = 5;
const BARREL = 6;

function item(over: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 1,
    farmerId: FARMER.ivanov,
    farmerName: "Иванов",
    cultureId: CULTURE.tomato,
    cultureName: "Томаты",
    color: "#D4322C",
    plannedKg: 1000,
    actualKg: null,
    packagingTypeId: BOX,
    packagingTypeName: "Ящик 20",
    packagingKind: "box",
    tareUnits: 50,
    tareMissingNorm: false,
    contractLineId: null,
    contractLineLabel: null,
    accepted: false,
    acceptedKg: null,
    ...over,
  };
}

function shipment(over: Partial<FeedShipment> = {}): FeedShipment {
  return {
    id: 1,
    code: "М-001",
    status: "planned",
    departureDate: "2026-07-13",
    arrivalDate: "2026-07-15",
    driverName: null,
    transportCompanyName: null,
    driverId: null,
    driverPhone: null,
    driverInfo: null,
    comment: null,
    createdAt: "2026-07-10T09:00:00.000Z",
    items: [item()],
    ...over,
  };
}

function day(date: string, shipments: FeedShipment[]): FeedDay {
  return { date, weekdayName: "понедельник", isWorkday: true, shipments };
}

function week(days: FeedDay[]): FeedWeek {
  return {
    isoYear: 2026,
    isoWeek: 29,
    startDate: "2026-07-13",
    endDate: "2026-07-19",
    position: "current",
    days,
  };
}

const noFilters: FeedFilters = {
  search: "",
  supplierSel: new Set(),
  cultureSel: new Set(),
  statusSel: new Set(),
  hidePlanned: false,
};

function sampleWeeks(): FeedWeek[] {
  return [
    week([
      day("2026-07-13", [
        shipment({ id: 1, code: "М-001", status: "planned" }),
        shipment({
          id: 2,
          code: "М-002",
          status: "sent",
          items: [item({ id: 2, farmerId: FARMER.petrov, farmerName: "Петров" })],
        }),
      ]),
      day("2026-07-14", [
        shipment({
          id: 3,
          code: "М-003",
          status: "accepted",
          items: [
            item({
              id: 3,
              cultureId: CULTURE.cucumber,
              cultureName: "Огурцы",
              color: "#2F9E44",
              actualKg: 980,
              accepted: true,
              acceptedKg: 950,
            }),
          ],
        }),
      ]),
    ]),
    {
      ...week([
        day("2026-07-20", [
          shipment({ id: 4, code: "М-004", status: "planned", items: [item({ id: 4 })] }),
        ]),
      ]),
      isoWeek: 30,
      startDate: "2026-07-20",
      endDate: "2026-07-26",
      position: "future",
    },
  ];
}

describe("filterFeedWeeks", () => {
  it("пустые фильтры возвращают ТОТ ЖЕ массив недель", () => {
    const weeks = sampleWeeks();
    expect(filterFeedWeeks(weeks, noFilters)).toBe(weeks);
  });

  it("фильтр по статусу оставляет только выбранные машины", () => {
    const r = filterFeedWeeks(sampleWeeks(), {
      ...noFilters,
      statusSel: new Set(["accepted"] as const),
    });
    expect(r).toHaveLength(1);
    expect(r[0].days.flatMap((d) => d.shipments).map((s) => s.code)).toEqual(["М-003"]);
  });

  it("hidePlanned убирает плановые машины и пустые после этого недели", () => {
    const r = filterFeedWeeks(sampleWeeks(), { ...noFilters, hidePlanned: true });
    // Вторая неделя состояла только из плановой машины — исчезает целиком.
    expect(r).toHaveLength(1);
    expect(r[0].days.flatMap((d) => d.shipments).map((s) => s.code)).toEqual([
      "М-002",
      "М-003",
    ]);
  });

  it("фильтр по фермеру: машина видна, если подходит хотя бы одна позиция", () => {
    const r = filterFeedWeeks(sampleWeeks(), {
      ...noFilters,
      supplierSel: new Set([FARMER.petrov]),
    });
    expect(r.flatMap((w) => w.days).flatMap((d) => d.shipments).map((s) => s.code)).toEqual(
      ["М-002"],
    );
  });

  it("фильтр по культуре", () => {
    const r = filterFeedWeeks(sampleWeeks(), {
      ...noFilters,
      cultureSel: new Set([CULTURE.cucumber]),
    });
    expect(r.flatMap((w) => w.days).flatMap((d) => d.shipments).map((s) => s.code)).toEqual(
      ["М-003"],
    );
  });

  it("поиск по коду машины, фермеру и культуре (регистр не важен)", () => {
    const codes = (f: Partial<FeedFilters>) =>
      filterFeedWeeks(sampleWeeks(), { ...noFilters, ...f })
        .flatMap((w) => w.days)
        .flatMap((d) => d.shipments)
        .map((s) => s.code);
    expect(codes({ search: "м-004" })).toEqual(["М-004"]);
    expect(codes({ search: "петров" })).toEqual(["М-002"]);
    expect(codes({ search: "огурцы" })).toEqual(["М-003"]);
  });

  it("И между осями: несовпадение по одной оси отсекает машину", () => {
    const r = filterFeedWeeks(sampleWeeks(), {
      ...noFilters,
      supplierSel: new Set([FARMER.petrov]),
      statusSel: new Set(["accepted"] as const),
    });
    expect(r).toEqual([]);
  });

  it("дни и недели без совпадений отсеиваются целиком", () => {
    const r = filterFeedWeeks(sampleWeeks(), { ...noFilters, search: "М-003" });
    expect(r).toHaveLength(1);
    expect(r[0].days).toHaveLength(1);
    expect(r[0].days[0].date).toBe("2026-07-14");
  });
});

describe("feedOptionCounts", () => {
  it("считает машины по фермеру, культуре и статусу", () => {
    const { farmer, culture, status } = feedOptionCounts(sampleWeeks());
    expect(farmer.get(FARMER.ivanov)).toBe(3); // М-001, М-003, М-004
    expect(farmer.get(FARMER.petrov)).toBe(1);
    expect(culture.get(CULTURE.tomato)).toBe(3);
    expect(culture.get(CULTURE.cucumber)).toBe(1);
    expect(status.get("planned")).toBe(2);
    expect(status.get("sent")).toBe(1);
    expect(status.get("accepted")).toBe(1);
  });
});

describe("weekSummary", () => {
  it("тоннаж — по плановому весу, факт и принятое — отдельными суммами", () => {
    const s = weekSummary(sampleWeeks()[0]);
    expect(s.machineCount).toBe(3);
    expect(s.positionCount).toBe(3);
    expect(s.totalKg).toBe(3000); // плановый вес, а не факт
    expect(s.factKg).toBe(980); // null → 0
    expect(s.acceptedKg).toBe(950);
  });

  it("культуры собираются в порядке первого появления с суммой по каждой", () => {
    const s = weekSummary(sampleWeeks()[0]);
    expect(s.cultures.map((c) => [c.name, c.totalKg])).toEqual([
      ["Томаты", 2000],
      ["Огурцы", 1000],
    ]);
  });
});

describe("daySummary", () => {
  it("тара агрегируется по виду (kind), а не по имени типа", () => {
    const d = day("2026-07-13", [
      shipment({
        items: [
          item({ id: 1, packagingTypeId: BOX, packagingKind: "box", tareUnits: 62 }),
          item({
            id: 2,
            packagingTypeId: BOX + 1,
            packagingTypeName: "Ящик 15",
            packagingKind: "box",
            tareUnits: 10,
          }),
          item({
            id: 3,
            packagingTypeId: BARREL,
            packagingTypeName: "Бочка",
            packagingKind: "barrel",
            tareUnits: 8,
          }),
        ],
      }),
    ]);
    expect(daySummary(d).tare).toEqual({ boxes: 72, barrels: 8 });
  });

  it("навал и позиции без нормы в сводку тары не попадают", () => {
    const d = day("2026-07-13", [
      shipment({
        items: [
          item({ id: 1, tareUnits: 50 }),
          // Навал: тип тары не выбран.
          item({
            id: 2,
            packagingTypeId: null,
            packagingTypeName: null,
            packagingKind: null,
            tareUnits: null,
          }),
          // Тип есть, нормы по тройке нет → «?» в UI.
          item({ id: 3, tareUnits: null, tareMissingNorm: true }),
        ],
      }),
    ]);
    const s = daySummary(d);
    expect(s.tare).toEqual({ boxes: 50, barrels: 0 });
    expect(s.hasUnpricedTare).toBe(true);
    expect(s.totalKg).toBe(3000); // тоннаж считается по всем позициям, включая навал
  });

  it("пустой день даёт нули и пустой список культур", () => {
    const s = daySummary(day("2026-07-13", []));
    expect(s).toEqual({
      cultures: [],
      totalKg: 0,
      tare: { boxes: 0, barrels: 0 },
      hasUnpricedTare: false,
      factKg: 0,
      acceptedKg: 0,
    });
  });
});

describe("buildSendPreview", () => {
  it("группирует посчитанную тару по фермеру и типу, с разбивкой по культурам", () => {
    const preview = buildSendPreview([
      item({ id: 1, tareUnits: 62 }),
      item({
        id: 2,
        cultureId: CULTURE.cucumber,
        cultureName: "Огурцы",
        tareUnits: 41,
      }),
      item({
        id: 3,
        farmerId: FARMER.petrov,
        farmerName: "Петров",
        packagingTypeId: BARREL,
        packagingTypeName: "Бочка",
        packagingKind: "barrel",
        tareUnits: 9,
      }),
    ]);
    expect(preview.totals).toEqual({ boxes: 103, barrels: 9 });
    expect(preview.farmersCount).toBe(2);
    expect(preview.groups).toHaveLength(2);
    const ivanov = preview.groups.find((g) => g.farmerId === FARMER.ivanov)!;
    expect(ivanov.lines).toHaveLength(1); // один тип тары — одна строка
    expect(ivanov.lines[0].units).toBe(103);
    expect(ivanov.lines[0].cultures).toEqual([
      { name: "Томаты", units: 62 },
      { name: "Огурцы", units: 41 },
    ]);
  });

  it("навал не идёт в списание и не считается позицией с тарой", () => {
    const preview = buildSendPreview([
      item({ id: 1, tareUnits: 50 }),
      item({
        id: 2,
        packagingTypeId: null,
        packagingTypeName: null,
        packagingKind: null,
        tareUnits: null,
      }),
    ]);
    expect(preview.totalTarePositions).toBe(1);
    expect(preview.computedPositions).toBe(1);
    expect(preview.missing).toEqual([]);
  });

  it("позиция без нормы попадает в missing и НЕ попадает в итоги", () => {
    const preview = buildSendPreview([
      item({ id: 1, tareUnits: 50 }),
      item({ id: 2, tareUnits: null, tareMissingNorm: true }),
    ]);
    expect(preview.totals).toEqual({ boxes: 50, barrels: 0 });
    expect(preview.totalTarePositions).toBe(2);
    expect(preview.computedPositions).toBe(1);
    expect(preview.missing).toEqual([
      { cultureName: "Томаты", farmerName: "Иванов", packagingName: "Ящик 20" },
    ]);
  });
});
