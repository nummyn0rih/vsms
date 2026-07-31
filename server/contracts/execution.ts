import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth/session";
import { seasonYearOf } from "@/server/shipments/workdays";
import {
  ZERO,
  attributeAcceptedToLines,
  attributeSurchargeToLines,
  itemCost,
  lineExecution,
  type ExecItem,
} from "./execution-core";

// C3a — загрузчик живого расчёта стоимости/выполнения (BR-1/BR-6).
//
// Формулы живут в ./execution-core (prisma-free, покрыт юнит-тестами). Здесь — только
// выборка из БД, фильтр сезона и сборка строк. Ре-экспорт ниже сохраняет публичный API
// этого модуля: импорты itemCost/attribute*ToLines/lineExecution/ExecItem из
// "@/server/contracts/execution" работают как раньше (acceptance/board.ts,
// scripts/settlement-verify.ts, farmers/settlement-agg.ts).
export * from "./execution-core";

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
