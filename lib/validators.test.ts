import { describe, expect, it } from "vitest";

import {
  formatPhone,
  normalizePhone,
  optionalPhoneSchema,
  phoneSchema,
} from "./validators";

// Телефоны хранятся как ввели, нормализуются только для href="tel:" и приводятся
// к единому виду на показе. Формат показа — «+7 XXX XXX-XX-XX».

describe("normalizePhone", () => {
  it("вычищает маску, сохраняя ведущий +", () => {
    expect(normalizePhone("+7 (999) 123-45-67")).toBe("+79991234567");
  });

  it("без ведущего + плюс не дорисовывается", () => {
    expect(normalizePhone("8 999 123 45 67")).toBe("89991234567");
  });

  it("мусорные символы и пробелы по краям отбрасываются", () => {
    expect(normalizePhone("  +7 999--123..45..67  ")).toBe("+79991234567");
  });

  it("плюс не в начале не считается международным префиксом", () => {
    expect(normalizePhone("8 999 123 45 67 +")).toBe("89991234567");
  });
});

describe("formatPhone", () => {
  it("11 цифр с 7 → «+7 XXX XXX-XX-XX»", () => {
    expect(formatPhone("+7 (999) 123-45-67")).toBe("+7 999 123-45-67");
    expect(formatPhone("79991234567")).toBe("+7 999 123-45-67");
  });

  it("ведущая 8 приводится к +7", () => {
    expect(formatPhone("8 999 123 45 67")).toBe("+7 999 123-45-67");
  });

  it("нестандартную длину не уродуем — отдаём нормализованный без маски", () => {
    expect(formatPhone("+380 44 123 45 67")).toBe("+380441234567");
    expect(formatPhone("123456")).toBe("123456");
  });

  it("формат идемпотентен: повторное применение ничего не меняет", () => {
    expect(formatPhone(formatPhone("8 999 123 45 67"))).toBe("+7 999 123-45-67");
  });
});

describe("phoneSchema", () => {
  it("принимает номер с маской и международный", () => {
    expect(phoneSchema.safeParse("+7 (999) 123-45-67").success).toBe(true);
    expect(phoneSchema.safeParse("89991234567").success).toBe(true);
  });

  it("отклоняет слишком короткий и слишком длинный номер", () => {
    expect(phoneSchema.safeParse("123456789").success).toBe(false); // 9 цифр
    expect(phoneSchema.safeParse("1234567890123456").success).toBe(false); // 16 цифр
  });

  it("отклоняет буквы и пустую строку", () => {
    expect(phoneSchema.safeParse("+7 999 ABC-45-67").success).toBe(false);
    expect(phoneSchema.safeParse("").success).toBe(false);
  });
});

// Телефон водителя необязателен: «нет номера» = null (не пустая строка), а
// непустое значение проверяется теми же правилами, что и обязательный phoneSchema.
describe("optionalPhoneSchema", () => {
  it("пусто в любом виде → null", () => {
    for (const input of ["", "   ", undefined, null]) {
      const res = optionalPhoneSchema.safeParse(input);
      expect(res.success).toBe(true);
      expect(res.success && res.data).toBe(null);
    }
  });

  it("валидный номер проходит и сохраняется как ввели (без маски trim)", () => {
    const res = optionalPhoneSchema.safeParse("  +7 (999) 123-45-67  ");
    expect(res.success).toBe(true);
    expect(res.success && res.data).toBe("+7 (999) 123-45-67");
  });

  it("выход схемы допустим как её же вход (сервер парсит присланное повторно)", () => {
    expect(optionalPhoneSchema.safeParse(optionalPhoneSchema.parse("")).success).toBe(true);
  });

  it("мусор отклоняется теми же сообщениями, что у phoneSchema", () => {
    const letters = optionalPhoneSchema.safeParse("+7 999 ABC-45-67");
    expect(letters.success).toBe(false);
    expect(!letters.success && letters.error.issues[0].message).toBe(
      phoneSchema.safeParse("+7 999 ABC-45-67").error?.issues[0].message,
    );

    const short = optionalPhoneSchema.safeParse("123456789"); // 9 цифр
    expect(short.success).toBe(false);
    expect(!short.success && short.error.issues[0].message).toBe(
      phoneSchema.safeParse("123456789").error?.issues[0].message,
    );

    expect(optionalPhoneSchema.safeParse("1234567890123456").success).toBe(false); // 16 цифр
  });
});
