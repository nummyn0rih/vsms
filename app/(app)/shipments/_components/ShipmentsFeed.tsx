"use client";

import { useEffect, useRef, useState } from "react";

import type { Feed } from "@/server/shipments/feed";
import type { ShipmentOptions } from "@/server/shipments/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { WeekBlock } from "./WeekBlock";
import { ShipmentFormDialog } from "./ShipmentFormDialog";

function weekKey(w: { isoYear: number; isoWeek: number }): string {
  return `${w.isoYear}-${w.isoWeek}`;
}

export function ShipmentsFeed({
  feed,
  options,
}: {
  feed: Feed;
  options: ShipmentOptions;
}) {
  // Свёрнутость недель в React-state (НЕ localStorage). Прошлые свёрнуты,
  // текущая и будущие развёрнуты (DESIGN §2).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const w of feed.weeks) {
      if (w.position === "past") s.add(weekKey(w));
    }
    return s;
  });

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Авто-скролл к текущей неделе при первом рендере.
  const currentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "start" });
  }, []);

  if (feed.weeks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[#ebebeb] py-16 text-center">
        <p className="text-sm text-muted-foreground">
          В сезоне {feed.seasonYear} ещё нет отгрузок.
        </p>
        <RoleGate allow={["admin"]}>
          <ShipmentFormDialog mode="create" options={options} />
        </RoleGate>
      </div>
    );
  }

  return (
    <div>
      {feed.weeks.map((week) => {
        const key = weekKey(week);
        return (
          <WeekBlock
            key={key}
            ref={week.position === "current" ? currentRef : undefined}
            week={week}
            options={options}
            collapsed={collapsed.has(key)}
            onToggle={() => toggle(key)}
          />
        );
      })}
    </div>
  );
}
