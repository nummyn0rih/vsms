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
