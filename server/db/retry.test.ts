import { describe, expect, it } from "vitest";

import {
  UniqueRetryExhaustedError,
  isUniqueViolationOn,
  retryFailMessage,
  withUniqueRetry,
} from "./retry";

// П-8: getNextCode = MAX(code::int)+1 без блокировки. С @unique на code проигравший
// гонку получает P2002 — повтор всей транзакции обязан сделать это незаметным.
// Форма ошибки НЕ выдумана: снята с живой dev-БД (Prisma 7.8 + @prisma/adapter-pg).
// Инвариант, который фиксируют тесты: повторяем ТОЛЬКО гонку номера, всё остальное
// (валидация, RBAC, чужие уникумы) обязано долетать до вызывающего без изменений.

// Дубль Shipment.code через клиент отдаёт ровно это.
function p2002(fields: string[], constraintName = "Shipment_code_key") {
  return {
    name: "PrismaClientKnownRequestError",
    code: "P2002",
    meta: {
      modelName: "Shipment",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23505",
          originalMessage: `duplicate key value violates unique constraint "${constraintName}"`,
          kind: "UniqueConstraintViolation",
          constraint: { fields },
        },
      },
    },
  };
}

// Счётчик вызовов: сколько раз обёртка реально запустила транзакцию.
function counted<T>(impl: (attempt: number) => Promise<T>) {
  const state = { calls: 0 };
  const run = () => {
    state.calls++;
    return impl(state.calls);
  };
  return { run, state };
}

describe("isUniqueViolationOn", () => {
  it("узнаёт штатный P2002 от adapter-pg по constraint.fields", () => {
    expect(isUniqueViolationOn(p2002(["code"]), "code")).toBe(true);
  });

  it("не путает чужой уникум со своим: P2002 по act_number — не наш", () => {
    // BR-9: № акта тоже уникален. Повторять такое нельзя — это ошибка пользователя.
    expect(isUniqueViolationOn(p2002(["act_number"], "AcceptanceAct_act_number_key"), "code")).toBe(
      false,
    );
  });

  it("узнаёт формат { index } (другие адаптеры отдают имя констрейнта)", () => {
    const e = {
      code: "P2002",
      meta: { driverAdapterError: { cause: { constraint: { index: "MaterialShipment_code_key" } } } },
    };
    expect(isUniqueViolationOn(e, "code")).toBe(true);
  });

  it("по имени индекса отличает своё поле от чужого", () => {
    const e = {
      code: "P2002",
      meta: { driverAdapterError: { cause: { constraint: { index: "AcceptanceAct_act_number_key" } } } },
    };
    expect(isUniqueViolationOn(e, "code")).toBe(false);
  });

  it("падает на разбор originalMessage, если constraint не пришёл", () => {
    const e = {
      code: "P2002",
      meta: {
        driverAdapterError: {
          cause: {
            originalMessage: 'duplicate key value violates unique constraint "MaterialShipment_code_key"',
          },
        },
      },
    };
    expect(isUniqueViolationOn(e, "code")).toBe(true);
  });

  it("понимает meta.target старого движка (массив полей и имя индекса)", () => {
    expect(isUniqueViolationOn({ code: "P2002", meta: { target: ["code"] } }, "code")).toBe(true);
    expect(isUniqueViolationOn({ code: "P2002", meta: { target: ["act_number"] } }, "code")).toBe(false);
    expect(isUniqueViolationOn({ code: "P2002", meta: { target: "Shipment_code_key" } }, "code")).toBe(true);
  });

  it("P2002 без метаданных считает своим — осознанный фолбэк", () => {
    // Postgres не прислал DETAIL. В оборачиваемых транзакциях единственный уникум,
    // способный конфликтовать, — *_code_key (id вручную не задаётся), поэтому
    // повторить дешевле, чем молча не чинить гонку.
    expect(isUniqueViolationOn({ code: "P2002" }, "code")).toBe(true);
    expect(isUniqueViolationOn({ code: "P2002", meta: {} }, "code")).toBe(true);
  });

  it("не реагирует на другие коды Prisma и на не-объекты", () => {
    expect(isUniqueViolationOn({ code: "P2003" }, "code")).toBe(false); // FK
    expect(isUniqueViolationOn({ code: "P2010" }, "code")).toBe(false); // raw query failed
    expect(isUniqueViolationOn(new Error("боль"), "code")).toBe(false);
    expect(isUniqueViolationOn(null, "code")).toBe(false);
    expect(isUniqueViolationOn("P2002", "code")).toBe(false);
  });
});

describe("withUniqueRetry", () => {
  it("успех с первой попытки — результат прокинут, транзакция запущена один раз", async () => {
    const { run, state } = counted(async () => "ок");
    await expect(withUniqueRetry(run, { message: "…" })).resolves.toBe("ок");
    expect(state.calls).toBe(1);
  });

  it("гонка номера скрыта от пользователя: падение на 1-й попытке, успех на 2-й", async () => {
    const { run, state } = counted(async (attempt) => {
      if (attempt === 1) throw p2002(["code"]);
      return "машина 50";
    });
    await expect(withUniqueRetry(run, { message: "…" })).resolves.toBe("машина 50");
    expect(state.calls).toBe(2);
  });

  it("три подряд конфликта → UniqueRetryExhaustedError с человеческим текстом", async () => {
    const last = p2002(["code"]);
    const { run, state } = counted(async () => {
      throw last;
    });

    const err = await withUniqueRetry(run, {
      message: "Не удалось присвоить номер машины, попробуйте ещё раз",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UniqueRetryExhaustedError);
    expect((err as Error).message).toBe("Не удалось присвоить номер машины, попробуйте ещё раз");
    // cause несёт исходный P2002 — в лог сервера уйдёт настоящая причина.
    expect((err as Error).cause).toBe(last);
    expect(state.calls).toBe(3);
  });

  it("ошибка валидации пробрасывается как есть, БЕЗ повтора", async () => {
    // ShipmentValidationError и подобное: повтор ничего не изменит, а подмена текста
    // на «номер машины» спрятала бы от пользователя настоящую причину.
    class ShipmentValidationError extends Error {}
    const boom = new ShipmentValidationError("Нет нормы фасовки");
    const { run, state } = counted(async () => {
      throw boom;
    });

    await expect(withUniqueRetry(run, { message: "…" })).rejects.toBe(boom);
    expect(state.calls).toBe(1);
  });

  it("P2002 по чужому уникуму пробрасывается как есть, БЕЗ повтора", async () => {
    const boom = p2002(["act_number"], "AcceptanceAct_act_number_key");
    const { run, state } = counted(async () => {
      throw boom;
    });

    await expect(withUniqueRetry(run, { message: "…" })).rejects.toBe(boom);
    expect(state.calls).toBe(1);
  });

  it("таймаут транзакции не ретраится: повторять то, что не уложилось, бессмысленно", async () => {
    const boom = { code: "P2028", message: "Transaction API error" };
    const { run, state } = counted(async () => {
      throw boom;
    });

    await expect(withUniqueRetry(run, { message: "…" })).rejects.toBe(boom);
    expect(state.calls).toBe(1);
  });

  it("число попыток и поле настраиваются", async () => {
    const { run, state } = counted(async () => {
      throw p2002(["act_number"], "AcceptanceAct_act_number_key");
    });
    await expect(
      withUniqueRetry(run, { message: "…", field: "act_number", attempts: 5 }),
    ).rejects.toBeInstanceOf(UniqueRetryExhaustedError);
    expect(state.calls).toBe(5);
  });
});

describe("retryFailMessage", () => {
  it("подменяет текст только для исчерпанного retry", () => {
    const exhausted = new UniqueRetryExhaustedError("Не удалось присвоить номер машины", null);
    expect(retryFailMessage(exhausted, "Не удалось создать отгрузку")).toBe(
      "Не удалось присвоить номер машины",
    );
    expect(retryFailMessage(new Error("прочее"), "Не удалось создать отгрузку")).toBe(
      "Не удалось создать отгрузку",
    );
  });
});
