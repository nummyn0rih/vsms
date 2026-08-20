"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { FilterCombo } from "@/components/filters/FilterCombo";

// Фильтр «Поставщик» профиля культуры: общий FilterCombo (мультивыбор + поиск), состояние —
// в URL (?suppliers=1,2,3), НЕ в localStorage.
//
// Мост «мультивыбор ↔ CSV-параметр» — тот же, что в ChangeLogToolbar (эталон): FilterCombo
// контролируемый и в URL сам не пишет. Пересчёт делает СЕРВЕР (страница — server component),
// поэтому URL пишем через router.replace, а не history.replaceState: replaceState не
// ре-рендерит серверный компонент, и цифры остались бы прежними при отмеченной галочке.
// Единственный источник истины — URL (проп selected приходит из него, уже нормализованный
// parseSupplierIds); useOptimistic лишь держит галочку отмеченной, пока идёт серверный
// ре-рендер, и сам откатывается к пропу, когда тот придёт.

const supplierIcon = (
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>
);

export function SupplierFilter({
  options,
  selected,
}: {
  options: { id: number; name: string; count: number }[];
  selected: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(selected);

  const sel = useMemo<Set<string | number>>(() => new Set(optimistic), [optimistic]);

  function apply(next: number[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.length > 0) params.set("suppliers", next.join(","));
    else params.delete("suppliers");
    const qs = params.toString();
    startTransition(() => {
      setOptimistic(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <FilterCombo
      kind="icon"
      label="Поставщик"
      icon={supplierIcon}
      options={options}
      selected={sel}
      onToggle={(id) => {
        const n = Number(id);
        const next = optimistic.includes(n)
          ? optimistic.filter((x) => x !== n)
          : [...optimistic, n].sort((a, b) => a - b);
        apply(next);
      }}
      onClear={() => apply([])}
      searchable
      searchPlaceholder="Найти поставщика…"
      align="end"
    />
  );
}
