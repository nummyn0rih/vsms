import {
  compareIsoWeek,
  currentSeasonWeek,
  isoWeek,
  isoWeekRange,
  parseDateUTC,
} from "@/server/shipments/workdays";
import { rowsOf } from "./board-filter";
import type { AcceptanceMachine, AcceptedMachine } from "./schema";

// --- Группировка машин доски приёмки по ISO-неделе ПРИБЫТИЯ (чистая, prisma-free).
// Механика недель одна на проект — берём хелперы ленты (isoWeek/isoWeekRange/
// compareIsoWeek/currentSeasonWeek), второй реализации не заводим. Считается на КЛИЕНТЕ:
// arrivalDate уже есть в AcceptanceMachine/AcceptedMachine, лоадер доски не трогаем. ---

export type AcceptanceView = "list" | "weeks";

export type WeekGroup<T> = {
  isoYear: number;
  isoWeek: number;
  startDate: string; // понедельник, YYYY-MM-DD
  endDate: string; // воскресенье, YYYY-MM-DD
  position: "past" | "current" | "future";
  machines: T[];
};

export type WeekGrouping<T> = {
  weeks: WeekGroup<T>[]; // по возрастанию недели
  undated: T[]; // arrivalDate = null (тип nullable, хотя форма дату требует)
};

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

export function groupByArrivalWeek<T extends { arrivalDate: string | null }>(
  machines: T[],
  today: Date = new Date(),
): WeekGrouping<T> {
  const current = currentSeasonWeek(today);
  const byWeek = new Map<string, WeekGroup<T>>();
  const undated: T[] = [];

  for (const m of machines) {
    if (!m.arrivalDate) {
      undated.push(m);
      continue;
    }
    const { isoYear, isoWeek: week } = isoWeek(parseDateUTC(m.arrivalDate));
    const key = `${isoYear}-${week}`;
    let bucket = byWeek.get(key);
    if (!bucket) {
      const { start, end } = isoWeekRange(isoYear, week);
      const cmp = compareIsoWeek({ isoYear, isoWeek: week }, current);
      bucket = {
        isoYear,
        isoWeek: week,
        startDate: toDateStr(start),
        endDate: toDateStr(end),
        position: cmp < 0 ? "past" : cmp > 0 ? "future" : "current",
        machines: [],
      };
      byWeek.set(key, bucket);
    }
    // Порядок внутри недели = порядок лоадера (arrival_date asc, затем id).
    bucket.machines.push(m);
  }

  return { weeks: [...byWeek.values()].sort(compareIsoWeek), undated };
}

// Культуры недели для чипов в шапке — уникальные, в русском алфавитном порядке.
// Строки берём через общий rowsOf: зоны 1/2 держат их в items, зона 3 — в positions.
export function weekCultures(
  machines: (AcceptanceMachine | AcceptedMachine)[],
): { cultureId: number; name: string; color: string }[] {
  const byId = new Map<number, { cultureId: number; name: string; color: string }>();
  for (const m of machines) {
    for (const r of rowsOf(m)) {
      if (!byId.has(r.cultureId))
        byId.set(r.cultureId, {
          cultureId: r.cultureId,
          name: r.cultureName,
          color: r.color,
        });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

// Ключ свёрнутости. Зона в ключе ОБЯЗАТЕЛЬНА: одна и та же неделя живёт во всех трёх
// зонах, и общий ключ схлопывал бы W31 сразу в трёх местах — это читалось бы как баг.
export function weekGroupKey(
  zone: string,
  week: { isoYear: number; isoWeek: number } | null,
): string {
  return week ? `${zone}:${week.isoYear}-${week.isoWeek}` : `${zone}:undated`;
}

// ?view=weeks|list. Невалид/отсутствие → "list" (текущий сплошной список).
export function parseAcceptanceView(
  raw: string | string[] | undefined,
): AcceptanceView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "weeks" ? "weeks" : "list";
}
