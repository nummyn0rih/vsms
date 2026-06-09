"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// Переиспользуемая панель справочника: поиск (?q) + переключатель неактивных
// (?inactive=1) + слот для кнопки создания. Состояние живёт в URL — не в localStorage.
export function ReferenceToolbar({
  searchPlaceholder = "Поиск по имени…",
  children,
}: {
  searchPlaceholder?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const includeInactive = params.get("inactive") === "1";

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  };

  // Дебаунс ввода поиска, чтобы не дёргать навигацию на каждую букву.
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setParam("q", q || null), 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-4">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={searchPlaceholder}
        className="max-w-xs"
      />
      <div className="flex items-center gap-2">
        <Switch
          id="show-inactive"
          checked={includeInactive}
          onCheckedChange={(on) => setParam("inactive", on ? "1" : null)}
        />
        <Label htmlFor="show-inactive">Показывать неактивных</Label>
      </div>
      <div className="ml-auto">{children}</div>
    </div>
  );
}
