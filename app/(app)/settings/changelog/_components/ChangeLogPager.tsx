"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fmtInt } from "@/lib/format";

// Пагинация журнала. Номер страницы — в URL (?page=), как и остальные фильтры:
// ссылка на конкретную страницу должна открываться у другого админа так же.

export function ChangeLogPager({
  page,
  pageCount,
  total,
}: {
  page: number;
  pageCount: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (next: number) => {
    const sp = new URLSearchParams(params.toString());
    if (next <= 1) sp.delete("page");
    else sp.set("page", String(next));
    router.replace(`${pathname}?${sp.toString()}`);
  };

  if (total === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground tabular-nums">
        Страница {page} из {pageCount} · всего записей: {fmtInt(total)}
      </span>

      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => go(page - 1)}
            aria-label="Предыдущая страница"
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={page >= pageCount}
            onClick={() => go(page + 1)}
            aria-label="Следующая страница"
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
