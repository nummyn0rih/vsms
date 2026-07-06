import { listAlertRules } from "./actions";
import {
  getTareBalances,
  getIngredientBalances,
  type TareBalances,
  type IngredientBalances,
} from "@/server/inventory/balances";
import type { AlertRuleRow } from "./schema";

// V1.1: read-only сравнение AlertRule.threshold с РЕАЛЬНЫМ балансом (DOMAIN.md §3:
// "Дефицит НЕ блокирует отгрузку — только информационные алерты"). Никакой новой
// агрегации движений — только чтение уже посчитанных cells из balances.ts. Мирроим
// map-key конвенцию server/board/board.ts (B5-2): `${farmerId}:${itemId}`.

export type Alert = {
  ruleId: number; // React key (`${ruleId}:${farmerId}`) — правила не мержатся
  itemKind: "packaging" | "ingredient";
  itemId: number;
  itemName: string;
  unit?: "kg" | "l"; // только ingredient; тара всегда "шт" (решается в UI)
  farmerId: number;
  farmerName: string;
  balance: number;
  threshold: number;
  deficit: number; // > 0, всегда = threshold - balance
};

// Чистая функция — тривиально юнит-тестируема без I/O.
export function computeDeficit(balance: number, threshold: number): number | null {
  if (balance < threshold) return threshold - balance;
  return null;
}

// Сортировка: ОТНОСИТЕЛЬНАЯ просадка deficit/threshold по убыванию — унифицирует
// шкалу между шт/кг/л. Строка показывает абсолютный deficit, не процент.
function sortByRelativeDeficit(a: Alert, b: Alert): number {
  return b.deficit / b.threshold - a.deficit / a.threshold;
}

function farmerNames(
  locations: { id: number; name: string; kind: string }[],
): Map<number, string> {
  const m = new Map<number, string>();
  for (const loc of locations) if (loc.kind === "farmer") m.set(loc.id, loc.name);
  return m;
}

// Дефицит тары: только ГОДНОЕ состояние (лом дефицитом не считается). null
// location_scope → разворот ТОЛЬКО по фермерам, у кого есть ячейка по этому
// item_id (присутствие в балансе), НЕ по всем активным фермерам.
export function computePackagingAlerts(
  rules: AlertRuleRow[],
  bal: TareBalances,
): Alert[] {
  const have = new Map<string, number>(); // `${farmerId}:${packagingTypeId}` -> qty
  const presence = new Map<number, Set<number>>(); // packagingTypeId -> farmerIds present

  for (const c of bal.cells) {
    if (c.state !== "good" || c.locationId <= 0) continue; // только фермеры, годная тара
    have.set(`${c.locationId}:${c.packagingTypeId}`, c.quantity);
    let set = presence.get(c.packagingTypeId);
    if (!set) presence.set(c.packagingTypeId, (set = new Set()));
    set.add(c.locationId);
  }
  const names = farmerNames(bal.locations);

  const out: Alert[] = [];
  for (const rule of rules) {
    if (rule.item_kind !== "packaging") continue;
    const farmerIds =
      rule.location_scope != null
        ? [rule.location_scope] // явный фермер — оцениваем ВСЕГДА, даже без ячейки (баланс 0)
        : [...(presence.get(rule.item_id) ?? [])];
    for (const farmerId of farmerIds) {
      const balance = have.get(`${farmerId}:${rule.item_id}`) ?? 0;
      const deficit = computeDeficit(balance, rule.threshold);
      if (deficit == null) continue;
      out.push({
        ruleId: rule.id,
        itemKind: "packaging",
        itemId: rule.item_id,
        itemName: rule.item_name,
        farmerId,
        farmerName:
          rule.location_scope != null
            ? rule.location_name
            : (names.get(farmerId) ?? `Фермер #${farmerId}`),
        balance,
        threshold: rule.threshold,
        deficit,
      });
    }
  }
  return out.sort(sortByRelativeDeficit);
}

// Дефицит ингредиентов: state всегда good (BR-27, нет scrap для ингредиента).
export function computeIngredientAlerts(
  rules: AlertRuleRow[],
  bal: IngredientBalances,
): Alert[] {
  const have = new Map<string, number>(); // `${farmerId}:${ingredientId}` -> qty
  const presence = new Map<number, Set<number>>();

  for (const c of bal.cells) {
    if (c.locationId <= 0) continue;
    have.set(`${c.locationId}:${c.ingredientId}`, c.quantity);
    let set = presence.get(c.ingredientId);
    if (!set) presence.set(c.ingredientId, (set = new Set()));
    set.add(c.locationId);
  }
  const names = farmerNames(bal.locations);
  const unitById = new Map(bal.columns.map((c) => [c.id, c.unit]));

  const out: Alert[] = [];
  for (const rule of rules) {
    if (rule.item_kind !== "ingredient") continue;
    const farmerIds =
      rule.location_scope != null
        ? [rule.location_scope]
        : [...(presence.get(rule.item_id) ?? [])];
    for (const farmerId of farmerIds) {
      const balance = have.get(`${farmerId}:${rule.item_id}`) ?? 0;
      const deficit = computeDeficit(balance, rule.threshold);
      if (deficit == null) continue;
      out.push({
        ruleId: rule.id,
        itemKind: "ingredient",
        itemId: rule.item_id,
        itemName: rule.item_name,
        unit: unitById.get(rule.item_id),
        farmerId,
        farmerName:
          rule.location_scope != null
            ? rule.location_name
            : (names.get(farmerId) ?? `Фермер #${farmerId}`),
        balance,
        threshold: rule.threshold,
        deficit,
      });
    }
  }
  return out.sort(sortByRelativeDeficit);
}

// Для мест, где нужны ОБА списка сразу (сайдбар-бейджи в layout.tsx). На
// /packaging и /ingredients баланс уже загружен для матрицы — там используйте
// compute*Alerts() напрямую, не дублируйте Prisma-запрос баланса.
export async function getActiveAlerts(): Promise<{
  tare: Alert[];
  ingredient: Alert[];
  tareCount: number;
  ingredientCount: number;
  total: number;
}> {
  const [rules, tareBal, ingBal] = await Promise.all([
    listAlertRules(),
    getTareBalances(),
    getIngredientBalances(),
  ]);
  const tare = computePackagingAlerts(rules, tareBal);
  const ingredient = computeIngredientAlerts(rules, ingBal);
  return {
    tare,
    ingredient,
    tareCount: tare.length,
    ingredientCount: ingredient.length,
    total: tare.length + ingredient.length,
  };
}
