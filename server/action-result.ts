// Единая точка результата и ошибок server actions.
// Директивы "use server" здесь НЕТ намеренно: это обычный серверный модуль
// (в "use server"-файле разрешены только async-экспорты, а тут — тип и две
// синхронные функции). Импортируется из "use server"-файлов server-слоя.

import { AuthError } from "@/server/auth/session";

// Тип живёт в lib/ и импортируется в том числе клиентскими компонентами —
// реэкспортируем, а не дублируем, чтобы не тянуть цепочку auth в клиент.
export type { ActionResult } from "@/lib/action-result";

// Единый перехват ошибок RBAC → ActionResult (страницу не валим).
export function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

// Хвост catch-блока мутации. Отказ доступа — ожидаемый исход, в логи не шумим.
// Всё остальное — реальная поломка: стек в лог сервера (наблюдаемость прода),
// пользователю — прежний текст msg.
export function failWithLog(
  e: unknown,
  msg: string,
): { ok: false; error: string } {
  const auth = authFail(e);
  if (auth) return auth;
  console.error("[VSMS]", msg, e);
  return { ok: false, error: msg };
}
