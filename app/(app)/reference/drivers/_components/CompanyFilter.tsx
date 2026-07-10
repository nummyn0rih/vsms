"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { TransportCompanyOption } from "@/server/drivers/schema";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Radix Select не допускает пустое значение → сентинел «все компании».
const ALL = "all";

// Фильтр списка водителей по ТК. Состояние в URL (?company=<id>), как и
// остальные фильтры тулбара. Комбинируется с поиском по фамилии. className —
// для мобильного узкого триггера (MobileDriversList), десктоп не передаёт →
// ширина остаётся w-52.
export function CompanyFilter({
  options,
  className,
}: {
  options: TransportCompanyOption[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const current = params.get("company") ?? ALL;

  const onChange = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === ALL) next.delete("company");
    else next.set("company", value);
    router.replace(`${pathname}?${next.toString()}`);
  };

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className={cn("w-52", className)}>
        <SelectValue placeholder="Все компании" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Все компании</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={String(o.id)}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
