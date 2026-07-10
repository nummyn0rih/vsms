"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

// Состояние мобильного drawer'а (mobile-1). Один экземпляр открывают ДВЕ точки входа —
// гамбургер в MobileAppBar и пункт «Ещё» в MobileTabBar — оба зовут openDrawer().
type MobileNavCtx = {
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const Ctx = createContext<MobileNavCtx | null>(null);

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const value = useMemo(
    () => ({ drawerOpen, openDrawer, closeDrawer }),
    [drawerOpen, openDrawer, closeDrawer],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMobileNav(): MobileNavCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMobileNav вне MobileNavProvider");
  return ctx;
}
