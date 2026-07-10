"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { NAV, isActive } from "@/lib/nav";
import { useMobileNav } from "@/components/layout/mobile-nav-context";

// Заголовок — по текущему маршруту (первый пункт NAV, для которого isActive true).
function currentTitle(pathname: string): string {
  const item = NAV.find((i) => isActive(pathname, i.href));
  return item?.label ?? "VSMS";
}

// Мобильный app-bar (md:hidden): гамбургер открывает drawer (общий с MobileTabBar
// «Ещё» — через MobileNavProvider). Sticky в scroll-контейнере <main>, высота
// фиксирована стилем .appbar (54px, DESIGN mobile-1).
export function MobileAppBar() {
  const pathname = usePathname();
  const { openDrawer } = useMobileNav();

  return (
    <div className="appbar md:hidden">
      <button
        type="button"
        className="icon-btn"
        title="Меню"
        onClick={openDrawer}
      >
        <Menu />
      </button>
      <div className="appbar-titlewrap">
        <span className="appbar-title">{currentTitle(pathname)}</span>
      </div>
    </div>
  );
}
