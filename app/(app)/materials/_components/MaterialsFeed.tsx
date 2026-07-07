"use client";

import { useCallback, useMemo, useState } from "react";
import { Search } from "lucide-react";

import type {
  MaterialFeed,
  MaterialFilters,
  MaterialWeek,
} from "@/server/materials/feed";
import { tripVisible } from "@/server/materials/feed";
import type { MaterialOptions } from "@/server/materials/schema";
import { RoleGate } from "@/components/auth/RoleGate";
import { Input } from "@/components/ui/input";
import { FilterCombo } from "@/components/filters/FilterCombo";
import { MaterialFormDialog } from "./MaterialFormDialog";
import { MaterialWeekBlock } from "./MaterialWeekBlock";
import type { DisplayStatus } from "./material-status";

type ItemKind = "packaging" | "ingredient";

// Порядок статусов фильтра (жизненный цикл + производный «Частично»).
const STATUS_OPTIONS: ReadonlyArray<readonly [DisplayStatus, string]> = [
  ["planned", "Плановый"],
  ["sent", "Отправлен"],
  ["partial", "Частично"],
  ["arrived", "Прибыл"],
];

// Вид позиции — два статичных значения (тара / ингредиент).
const KIND_OPTIONS: ReadonlyArray<readonly [ItemKind, string]> = [
  ["packaging", "Тара"],
  ["ingredient", "Ингредиент"],
];

// Иконка кнопки «Фермер» (тот же stroke-путь, что «Поставщик» в Ленте).
const farmerIcon = (
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>
);

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
  // --- Состояние фильтров (React state, без localStorage; как Лента) ---
  const [search, setSearch] = useState("");
  const [farmerSel, setFarmerSel] = useState<Set<number>>(new Set());
  const [kindSel, setKindSel] = useState<Set<ItemKind>>(new Set());
  const [statusSel, setStatusSel] = useState<Set<DisplayStatus>>(new Set());

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

  const anyFilter =
    search.trim() !== "" ||
    farmerSel.size > 0 ||
    kindSel.size > 0 ||
    statusSel.size > 0;

  const resetAll = useCallback(() => {
    setSearch("");
    setFarmerSel(new Set());
    setKindSel(new Set());
    setStatusSel(new Set());
  }, []);

  // Тоггл значения в Set (иммутабельно).
  function toggleIn<T>(
    setSet: React.Dispatch<React.SetStateAction<Set<T>>>,
    value: T,
  ) {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  // Клиентская фильтрация поверх дерева через чистую tripVisible. Рейс атомарен
  // (И между фильтрами); пустые недели после фильтра скрываются. Подытоги в шапках
  // недель считаются из week.trips → пересчитываются из видимого набора автоматически.
  const visibleWeeks = useMemo<MaterialWeek[]>(() => {
    if (!anyFilter) return feed.weeks;
    const filters: MaterialFilters = {
      farmerIds: farmerSel,
      kinds: kindSel,
      statuses: statusSel,
      query: search.trim().toLowerCase(),
    };
    return feed.weeks
      .map((w) => ({ ...w, trips: w.trips.filter((t) => tripVisible(t, filters)) }))
      .filter((w) => w.trips.length > 0);
  }, [feed.weeks, anyFilter, search, farmerSel, kindSel, statusSel]);

  // Счётчики опций (.ct): число рейсов сезона с этим фермером/видом/статусом.
  // По полному дереву — стабильны независимо от текущих фильтров.
  const counts = useMemo(() => {
    const farmer = new Map<number, number>();
    const kind = new Map<ItemKind, number>();
    const status = new Map<DisplayStatus, number>();
    for (const w of feed.weeks)
      for (const t of w.trips) {
        status.set(t.derivedStatus, (status.get(t.derivedStatus) ?? 0) + 1);
        const fset = new Set<number>();
        const kset = new Set<ItemKind>();
        for (const it of t.items) {
          fset.add(it.farmerId);
          kset.add(it.itemKind);
        }
        for (const id of fset) farmer.set(id, (farmer.get(id) ?? 0) + 1);
        for (const k of kset) kind.set(k, (kind.get(k) ?? 0) + 1);
      }
    return { farmer, kind, status };
  }, [feed.weeks]);

  return (
    <div>
      {/* Тулбар: создание + поиск + фильтры-комбобоксы (лёгкий, без week-nav/scrollspy). */}
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

        <FilterCombo
          kind="icon"
          label="Фермер"
          icon={farmerIcon}
          options={options.farmers.map((f) => ({
            id: f.id,
            name: f.name,
            count: counts.farmer.get(f.id) ?? 0,
          }))}
          selected={farmerSel}
          onToggle={(id) => toggleIn(setFarmerSel, id as number)}
          onClear={() => setFarmerSel(new Set())}
          searchable
          searchPlaceholder="Найти фермера…"
        />

        <FilterCombo
          kind="status"
          label="Вид"
          options={KIND_OPTIONS.map(([id, name]) => ({
            id,
            name,
            count: counts.kind.get(id) ?? 0,
          }))}
          selected={kindSel}
          onToggle={(id) => toggleIn(setKindSel, id as ItemKind)}
          onClear={() => setKindSel(new Set())}
        />

        <FilterCombo
          kind="status"
          label="Статус"
          options={STATUS_OPTIONS.map(([id, name]) => ({
            id,
            name,
            count: counts.status.get(id) ?? 0,
          }))}
          selected={statusSel}
          onToggle={(id) => toggleIn(setStatusSel, id as DisplayStatus)}
          onClear={() => setStatusSel(new Set())}
        />

        {anyFilter && (
          <button type="button" className="btn" onClick={resetAll}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 2v6h6" />
              <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
            </svg>
            Сбросить
          </button>
        )}
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
