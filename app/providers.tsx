"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

import { RoleProvider } from "@/components/auth/RoleProvider";
import { Toaster } from "@/components/ui/sonner";
import type { Role } from "@/lib/generated/prisma/client";

// SessionProvider оставлен ради клиентского API next-auth (signOut в сайдбаре и мобильном
// меню), но роль из него больше НЕ читается: его внутреннее состояние фиксируется на
// монтировании и при клиентской навигации отстаёт от пропа (см. RoleProvider).
// Гейтинг UI идёт через RoleProvider — роль приходит пропом из серверного layout.
export function Providers({
  children,
  session,
  role,
}: {
  children: React.ReactNode;
  session: Session | null;
  role: Role | null;
}) {
  return (
    <SessionProvider session={session}>
      <RoleProvider role={role}>{children}</RoleProvider>
      <Toaster />
    </SessionProvider>
  );
}
