import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { authConfig } from "./auth.config";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        login: { label: "Логин", type: "text" },
        password: { label: "Пароль", type: "password" },
      },
      authorize: async (credentials) => {
        const login = credentials?.login as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!login || !password) return null;

        const user = await prisma.user.findUnique({ where: { login } });
        if (!user || !user.active) return null;

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return null;

        // id строкой — этого ждёт NextAuth.
        return { id: String(user.id), login: user.login, role: user.role };
      },
    }),
  ],
});
