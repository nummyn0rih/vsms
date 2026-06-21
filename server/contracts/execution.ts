import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { computeAcceptedKg } from "@/server/acceptance/accepted";
import { requireRole } from "@/server/auth/session";
import { seasonYearOf } from "@/server/shipments/workdays";

// C3a — живой расчёт СТОИМОСТИ позиций и ВЫПОЛНЕНИЯ строк контракта (BR-1/BR-6).
// Ничего не хранится: пересчёт на чтение. База стоимости/выполнения = ПРИНЯТЫЙ вес
// (после брака). Брак в выполнение НЕ идёт. Округление — только на показе (UI), здесь
// держим точные Decimal, как computeAcceptedKg.
//
// ПРИНЯТЫЙ ВЕС СЧИТАЕТСЯ НА ЛЕТУ, не из ShipmentItem.accepted_weight_kg (та колонка нигде
// не пишется — accepted везде вычисляется, как в feed-loader). Source of truth формулы —
// computeAcceptedKg. Для calibre раскладываем по категориям (нужно для разноса по строкам).

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
};

// Принятый вес simple-позиции на лету (BR-10) — единый источник формулы computeAcceptedKg.
// Возвращает Decimal или null. Для calibre не зовётся (там разнос по категориям).
function simpleAcceptedKg(item: ExecItem): Prisma.Decimal | null {
  const acc = computeAcceptedKg(item.actualKg?.toNumber() ?? null, item.brakPercent, []);
  return acc == null ? null : new Prisma.Decimal(acc);
}

// --- (а) Стоимость одной принятой позиции ---

// lineMap: line_id → price_per_kg. missingLine=true, если оплачиваемый вес есть, но строки
// (или цены) для него нет — загрузчик может показать предупреждение.
export function itemCost(
  item: ExecItem,
  lineMap: Map<number, Prisma.Decimal>,
): { cost: Prisma.Decimal; missingLine: boolean } {
  // simple: платим по принятому весу позиции (на лету) и строке позиции.
  if (item.calibres.length === 0) {
    const acceptedKg = simpleAcceptedKg(item);
    if (acceptedKg == null || acceptedKg.isZero()) {
      return { cost: ZERO, missingLine: false };
    }
    const price =
      item.contractLineId != null ? lineMap.get(item.contractLineId) : undefined;
    if (!price) return { cost: ZERO, missingLine: true };
    return { cost: acceptedKg.mul(price), missingLine: false };
  }

  // calibre: Σ по принятым категориям (actual × percent/100) × цена строки категории.
  // Нестандарт (is_accepted=false) — не платим. acceptedKg тут не используем.
  let cost = ZERO;
  let missingLine = false;
  const actual = item.actualKg ?? ZERO;
  for (const c of item.calibres) {
    if (!c.isAccepted) continue;
    const lineId = c.contractLineId ?? item.contractLineId;
    const catKg = actual.mul(new Prisma.Decimal(c.percent).div(HUNDRED));
    if (catKg.isZero()) continue;
    const price = lineId != null ? lineMap.get(lineId) : undefined;
    if (!price) {
      missingLine = true;
      continue;
    }
    cost = cost.add(catKg.mul(price));
  }
  return { cost, missingLine };
}

// --- (б) Разнос принятого веса по строкам (для выполнения) ---

// Возврат: line_id → Σ accepted_kg. Привязка к null-строке в карту НЕ попадает.
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
    // calibre → каждая принятая категория на свою строку.
    const actual = item.actualKg ?? ZERO;
    for (const c of item.calibres) {
      if (!c.isAccepted) continue;
      const catKg = actual.mul(new Prisma.Decimal(c.percent).div(HUNDRED));
      add(c.contractLineId ?? item.contractLineId, catKg);
    }
  }
  return map;
}

// --- (в) Выполнение одной строки контракта ---

export type LineExecution = {
  acceptedKg: Prisma.Decimal;
  targetKg: Prisma.Decimal; // volume_tons × 1000
  pct: Prisma.Decimal; // accepted/target×100, БЕЗ округления
  remainingKg: Prisma.Decimal; // может быть отрицательным (перевыполнение)
  cost: Prisma.Decimal; // accepted × price
};

export function lineExecution(
  line: { volumeTons: Prisma.Decimal; price: Prisma.Decimal },
  acceptedKgForLine: Prisma.Decimal,
): LineExecution {
  const targetKg = line.volumeTons.mul(KG_PER_TON);
  const pct = targetKg.isZero() ? ZERO : acceptedKgForLine.div(targetKg).mul(HUNDRED);
  return {
    acceptedKg: acceptedKgForLine,
    targetKg,
    pct,
    remainingKg: targetKg.sub(acceptedKgForLine),
    cost: acceptedKgForLine.mul(line.price),
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
  acceptedKg: number;
  targetKg: number;
  pct: number;
  remainingKg: number;
  cost: number;
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
  const acceptedByLine = attributeAcceptedToLines(execItems);

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
      cost: exec.cost.toNumber(),
      paid: !acceptedKg.isZero(),
      items: lineItems,
    };
  });

  return { lines: rows, hasMissingLine };
}
