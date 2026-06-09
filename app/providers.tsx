"use client";

import { SessionProvider } from "next-auth/react";

// Прокидывает сессию в клиентские компоненты (нужно для useSession/RoleGate).
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
