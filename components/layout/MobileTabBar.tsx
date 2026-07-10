"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutList, ClipboardCheck, User, Menu } from "lucide-react";

import { isActive, isHrefAllowedForRole } from "@/lib/nav";
import type { Role } from "@/lib/generated/prisma/client";
import { useMobileNav } from "@/components/layout/mobile-nav-context";

const TABS = [
  { href: "/shipments", label: "Лента", icon: LayoutList },
  { href: "/acceptance", label: "Приёмка", icon: ClipboardCheck },
  { href: "/reference/drivers", label: "Водители", icon: User },
];

// Нижний таб-бар (md:hidden, fixed): полевые экраны (по роли — как Sidebar) + «Ещё» →
// тот же drawer, что гамбургер в MobileAppBar (через MobileNavProvider).
export function MobileTabBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const { openDrawer } = useMobileNav();
  const tabs = TABS.filter((t) => isHrefAllowedForRole(t.href, role));

  return (
    <nav className="tabbar md:hidden">
      {tabs.map((tab) => {
        const active = isActive(pathname, tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tabbar-item${active ? " active" : ""}`}
          >
            <Icon />
            <span>{tab.label}</span>
          </Link>
        );
      })}
      <button type="button" className="tabbar-item" onClick={openDrawer}>
        <Menu />
        <span>Ещё</span>
      </button>
    </nav>
  );
}
