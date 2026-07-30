import { afterEach, describe, expect, it, vi } from "vitest";

import { logChange, type ChangeEntry } from "./changelog";

// П-20: logChange обязан сверять фактически записанное с тем, что просили. В БД не ходим —
// параметр db (Pick<typeof prisma, "changeLog">) и есть шов для подмены. Инвариант,
// который фиксируем: неполная запись аудита (BR-16) НЕ проходит молча.

// Фейк, возвращающий заданный count вместо реального результата createMany.
function fakeDb(count: number) {
  const calls: { data: unknown[] }[] = [];
  return {
    calls,
    db: {
      changeLog: {
        createMany: async (args: { data: unknown[] }) => {
          calls.push(args);
          return { count };
        },
      },
    } as never,
  };
}

const e1: ChangeEntry = { entity: "Shipment", entityId: 7, field: "status" };
const e2: ChangeEntry = { entity: "Shipment", entityId: 7, field: "arrival_date" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logChange — сверка записи (П-20)", () => {
  it("count меньше запрошенного → бросает (транзакция вызывающего откатится)", async () => {
    const { db } = fakeDb(1); // просили 2 строки, записалась 1
    await expect(logChange([e1, e2], 1, db)).rejects.toThrow(/ChangeLog/);
  });

  it("текст ошибки называет числа и сущность — по логу видно, что недозаписано", async () => {
    const { db } = fakeDb(1);
    await expect(logChange([e1, e2], 1, db)).rejects.toThrow(
      "ChangeLog: записано 1 из 2 строк (Shipment#7)",
    );
  });

  it("count сошёлся → проходит, в createMany ушли все строки", async () => {
    const { db, calls } = fakeDb(2);
    await expect(logChange([e1, e2], 1, db)).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].data).toHaveLength(2);
  });

  it("одиночный entry нормализуется в список из одного", async () => {
    const { db, calls } = fakeDb(1);
    await expect(logChange(e1, 1, db)).resolves.toBeUndefined();
    expect(calls[0].data).toEqual([
      {
        entity: "Shipment",
        entity_id: 7,
        field: "status",
        old_value: null,
        new_value: null,
        user_id: 1,
      },
    ]);
  });

  it("одиночный entry с count=0 тоже ловится, а не проходит как «нечего писать»", async () => {
    const { db } = fakeDb(0);
    await expect(logChange(e1, 1, db)).rejects.toThrow(/записано 0 из 1/);
  });

  it("пустой список: createMany не зовём, но пишем warn с вызывающим", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, calls } = fakeDb(0);
    await expect(logChange([], 1, db)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/пустой список entries/);
  });
});
