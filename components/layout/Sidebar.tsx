"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

import { navForRole } from "@/lib/nav";
import type { Role } from "@/lib/generated/prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// Меню считаем здесь (на клиенте): icon-компоненты lucide нельзя передавать
// через границу server→client. Сервер шлёт только роль.
export function Sidebar({
  role,
  userLabel,
}: {
  role: Role;
  userLabel: string;
}) {
  const pathname = usePathname();
  const items = navForRole(role);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/30">
      <div className="px-4 py-4 text-lg font-semibold tracking-tight">VSMS</div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          const showChildren = item.children && active;
          return (
            <div key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
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

      <div className="flex items-center justify-between gap-2 border-t px-3 py-3">
        <span className="truncate text-sm text-muted-foreground">{userLabel}</span>
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
