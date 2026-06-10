import { z } from "zod";

// Переиспользуемые валидаторы. phoneSchema нужен и Farmer, и Driver — не дублировать.

// E.164: национальный номер 10 цифр, международный максимум 15.
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;

// Телефон: цифры, пробелы, + - ( ). Кол-во цифр после очистки — в диапазоне.
export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Телефон обязателен")
  .regex(/^[\d\s+()-]+$/, "Допустимы цифры, пробелы, + - ( )")
  .refine((v) => {
    const n = v.match(/\d/g)?.length ?? 0;
    return n >= PHONE_MIN_DIGITS && n <= PHONE_MAX_DIGITS;
  }, `Телефон должен содержать от ${PHONE_MIN_DIGITS} до ${PHONE_MAX_DIGITS} цифр`);

// Для href="tel:": ведущий + (если был) + только цифры.
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return value.trim().startsWith("+") ? `+${digits}` : digits;
}

// Единый формат ОТОБРАЖЕНИЯ (в БД не трогаем — храним как ввели). 11 цифр,
// начинающихся с 7/8 → "+7 XXX XXX-XX-XX" (8 → +7). Иначе — нормализованный
// без маски (нестандартная длина — не наш кейс, не уродуем).
export function formatPhone(value: string): string {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
    const d = digits.slice(1);
    return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
  }
  return normalized;
}
