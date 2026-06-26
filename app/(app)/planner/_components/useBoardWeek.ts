"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BoardWeek } from "@/server/board/schema";
import { loadBoardWeek } from "@/server/board/actions";

// Загрузка недели доски (B5-1). Зеркало usePlanWeek: `enabled` — фетчим только в
// виде «Доска»; reqRef гасит гонку при быстрой смене недель.
export function useBoardWeek({
  seasonYear,
  isoYear,
  isoWeek,
  enabled,
}: {
  seasonYear: number;
  isoYear: number;
  isoWeek: number;
  enabled: boolean;
}) {
  const [week, setWeek] = useState<BoardWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);

  const reload = useCallback(async () => {
    const my = ++reqRef.current;
    const data = await loadBoardWeek({ seasonYear, isoYear, isoWeek });
    if (my !== reqRef.current) return;
    setWeek(data);
    setLoading(false);
  }, [seasonYear, isoYear, isoWeek]);

  useEffect(() => {
    if (!enabled) return;
    reload();
  }, [enabled, reload]);

  return { week, loading, reload };
}
