// Стаб `next/cache` для verify-скриптов: вне Next revalidatePath звать нельзя
// (нет request scope). Логика server actions от этого не зависит — ревалидация
// вызывается уже ПОСЛЕ транзакции.
export const revalidatePath = () => {};
export const revalidateTag = () => {};
export const unstable_cache = <T>(fn: T) => fn;
