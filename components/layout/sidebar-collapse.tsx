"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";

// Состояние сворачивания сайдбара (B5-1b). БЕЗ localStorage: эффективное состояние =
// ручной оверрайд (если есть), иначе авто-вывод из текущего вида (доска → свёрнут).
// Авто задаёт экран (PlannerShell.setAuto) и сбрасывает ручной оверрайд; смена
// маршрута тоже сбрасывает (на других страницах сайдбар развёрнут).
type NavCollapseCtx = {
  collapsed: boolean;
  toggle: () => void;
  setAuto: (v: boolean) => void;
};

const Ctx = createContext<NavCollapseCtx | null>(null);

export function NavCollapseProvider({ children }: { children: React.ReactNode }) {
  const [auto, setAutoState] = useState(false);
  const [manual, setManual] = useState<boolean | null>(null);
  const collapsed = manual ?? auto;

  // Смена вида/маршрута: фиксируем новое авто и сбрасываем ручной оверрайд.
  const setAuto = useCallback((v: boolean) => {
    setAutoState(v);
    setManual(null);
  }, []);

  // Ручной тоггл уважается до следующего setAuto (смены вида/маршрута).
  const toggle = useCallback(() => setManual(!collapsed), [collapsed]);

  // Смена маршрута → развернуть (другие страницы), сбросить ручной оверрайд.
  // Экранный эффект (PlannerShell) при необходимости снова свернёт.
  const pathname = usePathname();
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setAutoState(false);
    setManual(null);
  }, [pathname]);

  const value = useMemo(() => ({ collapsed, toggle, setAuto }), [collapsed, toggle, setAuto]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNavCollapse(): NavCollapseCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNavCollapse вне NavCollapseProvider");
  return ctx;
}
