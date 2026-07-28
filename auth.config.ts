import type { NextAuthConfig } from "next-auth";

// Edge-safe конфиг: без prisma/bcrypt — его импортит middleware (edge-рантайм).
// Провайдеры (с доступом к БД) добавляются в auth.ts.
export const authConfig = {
  // Хост берём из заголовка запроса: за прокси Vercel (прод-домен, preview-URL)
  // иначе ловим host-mismatch. Флаг здесь, а не в auth.ts, — его должен видеть
  // и edge-инстанс из proxy.ts.
  trustHost: true,
  pages: { signIn: "/login" },
  // Дефолт Auth.js — 30 дней; для внутренней системы это слишком долго. 12 часов =
  // рабочий день: утром вход, к вечеру сессия истекает. jwt.maxAge наследуется от
  // session.maxAge, поэтому срок жизни самого токена ограничен той же строкой.
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  providers: [],
  callbacks: {
    // Пускаем только залогиненных; иначе NextAuth редиректит на pages.signIn.
    authorized({ auth }) {
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.login = user.login;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role;
        session.user.login = token.login;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
