"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, PanelLeft, PanelLeftClose } from "lucide-react";

import { navForRole, isActive } from "@/lib/nav";
import type { Role } from "@/lib/generated/prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useNavCollapse } from "@/components/layout/sidebar-collapse";

// Меню считаем здесь (на клиенте): icon-компоненты lucide нельзя передавать
// через границу server→client. Сервер шлёт только роль.
export function Sidebar({
  role,
  userLabel,
  badges,
}: {
  role: Role;
  userLabel: string;
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const items = navForRole(role);
  const { collapsed, toggle } = useNavCollapse();

  // Неделя (?week) глобальна для /shipments и /planner (B5-nav) — переносим её в
  // ссылки между ними, чтобы при переходе стоял тот же недельный курсор.
  const week = searchParams.get("week");
  const weekRoutes = new Set(["/shipments", "/planner"]);
  const hrefFor = (href: string) =>
    week && weekRoutes.has(href) ? `${href}?week=${week}` : href;

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r bg-muted/30 transition-[width] duration-200",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex items-center px-2 py-4",
          collapsed ? "justify-center" : "justify-between px-4",
        )}
      >
        {!collapsed && (
          <span className="text-lg font-semibold tracking-tight">VSMS</span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          title={collapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"}
          onClick={toggle}
        >
          {collapsed ? (
            <PanelLeft className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </Button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          const showChildren = item.children && active && !collapsed;
          return (
            <div key={item.href}>
              <Link
                href={hrefFor(item.href)}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md py-2 text-sm transition-colors",
                  collapsed ? "justify-center px-2" : "px-3",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && item.label}
                {!collapsed && (badges?.[item.href] ?? 0) > 0 && (
                  <span className="nav-badge tnum">{badges![item.href]}</span>
                )}
              </Link>

              {showChildren && (
                <div className="mt-1 ml-7 space-y-1 border-l pl-2">
                  {item.children!.map((child) => {
                    const childActive = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "block rounded-md px-2 py-1 text-sm transition-colors",
                          childActive
                            ? "font-medium text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                          child.enabled === false && "opacity-60",
                        )}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div
        className={cn(
          "flex items-center gap-2 border-t py-3",
          collapsed ? "justify-center px-2" : "justify-between px-3",
        )}
      >
        {!collapsed && (
          <span className="truncate text-sm text-muted-foreground">{userLabel}</span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Выйти"
          onClick={() => signOut({ redirectTo: "/login" })}
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </aside>
  );
}
