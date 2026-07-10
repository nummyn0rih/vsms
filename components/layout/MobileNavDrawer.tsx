"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutList,
  ClipboardCheck,
  User,
  X,
  LogOut,
  type LucideIcon,
} from "lucide-react";

import { navForRole, isActive, isHrefAllowedForRole } from "@/lib/nav";
import type { Role } from "@/lib/generated/prisma/client";
import { useMobileNav } from "@/components/layout/mobile-nav-context";

const FIELD_TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/shipments", label: "Лента отгрузок", icon: LayoutList },
  { href: "/acceptance", label: "Приёмка", icon: ClipboardCheck },
  { href: "/reference/drivers", label: "Водители", icon: User },
];
const FIELD_HREFS = new Set(FIELD_TABS.map((t) => t.href));

// Полный список разделов из lib/nav (mobile-1): «В полях» — рабочие мобильные экраны,
// «Только десктоп» — весь остальной navForRole(role), НЕ убираем, только приглушаем.
export function MobileNavDrawer({
  role,
  userLabel,
}: {
  role: Role;
  userLabel: string;
}) {
  const { drawerOpen, closeDrawer } = useMobileNav();
  const pathname = usePathname();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer]);

  if (!drawerOpen) return null;

  const deskItems = navForRole(role).filter((i) => !FIELD_HREFS.has(i.href));
  const fieldItems = FIELD_TABS.filter((t) => isHrefAllowedForRole(t.href, role));

  return (
    <div className="md:hidden">
      <div className="ov-scrim" onClick={closeDrawer} />
      <aside className="drawer">
        <div className="drawer-head">
          <span className="drawer-brand">VSMS</span>
          <button type="button" className="icon-btn" title="Закрыть" onClick={closeDrawer}>
            <X />
          </button>
        </div>

        <nav className="drawer-nav">
          <div className="dnav-lab">В полях</div>
          {fieldItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`dnav-item${active ? " active" : ""}`}
                onClick={closeDrawer}
              >
                <Icon />
                {item.label}
              </Link>
            );
          })}

          <div className="dnav-sep" />
          <div className="dnav-lab">Только десктоп</div>
          {deskItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="dnav-item mobile-off"
                onClick={closeDrawer}
              >
                <Icon />
                {item.label}
                <span className="soon">десктоп</span>
              </Link>
            );
          })}
        </nav>

        <div className="drawer-foot">
          <span className="who">{userLabel}</span>
          <button
            type="button"
            className="icon-btn"
            title="Выйти"
            onClick={() => signOut({ redirectTo: "/login" })}
          >
            <LogOut />
          </button>
        </div>
      </aside>
    </div>
  );
}
