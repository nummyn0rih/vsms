"use client";

import { useSession } from "next-auth/react";

import type { Role } from "@/lib/generated/prisma/client";

// Клиентское скрытие UI по роли. ВНИМАНИЕ: это только UX —
// серверная проверка (requireRole) обязательна всё равно.
export function RoleGate({
  allow,
  children,
  fallback = null,
}: {
  allow: Role[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { data: session } = useSession();
  const role = session?.user?.role;

  if (!role || !allow.includes(role)) return <>{fallback}</>;
  return <>{children}</>;
}
