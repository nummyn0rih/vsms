"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PlanWeek } from "@/server/plan/schema";
import { loadPlanWeek } from "@/server/plan/actions";

// Загрузка сетки плана (B4a/B4c). Вынесена из PlanView, чтобы combobox состава в
// тулбаре (ShipmentsFeed) и матрица читали ОДНУ неделю и общий reload. `enabled` —
// фетчим только в виде «План» (не тянем план в табличном режиме).
// version — bump после каждой загрузки/конверсии: входит в key ячеек PlanInput,
// заставляя ремоунтиться со свежим savedValue.
export function usePlanWeek({
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
  const [week, setWeek] = useState<PlanWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const reqRef = useRef(0);

  const reload = useCallback(async () => {
    const my = ++reqRef.current;
    const data = await loadPlanWeek({ seasonYear, isoYear, isoWeek });
    if (my !== reqRef.current) return;
    setWeek(data);
    setVersion((v) => v + 1);
    setLoading(false);
  }, [seasonYear, isoYear, isoWeek]);

  useEffect(() => {
    if (!enabled) return;
    reload();
  }, [enabled, reload]);

  return { week, loading, version, setWeek, reload };
}
