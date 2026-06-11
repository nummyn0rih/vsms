"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SETTINGS_TABS } from "@/lib/nav";
import { cn } from "@/lib/utils";

// Горизонтальные подтабы раздела «Настройки» (эталон ReferenceTabs).
export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b">
      {SETTINGS_TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
