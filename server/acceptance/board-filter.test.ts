import { describe, expect, it } from "vitest";

import { anyAcceptanceFilterActive, boardOptions, filterBoard } from "./board-filter";
import type {
  AcceptanceBoard,
  AcceptanceItem,
  AcceptanceMachine,
  AcceptedMachine,
  AcceptedPosition,
} from "./schema";

// Фильтры доски приёмки: И между осями (фермер И культура И поиск), но машина
// АТОМАРНА — она видна целиком, если по каждой оси нашлась хотя бы одна подходящая
// позиция. Скрывать отдельные позиции внутри машины нельзя: приёмка идёт машиной.

const FARMER = { ivanov: 1, petrov: 2, abramov: 3 };
const CULTURE = { tomato: 10, cucumber: 20 };

function item(
  id: number,
  farmerId: number,
  cultureId: number,
  actNumber: string | null = null,
): AcceptanceItem {
  const farmerName = { 1: "Иванов", 2: "Петров", 3: "Абрамов" }[farmerId]!;
  const cultureName = { 10: "Томаты", 20: "Огурцы" }[cultureId]!;
  return {
    id,
    cultureId,
    cultureName,
    color: cultureId === CULTURE.tomato ? "#D4322C" : "#2F9E44",
    farmerId,
    farmerName,
    plannedKg: 1000,
    actualKg: null,
    accepted: actNumber != null,
    actNumber,
  };
}

function machine(
  id: number,
  code: string,
  status: "sent" | "arrived",
  driverName: string | null,
  items: AcceptanceItem[],
  transportCompanyName: string | null = null,
): AcceptanceMachine {
  return {
    id,
    code,
    status,
    departureDate: "2026-07-13",
    arrivalDate: "2026-07-15",
    driverName,
    transportCompanyName,
    driverPhone: null,
    driverInfo: null,
    comment: null,
    weighed: 0,
    acceptedCount: 0,
    total: items.length,
    items,
  };
}

function position(id: number, farmerId: number, cultureId: number): AcceptedPosition {
  const base = item(id, farmerId, cultureId);
  return {
    id: base.id,
    cultureId: base.cultureId,
    cultureName: base.cultureName,
    color: base.color,
    farmerId: base.farmerId,
    farmerName: base.farmerName,
    actNumber: "2026-42",
    actualKg: 1000,
    brakPercent: 1.4,
    acceptedKg: 986,
    settlementPercent: null,
    surchargeKg: 0,
    paidKg: 986,
    calibres: [],
    nonStandard: [],
    lineLabel: null,
    pricePerKg: null,
    costRub: 0,
  };
}

// ⚠ У AcceptedMachine поля items быть не должно: rowsOf дискриминирует по "items" in m.
function acceptedMachine(
  id: number,
  code: string,
  driverName: string | null,
  positions: AcceptedPosition[],
): AcceptedMachine {
  return {
    id,
    code,
    departureDate: "2026-07-13",
    arrivalDate: "2026-07-15",
    driverName,
    transportCompanyName: null,
    driverPhone: null,
    driverInfo: null,
    acceptedCount: positions.length,
    total: positions.length,
    machineSumRub: 0,
    positions,
  };
}

function makeBoard(): AcceptanceBoard {
  const zone1 = [
    machine(1, "М-001", "sent", "Сидоров Пётр", [
      item(101, FARMER.ivanov, CULTURE.tomato),
    ]),
    machine(
      2,
      "М-002",
      "sent",
      "Кузнецов Илья",
      [
        item(102, FARMER.petrov, CULTURE.cucumber),
        item(103, FARMER.petrov, CULTURE.tomato),
      ],
      "ТК Логистик",
    ),
  ];
  // М-003 частично принята: у одной позиции уже есть акт (BR-13 — машина ещё в зоне 2).
  const zone2 = [
    machine(3, "М-003", "arrived", null, [
      item(104, FARMER.ivanov, CULTURE.cucumber),
      item(105, FARMER.abramov, CULTURE.tomato, "2026-7"),
    ]),
  ];
  const zone3 = [
    acceptedMachine(4, "М-004", "Ёлкин Роман", [
      position(106, FARMER.abramov, CULTURE.cucumber),
    ]),
  ];
  return { zone1, zone2, zone3, acceptedCount: zone3.length };
}

const noFilters = {
  search: "",
  supplierSel: new Set<number>(),
  cultureSel: new Set<number>(),
};

describe("anyAcceptanceFilterActive", () => {
  it("пустые фильтры — неактивны, пробелы в поиске не считаются", () => {
    expect(anyAcceptanceFilterActive(noFilters)).toBe(false);
    expect(anyAcceptanceFilterActive({ ...noFilters, search: "   " })).toBe(false);
  });

  it("любая заполненная ось делает фильтры активными", () => {
    expect(anyAcceptanceFilterActive({ ...noFilters, search: "М-001" })).toBe(true);
    expect(
      anyAcceptanceFilterActive({ ...noFilters, supplierSel: new Set([FARMER.ivanov]) }),
    ).toBe(true);
    expect(
      anyAcceptanceFilterActive({ ...noFilters, cultureSel: new Set([CULTURE.tomato]) }),
    ).toBe(true);
  });
});

describe("filterBoard", () => {
  it("пустые фильтры возвращают ТОТ ЖЕ объект board (без копирования)", () => {
    const board = makeBoard();
    expect(filterBoard(board, noFilters)).toBe(board);
  });

  it("фильтр по фермеру: машина видна, если подходит хотя бы одна позиция", () => {
    const board = makeBoard();
    const r = filterBoard(board, {
      ...noFilters,
      supplierSel: new Set([FARMER.abramov]),
    });
    // Абрамов есть в М-003 (одна из двух позиций) и в М-004.
    expect(r.zone1).toHaveLength(0);
    expect(r.zone2.map((m) => m.code)).toEqual(["М-003"]);
    expect(r.zone3.map((m) => m.code)).toEqual(["М-004"]);
    // Позиции внутри машины не режутся — машина атомарна.
    expect(r.zone2[0].items).toHaveLength(2);
  });

  it("фильтр по культуре отбирает машины по любой из позиций", () => {
    const r = filterBoard(makeBoard(), {
      ...noFilters,
      cultureSel: new Set([CULTURE.cucumber]),
    });
    expect(r.zone1.map((m) => m.code)).toEqual(["М-002"]);
    expect(r.zone2.map((m) => m.code)).toEqual(["М-003"]);
    expect(r.zone3.map((m) => m.code)).toEqual(["М-004"]);
  });

  it("И между осями: фермер и культура могут совпасть на РАЗНЫХ позициях машины", () => {
    // М-003: Иванов×Огурцы и Абрамов×Томаты. Пара «Иванов + Томаты» не встречается
    // ни в одной ОДНОЙ позиции, но машина проходит — оси проверяются независимо.
    const r = filterBoard(makeBoard(), {
      ...noFilters,
      supplierSel: new Set([FARMER.ivanov]),
      cultureSel: new Set([CULTURE.tomato]),
    });
    expect(r.zone2.map((m) => m.code)).toEqual(["М-003"]);
    // Ось, по которой совпадений нет вовсе, машину отсекает.
    const none = filterBoard(makeBoard(), {
      ...noFilters,
      supplierSel: new Set([FARMER.petrov]),
      cultureSel: new Set([999]),
    });
    expect([...none.zone1, ...none.zone2]).toHaveLength(0);
  });

  // Код машины (М-001) — внутренний идентификатор БД, на экране его нет: поиском
  // по нему пользователь ничего осмысленного не ищет, ось убрана (acceptance-ux-1).
  it("по коду машины поиск БОЛЬШЕ не находит", () => {
    const r = filterBoard(makeBoard(), { ...noFilters, search: "М-002" });
    expect(r.zone1).toHaveLength(0);
    expect(r.zone2).toHaveLength(0);
    expect(r.zone3).toHaveLength(0);
  });

  it("поиск по имени водителя, регистр не важен", () => {
    const r = filterBoard(makeBoard(), { ...noFilters, search: "кузнецов" });
    expect(r.zone1.map((m) => m.code)).toEqual(["М-002"]);
  });

  it("поиск по транспортной компании, регистр не важен", () => {
    const r = filterBoard(makeBoard(), { ...noFilters, search: "логистик" });
    expect(r.zone1.map((m) => m.code)).toEqual(["М-002"]);
    expect(r.zone2).toHaveLength(0);
    expect(r.zone3).toHaveLength(0);
  });

  it("поиск по № акта — зона 3 (positions)", () => {
    const full = filterBoard(makeBoard(), { ...noFilters, search: "2026-42" });
    expect(full.zone3.map((m) => m.code)).toEqual(["М-004"]);
    expect(full.zone1).toHaveLength(0);
    // № акта хранится с сезонным префиксом — ищем и по «хвосту».
    expect(
      filterBoard(makeBoard(), { ...noFilters, search: "42" }).zone3,
    ).toHaveLength(1);
  });

  it("поиск по № акта — зоны 1/2 (items частично принятой машины)", () => {
    const r = filterBoard(makeBoard(), { ...noFilters, search: "2026-7" });
    expect(r.zone2.map((m) => m.code)).toEqual(["М-003"]);
    expect(r.zone1).toHaveLength(0);
    expect(r.zone3).toHaveLength(0);
  });

  it("поиск по фермеру и по культуре внутри позиций", () => {
    expect(
      filterBoard(makeBoard(), { ...noFilters, search: "абрамов" }).zone2,
    ).toHaveLength(1);
    expect(
      filterBoard(makeBoard(), { ...noFilters, search: "огурц" }).zone1.map((m) => m.code),
    ).toEqual(["М-002"]);
  });

  it("поиск работает и по зоне 3 (у AcceptedMachine позиции лежат в positions)", () => {
    const r = filterBoard(makeBoard(), { ...noFilters, search: "ёлкин" });
    expect(r.zone3.map((m) => m.code)).toEqual(["М-004"]);
    expect(r.zone1).toHaveLength(0);
  });

  it("acceptedCount пересчитывается из видимой зоны 3", () => {
    const withAccepted = filterBoard(makeBoard(), { ...noFilters, search: "ёлкин" });
    expect(withAccepted.acceptedCount).toBe(1);
    const none = filterBoard(makeBoard(), { ...noFilters, search: "кузнецов" });
    expect(none.zone3).toHaveLength(0);
    expect(none.acceptedCount).toBe(0);
  });
});

describe("boardOptions", () => {
  const opts = boardOptions(makeBoard());

  it("фермеры уникальны и отсортированы по-русски", () => {
    expect(opts.farmers.map((f) => f.name)).toEqual(["Абрамов", "Иванов", "Петров"]);
  });

  it("культуры уникальны, с цветом и сортировкой по-русски", () => {
    expect(opts.cultures.map((c) => c.name)).toEqual(["Огурцы", "Томаты"]);
    expect(opts.cultures.find((c) => c.name === "Томаты")?.color).toBe("#D4322C");
  });

  it("счётчик — число МАШИН по всем зонам, дубли позиций внутри машины не удваивают", () => {
    // Петров дважды в М-002 (огурцы + томаты) — но машина одна.
    expect(opts.farmers.find((f) => f.name === "Петров")?.count).toBe(1);
    expect(opts.farmers.find((f) => f.name === "Иванов")?.count).toBe(2); // М-001, М-003
    expect(opts.farmers.find((f) => f.name === "Абрамов")?.count).toBe(2); // М-003, М-004
    expect(opts.cultures.find((c) => c.name === "Томаты")?.count).toBe(3);
    expect(opts.cultures.find((c) => c.name === "Огурцы")?.count).toBe(3);
  });

  it("опции строятся из ПОЛНОГО board, а не из отфильтрованного", () => {
    const filtered = filterBoard(makeBoard(), { ...noFilters, search: "сидоров" });
    expect(boardOptions(filtered).farmers).toHaveLength(1);
    expect(opts.farmers).toHaveLength(3);
  });
});
