// Чистые хелперы форматирования ленты (без React/prisma). RU-склонение тары для
// итогов дня/недели. Источник: PROMPT-17b-fix-3, прототип lenta-b0, DESIGN §2.

// Русское склонение: учитывает исключение 11–14.
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const n10 = Math.abs(n) % 10;
  const n100 = Math.abs(n) % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

export const tareBoxWord = (n: number) => pluralRu(n, "ящик", "ящика", "ящиков");
export const tareBarrelWord = (n: number) => pluralRu(n, "бочка", "бочки", "бочек");

// Слово тары по виду (для строк превью диалогов: «103 ящика», «9 бочек»).
export const tareUnitWord = (kind: "box" | "barrel", n: number) =>
  kind === "box" ? tareBoxWord(n) : tareBarrelWord(n);

// Склонения для сводок диалогов отправки/отката.
export const positionsWord = (n: number) =>
  pluralRu(n, "позиция", "позиции", "позиций");
export const farmersWord = (n: number) =>
  pluralRu(n, "фермер", "фермера", "фермеров");

// "62 ящика · 8 бочек" из { boxes, barrels } (нули опускаем).
export function formatTareTotals(boxes: number, barrels: number): string {
  const parts: string[] = [];
  if (boxes) parts.push(`${boxes} ${tareBoxWord(boxes)}`);
  if (barrels) parts.push(`${barrels} ${tareBarrelWord(barrels)}`);
  return parts.join(" · ");
}
