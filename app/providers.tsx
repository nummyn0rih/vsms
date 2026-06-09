"use client";

import { SessionProvider } from "next-auth/react";

import { Toaster } from "@/components/ui/sonner";

// Прокидывает сессию в клиентские компоненты (нужно для useSession/RoleGate).
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <Toaster />
    </SessionProvider>
  );
}
