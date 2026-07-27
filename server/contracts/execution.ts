import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { computeAcceptedKg, computeSettlement } from "@/server/acceptance/accepted";
import { requireRole } from "@/server/auth/session";
import { seasonYearOf } from "@/server/shipments/workdays";

// C3a — живой расчёт СТОИМОСТИ позиций и ВЫПОЛНЕНИЯ строк контракта (BR-1/BR-6).
// Ничего не хранится: пересчёт на чтение. Округление — только на показе (UI), здесь
// держим точные Decimal, как computeAcceptedKg.
//
// ⚠ ДВЕ РАЗНЫЕ БАЗЫ ВЕСА — НЕ СЛИВАТЬ ОБРАТНО В ОДНО ЧИСЛО (BR-33, DOMAIN §1):
//   ВЫПОЛНЕНИЕ строки (тонны, % выполнения, остаток) — от ПРИНЯТОГО веса;
//   СТОИМОСТЬ (деньги) — от ОПЛАЧИВАЕМОГО = принятый + доплата по корректировке расчёта.
// Без корректировки (settlement_percent = null у всех актов) обе базы равны и поведение
// ровно такое же, как до BR-33. Разнос принятого — attributeAcceptedToLines, разнос
// доплаты — attributeSurchargeToLines; это ДВЕ отдельные карты сознательно: попадание
// доплаты в первую = доплата в тоннах выполнения контракта, что BR-33 запрещает.
//
// ПРИНЯТЫЙ ВЕС СЧИТАЕТСЯ НА ЛЕТУ. Колонки-снимка ShipmentItem.accepted_weight_kg больше НЕ
// существует — снесена миграцией cleanup_deprecated_snapshot_columns; accepted везде
// вычисляется, как в feed-loader. Source of truth формулы — computeAcceptedKg.
// Для calibre раскладываем по категориям (нужно для разноса по строкам).

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const KG_PER_TON = new Prisma.Decimal(1000);

// --- Чистые DTO (загрузчик маппит из Prisma-результата) ---

// Категория калибра у позиции (для calibre-культуры).
export type ItemCalibre = {
  percent: number; // CalibreResult.percent
  isAccepted: boolean; // calibreRange.is_accepted
  contractLineId: number | null; // CalibreResult.contract_line_id (BR-8 override)
};

export type ExecItem = {
  actualKg: Prisma.Decimal | null; // ShipmentItem.actual_weight_kg (база)
  brakPercent: number | null; // AcceptanceAct.brak_percent (для simple-веса)
  contractLineId: number | null; // ShipmentItem.contract_line_id (строка позиции)
  calibres: ItemCalibre[]; // [] для simple-культуры
  settlementPercent: number | null; // AcceptanceAct.settlement_percent (BR-33), null = нет
};

// Принятый вес simple-позиции на лету (BR-10) — единый источник формулы computeAcceptedKg.
// Возвращает Decimal или null. Для calibre не зовётся (там разнос по категориям).
function simpleAcceptedKg(item: ExecItem): Prisma.Decimal | null {
  const acc = computeAcceptedKg(item.actualKg?.toNumber() ?? null, item.brakPercent, []);
  return acc == null ? null : new Prisma.Decimal(acc);
}

// Доплата позиции по корректировке расчёта (BR-33) — обёртка над чистой
// computeSettlement (единый источник формулы) в Decimal-мир этого файла.
// Без корректировки → surchargeKg = 0 и пустой allocation.
function itemSurcharge(item: ExecItem): {
  surchargeKg: Prisma.Decimal;
  allocation: { contractLineId: number | null; kg: Prisma.Decimal }[];
} {
  if (item.settlementPercent == null || item.actualKg == null) {
    return { surchargeKg: ZERO, allocation: [] };
  }
  const actualKg = item.actualKg.toNumber();
  const s = computeSettlement({
    actualKg,
    acceptedKg: computeAcceptedKg(actualKg, item.brakPercent, item.calibres),
    settlementPercent: item.settlementPercent,
    itemLineId: item.contractLineId,
    calibres: item.calibres,
  });
  return {
    surchargeKg: new Prisma.Decimal(s.surchargeKg),
    allocation: s.allocation.map((a) => ({
      contractLineId: a.contractLineId,
      kg: new Prisma.Decimal(a.kg),
    })),
  };
}

// --- (а) Стоимость одной принятой позиции (ДЕНЬГИ → оплачиваемый вес) ---

// lineMap: line_id → price_per_kg. missingLine=true, если оплачиваемый вес есть, но строки
// (или цены) для него нет — загрузчик может показать предупреждение.
// База = ОПЛАЧИВАЕМЫЙ вес: принятый (как раньше) + доплата по BR-33, каждая доля доплаты
// по цене СВОЕЙ строки. Без корректировки доплата = 0 → число ровно как до BR-33.
export function itemCost(
  item: ExecItem,
  lineMap: Map<number, Prisma.Decimal>,
): { cost: Prisma.Decimal; missingLine: boolean } {
  let cost = ZERO;
  let missingLine = false;

  if (item.calibres.length === 0) {
    // simple: платим по принятому весу позиции (на лету) и строке позиции.
    const acceptedKg = simpleAcceptedKg(item);
    const price =
      item.contractLineId != null ? lineMap.get(item.contractLineId) : undefined;
    if (acceptedKg != null && !acceptedKg.isZero()) {
      if (price) cost = acceptedKg.mul(price);
      else missingLine = true;
    }
  } else {
    // calibre: Σ по категориям-СО-СТРОКОЙ (actual × percent/100) × цена их строки.
    // Гейт оплаты — contract_line_id != null, НЕ is_accepted (C3d-2, §5): принятая категория
    // падает на строку позиции (fallback), нестандарт — ТОЛЬКО на свою явную строку
    // (объёмы стандарта/нестандарта не смешиваются). acceptedKg тут не используем.
    const actual = item.actualKg ?? ZERO;
    for (const c of item.calibres) {
      const lineId = c.isAccepted ? c.contractLineId ?? item.contractLineId : c.contractLineId;
      // Нестандарт без строки — статистика, не оплата (и не missingLine).
      if (!c.isAccepted && lineId == null) continue;
      const catKg = actual.mul(new Prisma.Decimal(c.percent).div(HUNDRED));
      if (catKg.isZero()) continue;
      const price = lineId != null ? lineMap.get(lineId) : undefined;
      if (!price) {
        missingLine = true;
        continue;
      }
      cost = cost.add(catKg.mul(price));
    }
  }

  // Доплата по корректировке расчёта (BR-33) — только деньги, в тонны не идёт.
  for (const a of itemSurcharge(item).allocation) {
    if (a.kg.isZero()) continue;
    const price = a.contractLineId != null ? lineMap.get(a.contractLineId) : undefined;
    if (!price) {
      missingLine = true;
      continue;
    }
    cost = cost.add(a.kg.mul(price));
  }

  return { cost, missingLine };
}

// --- (б) Разнос ПРИНЯТОГО веса по строкам (для ВЫПОЛНЕНИЯ, тонны) ---

// Возврат: line_id → Σ kg, идущих в выполнение строки. Гейт — наличие строки
// (contract_line_id != null), не is_accepted (C3d-2, §5): нестандарт-со-строкой тоже
// идёт в выполнение СВОЕЙ строки. Привязка к null-строке в карту НЕ попадает.
export function attributeAcceptedToLines(
  items: ExecItem[],
): Map<number, Prisma.Decimal> {
  const map = new Map<number, Prisma.Decimal>();
  const add = (lineId: number | null, kg: Prisma.Decimal) => {
    if (lineId == null || kg.isZero()) return;
    map.set(lineId, (map.get(lineId) ?? ZERO).add(kg));
  };

  for (const item of items) {
    if (item.calibres.length === 0) {
      // simple → принятый вес позиции (на лету) на её строку.
      const acceptedKg = simpleAcceptedKg(item);
      if (acceptedKg != null) add(item.contractLineId, acceptedKg);
      continue;
    }
    // calibre → каждая категория-со-строкой на свою строку. Принятая → fallback на
    // строку позиции; нестандарт → только своя явная строка (объёмы не смешиваются).
    const actual = item.actualKg ?? ZERO;
    for (const c of item.calibres) {
      const lineId = c.isAccepted ? c.contractLineId ?? item.contractLineId : c.contractLineId;
      const catKg = actual.mul(new Prisma.Decimal(c.percent).div(HUNDRED));
      add(lineId, catKg);
    }
  }
  return map;
}

// --- (б-2) Разнос ДОПЛАТЫ по строкам (для ДЕНЕГ, BR-33) ---

// Возврат: line_id → Σ kg доплаты. ОТДЕЛЬНАЯ карта от attributeAcceptedToLines
// сознательно: доплата идёт только в стоимость, в тонны выполнения — никогда.
// Доля с contractLineId=null (нет строки) в карту не попадает — как и у принятого.
export function attributeSurchargeToLines(
  items: ExecItem[],
): Map<number, Prisma.Decimal> {
  const map = new Map<number, Prisma.Decimal>();
  for (const item of items) {
    for (const a of itemSurcharge(item).allocation) {
      if (a.contractLineId == null || a.kg.isZero()) continue;
      map.set(a.contractLineId, (map.get(a.contractLineId) ?? ZERO).add(a.kg));
    }
  }
  return map;
}

// --- (в) Выполнение одной строки контракта ---

export type LineExecution = {
  acceptedKg: Prisma.Decimal; // ТОННЫ: принятый вес по строке (без доплаты)
  targetKg: Prisma.Decimal; // volume_tons × 1000
  pct: Prisma.Decimal; // accepted/target×100, БЕЗ округления
  remainingKg: Prisma.Decimal; // может быть отрицательным (перевыполнение)
  surchargeKg: Prisma.Decimal; // доплата по строке (BR-33), 0 без корректировки
  paidKg: Prisma.Decimal; // ДЕНЬГИ: оплачиваемый = accepted + surcharge
  cost: Prisma.Decimal; // paid × price
};

// ⚠ Здесь и живёт развод двух баз: выполнение (acceptedKg/pct/remainingKg) считается
// от ПРИНЯТОГО, стоимость — от ОПЛАЧИВАЕМОГО. Не заменять paidKg на acceptedKg в cost
// и не добавлять surcharge в pct/remainingKg (BR-33: доплата в тонны не идёт).
export function lineExecution(
  line: { volumeTons: Prisma.Decimal; price: Prisma.Decimal },
  acceptedKgForLine: Prisma.Decimal,
  surchargeKgForLine: Prisma.Decimal = ZERO,
): LineExecution {
  const targetKg = line.volumeTons.mul(KG_PER_TON);
  const pct = targetKg.isZero() ? ZERO : acceptedKgForLine.div(targetKg).mul(HUNDRED);
  const paidKg = acceptedKgForLine.add(surchargeKgForLine);
  return {
    acceptedKg: acceptedKgForLine,
    targetKg,
    pct,
    remainingKg: targetKg.sub(acceptedKgForLine),
    surchargeKg: surchargeKgForLine,
    paidKg,
    cost: paidKg.mul(line.price),
  };
}

// --- Загрузчик (prisma) ---

export type LineExecutionRow = {
  lineId: number;
  cultureId: number;
  cultureName: string;
  color: string;
  label: string;
  pricePerKg: number;
  volumeTons: number;
  acceptedKg: number; // тонны выполнения (принятый вес, БЕЗ доплаты)
  targetKg: number;
  pct: number;
  remainingKg: number;
  surchargeKg: number; // доплата по BR-33 (0 без корректировки) — только в деньги
  paidKg: number; // оплачиваемый вес = accepted + surcharge
  cost: number; // paidKg × price
  paid: boolean; // оплачено по факту (в строку попал принятый вес)
  items: { itemId: number; cultureName: string; contributionKg: number }[];
};

export type ContractExecution = {
  lines: LineExecutionRow[];
  hasMissingLine: boolean; // есть оплачиваемый вес без привязанной строки
};

// Живой пересчёт стоимости/выполнения строк контракта(ов) фермера за сезон.
// Чтение — admin/operator/user (как другие read-загрузчики).
export async function getContractExecution(params: {
  contractId?: number;
  farmerId?: number;
  season: number;
}): Promise<ContractExecution> {
  await requireRole("admin", "operator", "user");

  // 1) Строки контракта(ов): по contractId или по farmerId+сезону.
  const contracts = await prisma.contract.findMany({
    where: params.contractId
      ? { id: params.contractId }
      : { farmer_id: params.farmerId, season_year: params.season },
    include: {
      lines: {
        include: {
          culture: {
            select: { id: true, name: true, color: true, acceptance_type: true },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (contracts.length === 0) return { lines: [], hasMissingLine: false };

  // Фермер для выборки позиций (при поиске по contractId берём из контракта).
  const farmerId = params.farmerId ?? contracts[0].farmer_id;
  const lines = contracts.flatMap((c) => c.lines);

  // 2) Принятые позиции этого фермера (acceptanceAct != null).
  const rawItems = await prisma.shipmentItem.findMany({
    where: { farmer_id: farmerId, acceptanceAct: { isNot: null } },
    select: {
      id: true,
      actual_weight_kg: true,
      contract_line_id: true,
      shipment: { select: { arrival_date: true, departure_date: true } },
      culture: { select: { name: true } },
      acceptanceAct: {
        select: {
          brak_percent: true,
          settlement_percent: true, // BR-33: корректировка расчёта (только деньги)
          calibreResults: {
            select: {
              percent: true,
              contract_line_id: true,
              calibreRange: { select: { is_accepted: true } },
            },
          },
        },
      },
    },
  });

  // 3) Фильтр по сезону (BR-17, по дате прибытия) + маппинг в ExecItem.
  type LoadedItem = { itemId: number; cultureName: string; exec: ExecItem };
  const items: LoadedItem[] = [];
  for (const it of rawItems) {
    const season = seasonYearOf(
      it.shipment.arrival_date ?? it.shipment.departure_date ?? new Date(),
    );
    if (season !== params.season) continue;
    items.push({
      itemId: it.id,
      cultureName: it.culture.name,
      exec: {
        actualKg: it.actual_weight_kg,
        brakPercent: it.acceptanceAct!.brak_percent?.toNumber() ?? null,
        contractLineId: it.contract_line_id,
        settlementPercent: it.acceptanceAct!.settlement_percent?.toNumber() ?? null,
        calibres: it.acceptanceAct!.calibreResults.map((cr) => ({
          percent: cr.percent.toNumber(),
          isAccepted: cr.calibreRange.is_accepted,
          contractLineId: cr.contract_line_id,
        })),
      },
    });
  }

  // 4) Карты: цены строк + разнос принятого + вклад позиций по строкам.
  const lineMap = new Map<number, Prisma.Decimal>(
    lines.map((l) => [l.id, l.price_per_kg]),
  );
  const execItems = items.map((i) => i.exec);
  // Две независимые карты: принятый (тонны выполнения) и доплата (только деньги, BR-33).
  const acceptedByLine = attributeAcceptedToLines(execItems);
  const surchargeByLine = attributeSurchargeToLines(execItems);

  // Вклад каждой позиции в каждую строку (для списка позиций в строке).
  const contribByLine = new Map<number, Map<number, Prisma.Decimal>>(); // line → (item → kg)
  for (const i of items) {
    const single = attributeAcceptedToLines([i.exec]);
    for (const [lineId, kg] of single) {
      if (!contribByLine.has(lineId)) contribByLine.set(lineId, new Map());
      contribByLine.get(lineId)!.set(i.itemId, kg);
    }
  }

  // hasMissingLine — есть ли оплачиваемый вес без строки.
  let hasMissingLine = false;
  for (const i of items) {
    if (itemCost(i.exec, lineMap).missingLine) hasMissingLine = true;
  }

  // 5) По каждой строке — выполнение.
  const rows: LineExecutionRow[] = lines.map((l) => {
    const acceptedKg = acceptedByLine.get(l.id) ?? ZERO;
    const exec = lineExecution(
      { volumeTons: l.volume_tons, price: l.price_per_kg },
      acceptedKg,
      surchargeByLine.get(l.id) ?? ZERO,
    );
    const contrib = contribByLine.get(l.id);
    const lineItems = contrib
      ? [...contrib].map(([itemId, kg]) => ({
          itemId,
          cultureName: items.find((i) => i.itemId === itemId)!.cultureName,
          contributionKg: kg.toNumber(),
        }))
      : [];
    return {
      lineId: l.id,
      cultureId: l.culture.id,
      cultureName: l.culture.name,
      color: l.culture.color,
      label: l.label ?? "",
      pricePerKg: l.price_per_kg.toNumber(),
      volumeTons: l.volume_tons.toNumber(),
      acceptedKg: exec.acceptedKg.toNumber(),
      targetKg: exec.targetKg.toNumber(),
      pct: exec.pct.toNumber(),
      remainingKg: exec.remainingKg.toNumber(),
      surchargeKg: exec.surchargeKg.toNumber(),
      paidKg: exec.paidKg.toNumber(),
      cost: exec.cost.toNumber(),
      paid: !acceptedKg.isZero(),
      items: lineItems,
    };
  });

  return { lines: rows, hasMissingLine };
}
