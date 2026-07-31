"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { FilterCombo } from "@/components/filters/FilterCombo";
import { Input } from "@/components/ui/input";
import { ENTITY_OPTIONS, SYSTEM_USER_ID, SYSTEM_USER_LABEL } from "@/server/changelog/labels";

// Тулбар журнала: сущность · пользователь · период · поиск. Всё состояние — в URL
// (?entity=&user=&from=&to=&q=), localStorage не используется: фильтр должен переживать
// перезагрузку и пересылаться ссылкой.
//
// FilterCombo — контролируемый и в URL сам не пишет (везде в проекте его состояние
// живёт в React-state). Мост «мультивыбор ↔ CSV-параметр» — здесь.

export function ChangeLogToolbar({
  users,
}: {
  users: { id: number; login: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");

  const csv = (key: string) =>
    new Set<string | number>(params.get(key)?.split(",").filter(Boolean) ?? []);

  const push = (mutate: (sp: URLSearchParams) => void) => {
    const sp = new URLSearchParams(params.toString());
    mutate(sp);
    // Любая правка фильтра возвращает на первую страницу: иначе ?page=7 при новой,
    // более узкой выборке показал бы пустой экран.
    sp.delete("page");
    router.replace(`${pathname}?${sp.toString()}`);
  };

  const setParam = (key: string, value: string | null) =>
    push((sp) => (value ? sp.set(key, value) : sp.delete(key)));

  const toggleCsv = (key: string, id: string | number) =>
    push((sp) => {
      const cur = new Set(sp.get(key)?.split(",").filter(Boolean) ?? []);
      const s = String(id);
      if (cur.has(s)) cur.delete(s);
      else cur.add(s);
      if (cur.size) sp.set(key, [...cur].join(","));
      else sp.delete(key);
    });

  // Дебаунс ввода поиска, чтобы не дёргать навигацию на каждую букву (как ReferenceToolbar).
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setParam("q", q || null), 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // «Система» — записи без сессии (user_id = null), обычным id её не выразить.
  const userOptions = [
    { id: SYSTEM_USER_ID, name: SYSTEM_USER_LABEL },
    ...users.map((u) => ({ id: String(u.id), name: u.login })),
  ];

  const dateCls =
    "h-9 rounded-md border bg-background px-2 text-sm tabular-nums";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <FilterCombo
        kind="status"
        label="Сущность"
        options={ENTITY_OPTIONS}
        selected={csv("entity")}
        onToggle={(id) => toggleCsv("entity", id)}
        onClear={() => setParam("entity", null)}
        searchable
        searchPlaceholder="Найти сущность…"
      />

      <FilterCombo
        kind="status"
        label="Пользователь"
        options={userOptions}
        selected={csv("user")}
        onToggle={(id) => toggleCsv("user", id)}
        onClear={() => setParam("user", null)}
        searchable
        searchPlaceholder="Найти логин…"
      />

      {/* Календаря shadcn в проекте нет — нативный input[type=date], как в «Расчётах». */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={params.get("from") ?? ""}
          onChange={(e) => setParam("from", e.target.value || null)}
          className={dateCls}
          aria-label="Начало периода"
        />
        <span className="text-sm text-muted-foreground">–</span>
        <input
          type="date"
          value={params.get("to") ?? ""}
          onChange={(e) => setParam("to", e.target.value || null)}
          className={dateCls}
          aria-label="Конец периода"
        />
      </div>

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск по значению или полю…"
        className="max-w-xs"
        aria-label="Поиск по журналу"
      />
    </div>
  );
}
