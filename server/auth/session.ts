import { auth } from "@/auth";
import type { Role } from "@/lib/generated/prisma/client";

// Серверный RBAC (CLAUDE.md правило 5): проверка роли обязана быть на сервере,
// скрытие на клиенте — лишь UX. Зови requireRole в начале server-функций.

export class AuthError extends Error {
  constructor(
    public code: "UNAUTHENTICATED" | "FORBIDDEN",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

/** Текущий пользователь из сессии или null. */
export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/**
 * Требует залогиненного пользователя с одной из ролей.
 * Без ролей — достаточно факта аутентификации.
 * Бросает AuthError при отказе; возвращает пользователя при успехе.
 */
export async function requireRole(...roles: Role[]) {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("UNAUTHENTICATED");
  if (roles.length > 0 && !roles.includes(user.role)) {
    throw new AuthError("FORBIDDEN");
  }
  return user;
}
