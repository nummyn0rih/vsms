// Стаб `@/auth` для verify-скриптов: сессия берётся из globalThis.__TEST_USER__.
// Подставляется resolve-хуком (см. scripts/settlement-rbac-verify.ts) — server-код
// не меняется, requireRole работает как в приложении, только пользователь задаётся тестом.
type TestUser = { id: string; role: "admin" | "operator" | "user" };
const g = globalThis as unknown as { __TEST_USER__?: TestUser | null };

export const auth = async () => (g.__TEST_USER__ ? { user: g.__TEST_USER__ } : null);
export const handlers = {};
export const signIn = async () => {};
export const signOut = async () => {};
