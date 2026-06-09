import NextAuth from "next-auth";

import { authConfig } from "./auth.config";

// Next 16: файл-конвенция proxy (бывший middleware).
// Использует edge-safe authConfig (без prisma/bcrypt).
// authorized-callback решает доступ; неавторизованного шлёт на /login.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Защищаем всё, кроме статики, api/auth и самой страницы логина.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|login|.*\\..*).*)"],
};
