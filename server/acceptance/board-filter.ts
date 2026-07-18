import type { ComboOption } from "@/components/filters/FilterCombo";
import type {
  AcceptanceBoard,
  AcceptanceMachine,
  AcceptedMachine,
} from "./schema";

// --- Фильтрация доски приёмки (чистая, prisma-free). Единственный источник правды —
// делят десктопная AcceptanceBoard и печатный лист /print/acceptance (аналог
// filterFeedWeeks у ленты). Фильтр = вид, никаких мутаций. ---

export type AcceptanceFilters = {
  search: string;
  supplierSel: Set<number>;
  cultureSel: Set<number>;
};

// Позиции машины в единой форме (зоны 1/2 — items, зона 3 — positions).
type Row = {
  farmerId: number;
  cultureId: number;
  farmerName: string;
  cultureName: string;
  color: string;
};

function rowsOf(m: AcceptanceMachine | AcceptedMachine): Row[] {
  return "items" in m ? m.items : m.positions;
}

export function anyAcceptanceFilterActive(f: AcceptanceFilters): boolean {
  return f.search.trim() !== "" || f.supplierSel.size > 0 || f.cultureSel.size > 0;
}

// Машина атомарна (И между фильтрами): видна, если есть позиция с выбранным фермером И
// позиция с выбранной культурой (не обязательно одна и та же — как в ленте) И совпал поиск.
function machineVisible<M extends AcceptanceMachine | AcceptedMachine>(
  m: M,
  f: AcceptanceFilters,
  q: string,
): boolean {
  const rows = rowsOf(m);
  if (f.supplierSel.size && !rows.some((r) => f.supplierSel.has(r.farmerId)))
    return false;
  if (f.cultureSel.size && !rows.some((r) => f.cultureSel.has(r.cultureId)))
    return false;
  if (q) {
    const hit =
      m.code.toLowerCase().includes(q) ||
      (m.driverName?.toLowerCase().includes(q) ?? false) ||
      rows.some(
        (r) =>
          r.farmerName.toLowerCase().includes(q) ||
          r.cultureName.toLowerCase().includes(q),
      );
    if (!hit) return false;
  }
  return true;
}

export function filterBoard(
  board: AcceptanceBoard,
  filters: AcceptanceFilters,
): AcceptanceBoard {
  if (!anyAcceptanceFilterActive(filters)) return board;
  const q = filters.search.trim().toLowerCase();
  const zone1 = board.zone1.filter((m) => machineVisible(m, filters, q));
  const zone2 = board.zone2.filter((m) => machineVisible(m, filters, q));
  const zone3 = board.zone3.filter((m) => machineVisible(m, filters, q));
  return { zone1, zone2, zone3, acceptedCount: zone3.length };
}

// Опции комбобоксов — уникальные фермеры/культуры из ПОЛНОГО board (не отфильтрованного),
// плюс счётчик машин с этим фермером/культурой (по всем трём зонам). Культуры несут color.
export function boardOptions(board: AcceptanceBoard): {
  farmers: ComboOption[];
  cultures: ComboOption[];
} {
  const farmers = new Map<number, { name: string; count: number }>();
  const cultures = new Map<number, { name: string; color: string; count: number }>();
  const allMachines: (AcceptanceMachine | AcceptedMachine)[] = [
    ...board.zone1,
    ...board.zone2,
    ...board.zone3,
  ];
  for (const m of allMachines) {
    const fset = new Set<number>();
    const cset = new Set<number>();
    for (const r of rowsOf(m)) {
      if (!farmers.has(r.farmerId))
        farmers.set(r.farmerId, { name: r.farmerName, count: 0 });
      if (!cultures.has(r.cultureId))
        cultures.set(r.cultureId, { name: r.cultureName, color: r.color, count: 0 });
      fset.add(r.farmerId);
      cset.add(r.cultureId);
    }
    for (const id of fset) farmers.get(id)!.count += 1;
    for (const id of cset) cultures.get(id)!.count += 1;
  }
  return {
    farmers: [...farmers.entries()]
      .map(([id, v]) => ({ id, name: v.name, count: v.count }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    cultures: [...cultures.entries()]
      .map(([id, v]) => ({ id, name: v.name, color: v.color, count: v.count }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };
}
