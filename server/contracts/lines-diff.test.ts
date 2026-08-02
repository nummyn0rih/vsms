import { describe, expect, it } from "vitest";

import {
  buildLineLogEntries,
  canonDecimal,
  diffContractLines,
  formatLineComposition,
  formatLineTitle,
  normalizeContractLine,
  type LineSnapshot,
  type NormalizedLine,
} from "./lines-diff";

// Инварианты дифа строк контракта:
//  1) id строки при правке НЕ меняется — сопоставление по id, а не по содержимому (иначе
//     привязки ShipmentItem/CalibreResult осиротеют, а Restrict уронит сохранение);
//  2) пересохранение БЕЗ правок не оставляет следа в журнале — в т.ч. когда форма прислала
//     ту же цену в другой записи ("30" ↔ "30,00");
//  3) дубли культур в одном контракте разрешены (BR-5) и различаются только по id.
// Всё, что ходит в БД (гард ссылок, сам персист), — в scripts/contract-lines-verify.ts.

const CULTURES: Record<number, string> = { 1: "Огурцы", 2: "Томаты" };
const cultureName = (id: number) => CULTURES[id] ?? String(id);

function snap(
  id: number,
  over: Partial<Omit<LineSnapshot, "id">> = {},
): LineSnapshot {
  return {
    id,
    culture_id: 1,
    label: "стандарт",
    volume_tons: "80",
    price_per_kg: "11",
    ...over,
  };
}

// Строка «после» из снимка: тот же id и значения, с точечной правкой.
function same(s: LineSnapshot, over: Partial<NormalizedLine> = {}): NormalizedLine {
  const { id, ...rest } = s;
  return { id, ...rest, ...over };
}

function input(over: Partial<Record<string, string>> = {}) {
  return {
    culture_id: "1",
    label: "стандарт",
    volume_tons: "80",
    price_per_kg: "11",
    ...over,
  };
}

describe("canonDecimal", () => {
  it("запятая → точка, хвостовые нули снимаются", () => {
    expect(canonDecimal("80,50")).toBe("80.5");
    expect(canonDecimal("100.000")).toBe("100");
    expect(canonDecimal(" 11.0000 ")).toBe("11");
    expect(canonDecimal("0080.0")).toBe("80");
  });

  it("значащие знаки не теряются (точность денег)", () => {
    expect(canonDecimal("11.2525")).toBe("11.2525");
    expect(canonDecimal("0.0001")).toBe("0.0001");
  });

  it("мусор возвращается как есть, без падения", () => {
    // zod такое не пропустит, но диф не имеет права падать на чужих данных.
    expect(canonDecimal("abc")).toBe("abc");
    expect(canonDecimal("")).toBe("");
  });
});

describe("normalizeContractLine", () => {
  it("пустой или нечисловой id → новая строка", () => {
    expect(normalizeContractLine(input()).id).toBeNull();
    expect(normalizeContractLine({ ...input(), id: "" }).id).toBeNull();
    expect(normalizeContractLine({ ...input(), id: "abc" }).id).toBeNull();
    expect(normalizeContractLine({ ...input(), id: "0" }).id).toBeNull();
  });

  it("числовой id сохраняется", () => {
    expect(normalizeContractLine({ ...input(), id: "42" }).id).toBe(42);
  });

  it("пустая метка → null (в БД поле nullable)", () => {
    expect(normalizeContractLine({ ...input(), label: "   " }).label).toBeNull();
    expect(normalizeContractLine({ ...input(), label: undefined }).label).toBeNull();
    expect(normalizeContractLine({ ...input(), label: " стандарт " }).label).toBe(
      "стандарт",
    );
  });
});

describe("diffContractLines", () => {
  it("тот же набор без правок → пустой диф (журнал молчит)", () => {
    const before = [snap(1), snap(2, { label: "нестандарт", price_per_kg: "9" })];
    const after = before.map((b) => same(b));
    expect(diffContractLines(before, after)).toEqual({
      created: [],
      updated: [],
      deleted: [],
    });
  });

  it("другая запись того же числа изменением НЕ считается", () => {
    // БД отдаёт "80", форма — "80,00": без канонизации журнал врал бы «объём изменён».
    const before = [snap(1)];
    const after = [
      same(snap(1), {
        volume_tons: canonDecimal("80,00"),
        price_per_kg: canonDecimal("11.0000"),
      }),
    ];
    expect(diffContractLines(before, after).updated).toEqual([]);
  });

  it("правка цены → ровно одна запись по полю price_per_kg", () => {
    const before = [snap(1)];
    const diff = diffContractLines(before, [same(snap(1), { price_per_kg: "12.5" })]);
    expect(diff.created).toEqual([]);
    expect(diff.deleted).toEqual([]);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].id).toBe(1);
    expect(diff.updated[0].changes).toEqual([
      { field: "price_per_kg", oldValue: "11", newValue: "12.5" },
    ]);
  });

  it("несколько полей сразу → записи в фиксированном порядке", () => {
    const diff = diffContractLines(
      [snap(1)],
      [same(snap(1), { label: "нестандарт", volume_tons: "90" })],
    );
    expect(diff.updated[0].changes.map((c) => c.field)).toEqual([
      "label",
      "volume_tons",
    ]);
  });

  it("метка: null ↔ пусто изменением не считается, снятие метки — считается", () => {
    const noLabel = snap(1, { label: null });
    expect(diffContractLines([noLabel], [same(noLabel)]).updated).toEqual([]);

    const diff = diffContractLines([snap(1)], [same(snap(1), { label: null })]);
    expect(diff.updated[0].changes).toEqual([
      { field: "label", oldValue: "стандарт", newValue: null },
    ]);
  });

  it("строка без id → создание, пропавшая строка → удаление", () => {
    const before = [snap(1), snap(2, { label: "нестандарт" })];
    const diff = diffContractLines(before, [
      same(snap(1)),
      { ...same(snap(2, { label: "доп. объём" })), id: null },
    ]);
    expect(diff.created).toHaveLength(1);
    expect(diff.created[0].label).toBe("доп. объём");
    expect(diff.deleted.map((d) => d.id)).toEqual([2]);
  });

  it("id чужой строки не даёт тронуть её: неизвестный id → создание", () => {
    // Устаревшая вкладка или подделанный ввод. update/delete обязаны оставаться внутри
    // строк этого контракта.
    const before = [snap(1)];
    const diff = diffContractLines(before, [
      same(snap(1)),
      { ...same(snap(999, { label: "чужая" })), id: 999 },
    ]);
    expect(diff.updated).toEqual([]);
    expect(diff.created).toHaveLength(1);
    expect(diff.created[0].id).toBeNull();
    expect(diff.deleted).toEqual([]);
  });

  it("повтор одного id во входе: первый — правка, второй — новая строка", () => {
    const before = [snap(1)];
    const diff = diffContractLines(before, [
      same(snap(1), { price_per_kg: "12" }),
      same(snap(1), { price_per_kg: "13" }),
    ]);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].changes[0].newValue).toBe("12");
    expect(diff.created).toHaveLength(1);
    expect(diff.created[0].price_per_kg).toBe("13");
  });

  it("смена культуры видна как изменение поля", () => {
    const diff = diffContractLines([snap(1)], [same(snap(1), { culture_id: 2 })]);
    expect(diff.updated[0].changes).toEqual([
      { field: "culture_id", oldValue: "1", newValue: "2" },
    ]);
  });

  it("BR-5: две строки одной культуры живут вместе, правка одной не трогает вторую", () => {
    const before = [
      snap(1, { label: "стандарт", price_per_kg: "11" }),
      snap(2, { label: "нестандарт", price_per_kg: "9" }),
    ];
    const diff = diffContractLines(before, [
      same(before[0], { price_per_kg: "12" }),
      same(before[1]),
    ]);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0].id).toBe(1);
    expect(diff.deleted).toEqual([]);
    expect(diff.created).toEqual([]);
  });

  it("BR-5, крайний: полностью одинаковые строки различаются по id", () => {
    const before = [snap(1), snap(2)]; // одна культура, метка, объём и цена
    const diff = diffContractLines(before, [same(snap(1))]);
    expect(diff.deleted.map((d) => d.id)).toEqual([2]);
    expect(diff.updated).toEqual([]);
  });

  it("новый контракт: пустой снимок → все строки на создание", () => {
    const diff = diffContractLines([], [same(snap(1)), same(snap(2))]);
    expect(diff.created).toHaveLength(2);
    expect(diff.created.every((c) => c.id === null)).toBe(true);
  });
});

describe("тексты журнала", () => {
  it("заголовок строки: с меткой и без, неизвестная культура → её id", () => {
    expect(formatLineTitle({ culture_id: 1, label: "стандарт" }, cultureName)).toBe(
      "Огурцы · стандарт",
    );
    expect(formatLineTitle({ culture_id: 1, label: null }, cultureName)).toBe("Огурцы");
    expect(formatLineTitle({ culture_id: 7, label: null }, cultureName)).toBe("7");
  });

  it("состав строки называет культуру, объём, цену и контракт", () => {
    expect(
      formatLineComposition(
        { culture_id: 1, label: "стандарт", volume_tons: "80", price_per_kg: "11.25" },
        12,
        cultureName,
      ),
    ).toBe("Огурцы · стандарт · 80 т × 11,25 ₽/кг · контракт #12");
  });
});

describe("buildLineLogEntries", () => {
  const ctx = { contractId: 12, createdIds: [] as number[], cultureName };

  it("пустой диф → ни одной записи", () => {
    expect(
      buildLineLogEntries({ created: [], updated: [], deleted: [] }, ctx),
    ).toEqual([]);
  });

  it("правка → по записи на каждое изменившееся поле, значения с запятой", () => {
    const diff = diffContractLines(
      [snap(5)],
      [same(snap(5), { volume_tons: "90.5", price_per_kg: "12.75" })],
    );
    expect(buildLineLogEntries(diff, ctx)).toEqual([
      { entityId: 5, field: "volume_tons", oldValue: "80", newValue: "90,5" },
      { entityId: 5, field: "price_per_kg", oldValue: "11", newValue: "12,75" },
    ]);
  });

  it("культура пишется именем, а не id", () => {
    const diff = diffContractLines([snap(5)], [same(snap(5), { culture_id: 2 })]);
    expect(buildLineLogEntries(diff, ctx)[0]).toEqual({
      entityId: 5,
      field: "culture_id",
      oldValue: "Огурцы",
      newValue: "Томаты",
    });
  });

  it("создание берёт id из createdIds по порядку, удаление — состав в old_value", () => {
    const diff = diffContractLines(
      [snap(5, { label: "нестандарт", price_per_kg: "9" })],
      [{ ...same(snap(0)), id: null }],
    );
    const entries = buildLineLogEntries(diff, { ...ctx, createdIds: [77] });
    expect(entries).toEqual([
      {
        entityId: 77,
        field: "created",
        oldValue: null,
        newValue: "Огурцы · стандарт · 80 т × 11 ₽/кг · контракт #12",
      },
      {
        entityId: 5,
        field: "deleted",
        oldValue: "Огурцы · нестандарт · 80 т × 9 ₽/кг · контракт #12",
        newValue: null,
      },
    ]);
  });
});
