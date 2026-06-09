import type { NextAuthConfig } from "next-auth";

// Edge-safe конфиг: без prisma/bcrypt — его импортит middleware (edge-рантайм).
// Провайдеры (с доступом к БД) добавляются в auth.ts.
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
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
