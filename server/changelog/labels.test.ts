import { describe, expect, it } from "vitest";

import {
  ENTITY_LABELS,
  ENTITY_OPTIONS,
  EMPTY_VALUE,
  entityHref,
  entityIdHint,
  entityLabel,
  fieldLabel,
  formatChangeTimestamp,
  formatValue,
  zonedDayRange,
} from "./labels";

// Инварианты журнала изменений: словарь НИКОГДА не теряет запись (неизвестный ключ —
// raw), значения переводятся, а границы периода считаются в заводской зоне, а не в UTC.
// Всё, что ходит в БД, — в scripts/changelog-viewer-verify.ts.

// Фактические значения ChangeLog.entity: константы ENTITY в server/*/actions.ts,
// server/plan/schema.ts, server/norms/schema.ts + инлайн "StockMovement" в inventory/.
// Список сверен по коду писателя; расхождение = словарь отстал.
const WRITTEN_ENTITIES = [
  "Farmer",
  "Culture",
  "Driver",
  "TransportCompany",
  "PackagingType",
  "Ingredient",
  "SeasonConfig",
  "AlertRule",
  "IngredientRecipe",
  "PackagingNorm",
  "TripWeightNorm",
  "Contract",
  "Shipment",
  "ShipmentItem",
  "AcceptanceAct",
  "MaterialShipment",
  "WeeklyPlan",
  "WeeklyPlanScope",
  "StockMovement",
];

describe("подписи сущностей", () => {
  it("известная сущность переводится", () => {
    expect(entityLabel("AcceptanceAct")).toBe("Акт приёмки");
    expect(entityLabel("StockMovement")).toBe("Движение склада");
    expect(entityLabel("WeeklyPlanScope")).toBe("Состав недели");
  });

  it("неизвестная сущность возвращается как есть, без падения", () => {
    expect(entityLabel("ZzzUnknown")).toBe("ZzzUnknown");
    expect(entityLabel("")).toBe("");
  });

  it("словарь покрывает все 19 значений, которые пишет logChange", () => {
    const missing = WRITTEN_ENTITIES.filter((e) => !(e in ENTITY_LABELS));
    expect(missing).toEqual([]);
    expect(Object.keys(ENTITY_LABELS)).toHaveLength(WRITTEN_ENTITIES.length);
  });

  it("опции фильтра отсортированы по русской подписи", () => {
    expect(ENTITY_OPTIONS).toHaveLength(WRITTEN_ENTITIES.length);
    const names = ENTITY_OPTIONS.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "ru")));
  });
});

describe("подписи полей (два яруса)", () => {
  it("точечный ключ Entity.field перебивает сквозной", () => {
    expect(fieldLabel("Shipment", "status")).toBe("Статус машины");
    expect(fieldLabel("MaterialShipment", "status")).toBe("Статус рейса");
  });

  it("без точечного ключа падаем на сквозную подпись поля", () => {
    expect(fieldLabel("Farmer", "active")).toBe("Статус записи");
    expect(fieldLabel("Culture", "active")).toBe("Статус записи");
    expect(fieldLabel("AcceptanceAct", "settlement_percent")).toBe(
      "Процент к оплате",
    );
  });

  it("неизвестное поле возвращается как есть", () => {
    expect(fieldLabel("Shipment", "zzz_field")).toBe("zzz_field");
    expect(fieldLabel("ZzzUnknown", "zzz_field")).toBe("zzz_field");
  });

  it("неизвестная сущность со знакомым полем всё равно получает подпись", () => {
    // Словарь отстал от кода: новый модуль пишет свою entity, но поле — сквозное.
    expect(fieldLabel("ZzzUnknown", "created")).toBe("Создано");
  });
});

describe("значения", () => {
  it("null и пустая строка → прочерк", () => {
    expect(formatValue("AcceptanceAct", "settlement_percent", null)).toBe(
      EMPTY_VALUE,
    );
    // alert-rules пишет "" вместо null — пустая ячейка читалась бы как поломка.
    expect(formatValue("AlertRule", "location_scope", "")).toBe(EMPTY_VALUE);
  });

  it("статусы отгрузки и рейса переведены", () => {
    expect(formatValue("Shipment", "status", "planned")).toBe("Плановая");
    expect(formatValue("Shipment", "status", "sent")).toBe("Отправлена");
    expect(formatValue("Shipment", "status", "arrived")).toBe("Прибыла");
    expect(formatValue("Shipment", "status", "accepted")).toBe("Принята");
    expect(formatValue("MaterialShipment", "status", "sent")).toBe("Отправлена");
  });

  it("булев active → активен/архив", () => {
    expect(formatValue("Farmer", "active", "true")).toBe("активен");
    expect(formatValue("Farmer", "active", "false")).toBe("архив");
  });

  it("прочие enum'ы переведены", () => {
    expect(formatValue("Culture", "acceptance_type", "calibre")).toBe(
      "По калибрам",
    );
    expect(formatValue("PackagingType", "kind", "barrel")).toBe("Бочка");
    expect(formatValue("Ingredient", "unit", "kg")).toBe("кг");
    expect(formatValue("AlertRule", "item_kind", "ingredient")).toBe("Ингредиент");
  });

  it("свободные сводки писателя проходят насквозь, без искажения", () => {
    const summary = "12 движ.: Ящик ×340; Бочка ×12";
    expect(formatValue("Shipment", "movements", summary)).toBe(summary);
    const json = '{"op":"scrap","quantity":40}';
    expect(formatValue("StockMovement", "scrap", json)).toBe(json);
  });

  it("значение вне словаря поля не подменяется", () => {
    // Появился новый статус — показываем как записано, а не «—» и не пусто.
    expect(formatValue("Shipment", "status", "zzz_new_status")).toBe(
      "zzz_new_status",
    );
  });

  it("число остаётся числом (форматирование денег журналу не поручено)", () => {
    expect(formatValue("AcceptanceAct", "settlement_percent", "97")).toBe("97");
  });

  it("ISO-дата показывается по-русски", () => {
    expect(formatValue("Shipment", "departure_date", "2026-07-28")).toBe("28.07.2026");
    expect(formatValue("SeasonConfig", "summer_start", "2026-06-01")).toBe("01.06.2026");
  });

  it("похожие на дату строки не искажаются", () => {
    // № акта «2026-12312» и сводки с датами внутри — не даты по форме.
    expect(formatValue("AcceptanceAct", "created", "2026-12312")).toBe("2026-12312");
    const bulk = "Эм × Огурцы, 20000 кг, дни: 2026-08-10, 2026-08-11";
    expect(formatValue("Shipment", "bulk_create", bulk)).toBe(bulk);
  });
});

describe("ссылки на объект", () => {
  it("поставщик и культура ведут на свои страницы", () => {
    expect(entityHref("Farmer", 12)).toBe("/reference/farmers/12");
    expect(entityHref("Culture", 3)).toBe("/analytics/culture/3");
  });

  it("у сущностей без собственной страницы ссылки нет", () => {
    expect(entityHref("StockMovement", 903)).toBeNull();
    expect(entityHref("TripWeightNorm", 5)).toBeNull();
    expect(entityHref("Shipment", 118)).toBeNull();
    expect(entityHref("ZzzUnknown", 1)).toBeNull();
  });

  it("нецелый или неположительный id ссылки не даёт", () => {
    expect(entityHref("Farmer", 0)).toBeNull();
    expect(entityHref("Farmer", -2)).toBeNull();
    expect(entityHref("Farmer", 1.5)).toBeNull();
  });

  it("подсказка объясняет чужой id в entity_id", () => {
    // Акт логируется по позиции отгрузки (приёмка позиционная, BR-13/26).
    expect(entityIdHint("AcceptanceAct", "settlement_percent")).toContain(
      "позиции отгрузки",
    );
    // Конверсии плана логируются по культуре, а не по строке плана.
    expect(entityIdHint("WeeklyPlan", "convert_days_to_week")).toBe("id культуры");
    expect(entityIdHint("WeeklyPlan", "target_tons")).toBeNull();
    expect(entityIdHint("Farmer", "name")).toBeNull();
  });
});

describe("время и границы периода в заводской зоне", () => {
  it("отметка времени показывается по МСК, а не по UTC", () => {
    // 2026-07-30T21:30Z = 31 июля 00:30 МСК.
    expect(formatChangeTimestamp(new Date("2026-07-30T21:30:00Z"))).toBe(
      "31.07.2026, 00:30",
    );
  });

  it("сутки «с/по» — местные: границы сдвинуты на смещение зоны", () => {
    const r = zonedDayRange("2026-07-31", "2026-07-31");
    expect(r.gte?.toISOString()).toBe("2026-07-30T21:00:00.000Z");
    expect(r.lt?.toISOString()).toBe("2026-07-31T21:00:00.000Z");
  });

  it("правка в 00:30 МСК попадает в свой день, а в 23:30 МСК — в предыдущий", () => {
    const { gte, lt } = zonedDayRange("2026-07-31", "2026-07-31");
    const inDay = new Date("2026-07-30T21:30:00Z"); // 31 июля 00:30 МСК
    const dayBefore = new Date("2026-07-30T20:30:00Z"); // 30 июля 23:30 МСК
    expect(inDay >= gte! && inDay < lt!).toBe(true);
    expect(dayBefore >= gte!).toBe(false);
  });

  it("верхняя граница исключающая — конец дня «по» входит целиком", () => {
    const { lt } = zonedDayRange(null, "2026-07-31");
    const lastMoment = new Date("2026-07-31T20:59:59Z"); // 23:59:59 МСК
    expect(lastMoment < lt!).toBe(true);
  });

  it("односторонний период и пустой ввод не ломаются", () => {
    expect(zonedDayRange("2026-07-01", null).lt).toBeUndefined();
    expect(zonedDayRange(null, "2026-07-01").gte).toBeUndefined();
    expect(zonedDayRange(null, null)).toEqual({});
  });

  it("мусор в URL молча игнорируется, а не роняет страницу", () => {
    expect(zonedDayRange("вчера", "2026-13-45")).toEqual({});
    expect(zonedDayRange("2026-02-30", undefined)).toEqual({});
  });
});
