"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { FarmerOption, SeasonOption } from "@/server/contracts/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Radix Select не допускает пустое значение → сентинел «все».
const ALL = "all";

// Фильтры списка контрактов по фермеру и сезону. Состояние в URL (?farmer, ?season),
// комбинируются. Образец — drivers/CompanyFilter.
export function ContractFilters({
  farmers,
  seasons,
}: {
  farmers: FarmerOption[];
  seasons: SeasonOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Select
        value={params.get("farmer") ?? ALL}
        onValueChange={(v) => setParam("farmer", v)}
      >
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Все фермеры" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Все фермеры</SelectItem>
          {farmers.map((f) => (
            <SelectItem key={f.id} value={String(f.id)}>
              {f.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={params.get("season") ?? ALL}
        onValueChange={(v) => setParam("season", v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Все сезоны" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Все сезоны</SelectItem>
          {seasons.map((s) => (
            <SelectItem key={s.season_year} value={String(s.season_year)}>
              {s.season_year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
