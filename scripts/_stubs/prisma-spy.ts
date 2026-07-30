import dns from "node:dns";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../lib/generated/prisma/client";

// Стаб `@/lib/prisma` для verify-скриптов: НАСТОЯЩИЙ клиент, обёрнутый Proxy, который
// (а) считает вызовы делегатов моделей и (б) умеет по требованию вернуть пустой список
// вместо запроса. Нужен там, где проверяется не результат, а ФОРМА обращений к БД:
// «после audit-w4b балансы идут groupBy, а не findMany по всему леджеру» и «при нуле
// правил getActiveAlerts к леджеру не ходит вовсе».
//
// Подставляется resolve-хуком конкретного скрипта (см. w4b-balance-parity-verify.ts),
// глобальным алиасом НЕ регистрируется — CLAUDE.md про стабы.
dns.setDefaultResultOrder("ipv4first");

const real = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const calls: string[] = [];
const emptied = new Set<string>(); // "model.operation" → отдать [] без запроса

/** Все зафиксированные вызовы в порядке совершения (`"stockMovement.groupBy"`). */
export function spyCalls(): string[] {
  return [...calls];
}

/** Сколько раз дёрнули операцию (модель целиком — если operation не указан). */
export function spyCount(model: string, operation?: string): number {
  const prefix = operation ? `${model}.${operation}` : `${model}.`;
  return calls.filter((c) => (operation ? c === prefix : c.startsWith(prefix))).length;
}

export function spyReset(): void {
  calls.length = 0;
}

/** Заставить `model.operation` отдавать пустой массив (симуляция «данных нет»). */
export function spyForceEmpty(model: string, operation: string, on = true): void {
  const key = `${model}.${operation}`;
  if (on) emptied.add(key);
  else emptied.delete(key);
}

type Bag = Record<string | symbol, unknown>;

function wrapDelegate(model: string, delegate: object): object {
  return new Proxy(delegate, {
    get(target, prop) {
      const value = (target as Bag)[prop];
      if (typeof value !== "function" || typeof prop === "symbol") return value;
      const op = String(prop);
      return (...args: unknown[]) => {
        calls.push(`${model}.${op}`);
        if (emptied.has(`${model}.${op}`)) return Promise.resolve([]);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

const delegateCache = new Map<string, object>();

export const prisma = new Proxy(real, {
  get(target, prop) {
    const value = (target as unknown as Bag)[prop];
    // $-методы ($transaction, $disconnect…) и всё не-модельное — насквозь, с
    // сохранением this: Prisma внутри опирается на собственный контекст.
    if (typeof value === "function") {
      return (value as (...a: unknown[]) => unknown).bind(target);
    }
    if (typeof prop !== "string" || prop.startsWith("$") || prop.startsWith("_")) {
      return value;
    }
    if (value == null || typeof value !== "object") return value;
    const cached = delegateCache.get(prop);
    if (cached) return cached;
    const wrapped = wrapDelegate(prop, value as object);
    delegateCache.set(prop, wrapped);
    return wrapped;
  },
}) as unknown as PrismaClient;
