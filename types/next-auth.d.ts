import type { Role } from "@/lib/generated/prisma/client";
import type { DefaultSession } from "next-auth";

// Расширяем типы Auth.js: роль и логин доступны на сервере и клиенте.
declare module "next-auth" {
  interface User {
    role: Role;
    login: string;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      login: string;
    } & DefaultSession["user"];
  }
}

// v5 берёт JWT из @auth/core/jwt — дополняем оба модуля.
declare module "next-auth/jwt" {
  interface JWT {
    role: Role;
    login: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role: Role;
    login: string;
  }
}
