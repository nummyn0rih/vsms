"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import type { MaterialFeed, MaterialWeek } from "@/server/materials/feed";
import type { MaterialOptions } from "@/server/materials/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MaterialFormDialog } from "./MaterialFormDialog";
import { MaterialWeekBlock } from "./MaterialWeekBlock";
import type { DisplayStatus } from "./material-status";

const STATUS_LABEL: Record<DisplayStatus, string> = {
  planned: "Плановый",
  sent: "Отправлен",
  partial: "Частично",
  arrived: "Прибыл",
};

function weekKey(w: { isoYear: number; isoWeek: number }): string {
  return `${w.isoYear}-${w.isoWeek}`;
}

export function MaterialsFeed({
  feed,
  options,
}: {
  feed: MaterialFeed;
  options: MaterialOptions;
}) {
  const [search, setSearch] = useState("");
  const [statusSel, setStatusSel] = useState<"all" | DisplayStatus>("all");
  const [farmerSel, setFarmerSel] = useState<"all" | string>("all");

  // Свёрнутость недель: прошлые свёрнуты по умолчанию (React-state, без localStorage).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const w of feed.weeks) if (w.position === "past") s.add(weekKey(w));
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

  const anyFilter = search.trim() !== "" || statusSel !== "all" || farmerSel !== "all";

  // Клиентская фильтрация поверх дерева. Рейс атомарен (И между фильтрами);
  // пустые недели после фильтра скрываются.
  const visibleWeeks = useMemo<MaterialWeek[]>(() => {
    if (!anyFilter) return feed.weeks;
    const q = search.trim().toLowerCase();
    const farmerId = farmerSel === "all" ? null : Number(farmerSel);
    return feed.weeks
      .map((w) => ({
        ...w,
        trips: w.trips.filter((t) => {
          if (statusSel !== "all" && t.derivedStatus !== statusSel) return false;
          if (farmerId != null && !t.items.some((it) => it.farmerId === farmerId))
            return false;
          if (q) {
            const hit =
              t.code.toLowerCase().includes(q) ||
              (t.driverName?.toLowerCase().includes(q) ?? false) ||
              t.items.some((it) => it.farmerName.toLowerCase().includes(q));
            if (!hit) return false;
          }
          return true;
        }),
      }))
      .filter((w) => w.trips.length > 0);
  }, [feed.weeks, anyFilter, search, statusSel, farmerSel]);

  return (
    <div>
      {/* Тулбар: создание + поиск + фильтры (лёгкий, без week-nav/scrollspy). */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <RoleGate allow={["admin"]}>
          <MaterialFormDialog mode="create" options={options} />
        </RoleGate>

        <span className="flex-1" />

        <div className="relative w-full max-w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск: фермер, водитель, №"
            className="pl-9"
          />
        </div>

        <Select value={farmerSel} onValueChange={setFarmerSel}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Фермер" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все фермеры</SelectItem>
            {options.farmers.map((f) => (
              <SelectItem key={f.id} value={String(f.id)}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusSel}
          onValueChange={(v) => setStatusSel(v as "all" | DisplayStatus)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {(Object.keys(STATUS_LABEL) as DisplayStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {feed.weeks.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-[#ebebeb] p-10 text-center">
          <h3 className="text-sm font-semibold">Пока нет рейсов тары</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            В сезоне {feed.seasonYear} ещё не заведено ни одного рейса доставки тары.
          </p>
        </div>
      ) : visibleWeeks.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-[#ebebeb] p-10 text-center">
          <h3 className="text-sm font-semibold">Ничего не найдено по фильтрам</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Под текущие фильтры рейсов нет.
          </p>
        </div>
      ) : (
        <div>
          {visibleWeeks.map((week) => {
            const key = weekKey(week);
            return (
              <MaterialWeekBlock
                key={key}
                week={week}
                options={options}
                collapsed={collapsed.has(key)}
                onToggle={() => toggle(key)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
