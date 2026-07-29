// Повтор транзакций, которые сами вычисляют «следующий номер» через MAX(code::int)+1
// (getNextCode в server/shipments/actions.ts, getNextMaterialCode в server/materials).
// Между SELECT MAX и INSERT блокировки нет: два параллельных создания под READ COMMITTED
// читают один и тот же максимум. С @unique на code второе падает P2002 — это не ошибка
// пользователя, а гонка. Лечим повтором ВСЕЙ транзакции: упавшую продолжить нельзя,
// а повтор пересчитает номер уже с учётом строки победителя.
//
// Директивы "use server" здесь НЕТ намеренно: модуль экспортирует класс и синхронные
// функции (в "use server"-файле разрешены только async-экспорты). Тот же приём и та же
// причина, что в server/action-result.ts.

const DEFAULT_ATTEMPTS = 3;

// Попытки исчерпаны. message — уже человеческий текст для пользователя;
// cause — последний P2002 со всей диагностикой драйвера (уедет в лог через failWithLog).
export class UniqueRetryExhaustedError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "UniqueRetryExhaustedError";
  }
}

// Форма метаданных P2002. В Prisma 7 Rust-движка нет, ошибку маппит driver adapter,
// и привычное meta.target НЕ заполняется — сведения о нарушенном уникуме лежат в
// meta.driverAdapterError.cause.constraint. Конкретно @prisma/adapter-pg на PG-код 23505
// парсит DETAIL («Key (code)=(49) already exists.») → { fields: ["code"] }; если DETAIL
// нет — constraint остаётся undefined. Вариант { index } объявлен в типах
// driver-adapter-utils (другие адаптеры отдают имя констрейнта) — разбираем и его.
type UniqueConstraint = { fields: string[] } | { index: string } | { foreignKey: unknown };

type P2002Meta = {
  target?: unknown;
  driverAdapterError?: {
    cause?: { constraint?: UniqueConstraint; originalMessage?: string };
  };
};

type UniqueSignal =
  | { kind: "fields"; fields: string[] }
  | { kind: "index"; index: string }
  | null;

// Достаёт из meta максимально конкретный признак нарушенного уникума, пробуя источники
// от самого надёжного к самому косвенному. null = опознать не удалось.
function uniqueSignal(meta: P2002Meta | undefined): UniqueSignal {
  // 1. meta.target — публичный формат старого движка. У adapter-pg пусто, но если поле
  //    заполнено (другой адаптер или будущая версия) — это самый точный источник.
  const target = meta?.target;
  if (Array.isArray(target) && target.every((t) => typeof t === "string")) {
    return { kind: "fields", fields: target as string[] };
  }
  if (typeof target === "string") return { kind: "index", index: target };

  // 2. Штатный путь Prisma 7 + driver adapter.
  const cause = meta?.driverAdapterError?.cause;
  const constraint = cause?.constraint;
  if (constraint && "fields" in constraint && Array.isArray(constraint.fields)) {
    return { kind: "fields", fields: constraint.fields };
  }
  if (constraint && "index" in constraint && typeof constraint.index === "string") {
    return { kind: "index", index: constraint.index };
  }

  // 3. DETAIL не распарсился — имя ограничения обычно есть в исходном тексте Postgres:
  //    «duplicate key value violates unique constraint "Shipment_code_key"».
  const raw = cause?.originalMessage;
  const named = typeof raw === "string" ? /unique constraint "([^"]+)"/.exec(raw) : null;
  if (named) return { kind: "index", index: named[1] };

  return null;
}

// P2002 именно по колонке field (у нас — "code"). Код ошибки проверяем структурно,
// как в server/recipes/actions.ts и server/seasons/actions.ts: так модуль не тянет
// сгенерированный Prisma-клиент и остаётся юнит-тестируемым чистым Node-модулем.
export function isUniqueViolationOn(e: unknown, field: string): boolean {
  if (typeof e !== "object" || e === null) return false;
  if ((e as { code?: unknown }).code !== "P2002") return false;

  const signal = uniqueSignal((e as { meta?: P2002Meta }).meta);

  // Уникум не опознан ни одним из трёх путей (Postgres не прислал DETAIL). Считаем его
  // «нашим» ОСОЗНАННО: в оборачиваемых транзакциях трогаются Shipment/MaterialShipment
  // (уникумы — pkey из sequence и *_code_key), ShipmentItem, MaterialShipmentItem и
  // ChangeLog (только pkey). id вручную нигде не задаётся → pkey конфликтовать не может,
  // значит любой P2002 здесь про code. Цена ложного повтора — две обречённые попытки;
  // цена обратного решения — фикс молча не работает и это не воспроизводится.
  if (!signal) return true;

  if (signal.kind === "fields") return signal.fields.includes(field);
  return signal.index.endsWith(`_${field}_key`); // конвенция Prisma: Model_field_key
}

export type UniqueRetryOptions = {
  // Текст пользователю, когда попытки исчерпаны.
  message: string;
  // Колонка-номер, по которой ждём конфликт. По умолчанию "code".
  field?: string;
  // ВСЕГО попыток, не «повторов». По умолчанию 3.
  attempts?: number;
};

// run — обязательно thunk, создающий транзакцию заново:
//   withUniqueRetry(() => prisma.$transaction(async (tx) => { ... }), { message })
// Готовый Promise передавать нельзя — повторно он не выполнится.
// Внутри run не должно быть побочных эффектов вне БД: revalidatePath и подобное
// оставляем ЗА обёрткой, чтобы они срабатывали один раз, после успеха.
//
// Пауз между попытками нет намеренно: проигравший висит на уникальном индексе до COMMIT
// победителя и получает отказ уже ПОСЛЕ него, значит следующий MAX сразу видит новую
// строку. Sleep тут ничего не даёт — коллизии детерминированные, а не таймингованные.
export async function withUniqueRetry<T>(
  run: () => Promise<T>,
  opts: UniqueRetryOptions,
): Promise<T> {
  const field = opts.field ?? "code";
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;

  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (e) {
      // Не «гонка номера» (ShipmentValidationError, AuthError, таймаут транзакции,
      // P2002 по чужому полю) — наружу без изменений: catch вызывающего разбирает
      // такие ошибки ровно как раньше.
      if (!isUniqueViolationOn(e, field)) throw e;
      last = e;
    }
  }
  throw new UniqueRetryExhaustedError(opts.message, last);
}

// Хвост catch: попытки исчерпаны → человеческий текст обёртки, иначе прежний текст
// вызывающего. Оба пути идут через failWithLog, поэтому запись в лог гарантирована.
export function retryFailMessage(e: unknown, fallback: string): string {
  return e instanceof UniqueRetryExhaustedError ? e.message : fallback;
}
