"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

import { Toaster } from "@/components/ui/sonner";

// Прокидывает сессию в клиентские компоненты (нужно для useSession/RoleGate).
// session приходит из серверного layout: без пропа SessionProvider стартует в
// status="loading" и идёт за /api/auth/session — RoleGate успевает мигнуть fallback'ом.
export function Providers({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <SessionProvider session={session}>
      {children}
      <Toaster />
    </SessionProvider>
  );
}
