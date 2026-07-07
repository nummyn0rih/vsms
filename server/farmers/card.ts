import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth/session";
import { listContracts, getContractView } from "@/server/contracts/actions";
import type { ContractDetailView } from "@/server/contracts/schema";
import { getTareBalances, getIngredientBalances } from "@/server/inventory/balances";
import { computeAcceptedKg } from "@/server/acceptance/accepted";
import {
  currentSeasonWeek,
  isoWeek,
  isoWeekRange,
  seasonYearOf,
  compareIsoWeek,
} from "@/server/shipments/workdays";
import { TRANSIT_TO_FACTORY } from "@/server/shipments/packaging";
import type { FarmerContacts } from "./schema";
import type { Prisma } from "@/lib/generated/prisma/client";

// D4c: read-only агрегатор карточки поставщика (Экран 4 PRD). Композиция УЖЕ
// существующих loaders (execution/balances/computeAcceptedKg/calcPackagingUnits) —
// формулы стоимости/выполнения/тары НЕ дублируются, только сводятся вместе.
// Сезон — текущий (currentSeasonWeek), переключатель сезона — бэклог (V1.1).

export type FarmerCardStatus = "planned" | "sent" | "arrived" | "accepted";

export type FarmerCard = {
  farmer: {
    id: number;
    name: string;
    active: boolean;
    contacts: {
      phone: string;
      contactPerson: string | null;
      messenger: string | null;
      email: string | null;
    };
    notes: string | null;
    season: number;
  };
  kpi: {
    tareOnBalance: number;
    tareByType: { name: string; qty: number }[];
  };
  contracts: {
    items: ContractDetailView[];
    farmerTotal: { acceptedKg: number; targetKg: number; pct: number; costRub: number };
  };
  shipments: {
    weeks: {
      isoYear: number;
      isoWeek: number;
      startDate: string;
      endDate: string;
      machineCount: number;
      totalAcceptedKg: number;
      rows: {
        itemId: number;
        date: string | null;
        machineCode: string;
        status: FarmerCardStatus;
        cultureName: string;
        color: string;
        plannedKg: number;
        actualKg: number | null;
        acceptedKg: number | null;
      }[];
    }[];
  };
  balances: {
    tare: {
      own: { typeId: number; typeName: string; good: number; scrap: number }[];
      transitToFarmer: { typeName: string; qty: number }[];
      transitToFactory: { typeName: string; qty: number }[];
    };
    ingredients: {
      own: { name: string; qty: number; unit: "kg" | "l" }[];
      transitToFarmer: { name: string; qty: number; unit: "kg" | "l" }[];
    };
  };
};

function readContacts(value: Prisma.JsonValue | null): FarmerCard["farmer"]["contacts"] {
  const c = value && typeof value === "object" ? (value as Partial<FarmerContacts>) : {};
  return {
    phone: c.phone ?? "",
    contactPerson: c.contactPerson?.trim() || null,
    messenger: c.messenger?.trim() || null,
    email: c.email?.trim() || null,
  };
}

// Итог по фермеру за сезон = Σ по ВСЕМ строкам ВСЕХ контрактов (тот же источник,
// что и вкладка «Контракты» — гарантия «одно число» для шапки и итога, BR §5).
function sumFarmerTotal(items: ContractDetailView[]): FarmerCard["contracts"]["farmerTotal"] {
  let acceptedKg = 0;
  let targetKg = 0;
  let costRub = 0;
  for (const c of items) {
    for (const l of c.lines) {
      acceptedKg += l.acceptedKg;
      targetKg += l.targetKg;
      costRub += l.costRub;
    }
  }
  const pct = targetKg > 0 ? (acceptedKg / targetKg) * 100 : 0;
  return { acceptedKg, targetKg, pct, costRub };
}

export async function getFarmerCard(farmerId: number): Promise<FarmerCard | null> {
  await requireRole();

  const farmer = await prisma.farmer.findUnique({ where: { id: farmerId } });
  if (!farmer) return null;

  const season = currentSeasonWeek().seasonYear;

  const [contractRows, tareBalances, ingredientBalances, shipmentItems, transitToFarmerTare, transitToFarmerIng, sentTareShipments] =
    await Promise.all([
      listContracts({ farmerId, season }),
      getTareBalances(),
      getIngredientBalances(),
      prisma.shipmentItem.findMany({
        where: { farmer_id: farmerId },
        select: {
          id: true,
          planned_weight_kg: true,
          actual_weight_kg: true,
          culture: { select: { name: true, color: true } },
          shipment: {
            select: { code: true, status: true, departure_date: true, arrival_date: true },
          },
          acceptanceAct: {
            select: {
              brak_percent: true,
              calibreResults: {
                select: { percent: true, calibreRange: { select: { is_accepted: true } } },
              },
            },
          },
        },
      }),
      prisma.materialShipmentItem.groupBy({
        by: ["packaging_type_id"],
        where: {
          farmer_id: farmerId,
          item_kind: "packaging",
          arrived_at: null,
          materialShipment: { status: "sent" },
        },
        _sum: { quantity: true },
      }),
      prisma.materialShipmentItem.groupBy({
        by: ["ingredient_id"],
        where: {
          farmer_id: farmerId,
          item_kind: "ingredient",
          arrived_at: null,
          materialShipment: { status: "sent" },
        },
        _sum: { quantity: true },
      }),
      prisma.shipmentItem.findMany({
        where: {
          farmer_id: farmerId,
          shipment: { status: "sent" },
          packaging_type_id: { not: null },
        },
        select: { shipment_id: true },
      }),
    ]);

  // --- Контракты: по каждому — getContractView (уже мёржит getContract+execution) ---
  const contractItems = await Promise.all(
    contractRows.map((c) => getContractView(c.id)),
  );
  const contracts: ContractDetailView[] = contractItems.filter(
    (c): c is ContractDetailView => c != null,
  );
  const farmerTotal = sumFarmerTotal(contracts);

  // --- KPI: тара на балансе фермера (Σ good по типам) ---
  const typeNameById = new Map(tareBalances.types.map((t) => [t.id, t.name]));
  const tareByType: { name: string; qty: number }[] = [];
  let tareOnBalance = 0;
  for (const cell of tareBalances.cells) {
    if (cell.locationId !== farmerId || cell.state !== "good") continue;
    tareOnBalance += cell.quantity;
    tareByType.push({ name: typeNameById.get(cell.packagingTypeId) ?? `#${cell.packagingTypeId}`, qty: cell.quantity });
  }

  // --- Отгрузки: группировка по ISO-неделе, недели по убыванию ---
  type Row = FarmerCard["shipments"]["weeks"][number]["rows"][number];
  const weekBuckets = new Map<string, { isoYear: number; isoWeek: number; rows: Row[] }>();
  for (const it of shipmentItems) {
    const refDate = it.shipment.arrival_date ?? it.shipment.departure_date;
    const seasonOfItem = seasonYearOf(refDate ?? new Date());
    if (seasonOfItem !== season) continue;

    const acceptedKg = it.acceptanceAct
      ? computeAcceptedKg(
          it.actual_weight_kg != null ? it.actual_weight_kg.toNumber() : null,
          it.acceptanceAct.brak_percent != null ? it.acceptanceAct.brak_percent.toNumber() : null,
          it.acceptanceAct.calibreResults.map((c) => ({
            percent: c.percent.toNumber(),
            isAccepted: c.calibreRange.is_accepted,
          })),
        )
      : null;

    const w = isoWeek(refDate ?? new Date());
    const key = `${w.isoYear}-${w.isoWeek}`;
    if (!weekBuckets.has(key)) weekBuckets.set(key, { isoYear: w.isoYear, isoWeek: w.isoWeek, rows: [] });
    weekBuckets.get(key)!.rows.push({
      itemId: it.id,
      date: refDate ? refDate.toISOString().slice(0, 10) : null,
      machineCode: it.shipment.code,
      status: it.shipment.status,
      cultureName: it.culture.name,
      color: it.culture.color,
      plannedKg: it.planned_weight_kg.toNumber(),
      actualKg: it.actual_weight_kg != null ? it.actual_weight_kg.toNumber() : null,
      acceptedKg,
    });
  }
  const weeks = [...weekBuckets.values()]
    .sort((a, b) => compareIsoWeek(b, a))
    .map((wk) => {
      const rows = wk.rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      const { start, end } = isoWeekRange(wk.isoYear, wk.isoWeek);
      const machineCount = new Set(rows.map((r) => r.machineCode)).size;
      const totalAcceptedKg = rows.reduce((s, r) => s + (r.acceptedKg ?? 0), 0);
      return {
        isoYear: wk.isoYear,
        isoWeek: wk.isoWeek,
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        machineCount,
        totalAcceptedKg,
        rows,
      };
    });

  // --- Балансы: тара/ингредиенты собственные + транзит per-farmer ---
  const own: FarmerCard["balances"]["tare"]["own"] = [];
  const ownByType = new Map<number, { good: number; scrap: number }>();
  for (const cell of tareBalances.cells) {
    if (cell.locationId !== farmerId) continue;
    const entry = ownByType.get(cell.packagingTypeId) ?? { good: 0, scrap: 0 };
    entry[cell.state] = cell.quantity;
    ownByType.set(cell.packagingTypeId, entry);
  }
  for (const [typeId, v] of ownByType) {
    own.push({ typeId, typeName: typeNameById.get(typeId) ?? `#${typeId}`, good: v.good, scrap: v.scrap });
  }

  const transitToFarmer = transitToFarmerTare
    .filter((g) => g.packaging_type_id != null && (g._sum.quantity?.toNumber() ?? 0) > 0)
    .map((g) => ({
      typeName: typeNameById.get(g.packaging_type_id!) ?? `#${g.packaging_type_id}`,
      qty: g._sum.quantity!.toNumber(),
    }));

  // Тара «фермер → завод»: плечо отправки (farmer → -1) ещё не принято заводом
  // (applyInboundArrivedTareLeg наступает на sent→arrived, packaging.ts:128).
  // Читаем ИЗ УЖЕ ЗАПИСАННЫХ StockMovement плеча отправки, а не пересчитываем текущей
  // нормой — норма могла смениться, пока отгрузка ещё в sent (десинхрон с леджером).
  const sentShipmentIds = [...new Set(sentTareShipments.map((it) => it.shipment_id))];
  const transitToFactoryByType = new Map<number, number>();
  if (sentShipmentIds.length > 0) {
    const legMovements = await prisma.stockMovement.findMany({
      where: {
        kind: "packaging",
        movement_type: "return",
        packaging_type_id: { not: null },
        source_doc_type: "shipment",
        source_doc_id: { in: sentShipmentIds },
        OR: [
          { from_location_id: farmerId, to_location_id: TRANSIT_TO_FACTORY },
          { from_location_id: TRANSIT_TO_FACTORY, to_location_id: farmerId },
        ],
      },
      select: { packaging_type_id: true, from_location_id: true, to_location_id: true, quantity: true },
    });
    for (const m of legMovements) {
      if (m.packaging_type_id == null) continue;
      // Оригинал плеча отправки (farmer→-1) — плюс; сторно отката sent→planned
      // (-1→farmer) — минус. Нетто = сколько реально осядет при arrived.
      const delta = m.to_location_id === TRANSIT_TO_FACTORY ? m.quantity.toNumber() : -m.quantity.toNumber();
      transitToFactoryByType.set(
        m.packaging_type_id,
        (transitToFactoryByType.get(m.packaging_type_id) ?? 0) + delta,
      );
    }
  }
  const transitToFactory = [...transitToFactoryByType.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([typeId, qty]) => ({
      typeName: typeNameById.get(typeId) ?? `#${typeId}`,
      qty,
    }));

  const ingNameById = new Map(ingredientBalances.columns.map((c) => [c.id, c]));
  const ownIngredients: FarmerCard["balances"]["ingredients"]["own"] = [];
  for (const cell of ingredientBalances.cells) {
    if (cell.locationId !== farmerId) continue;
    const col = ingNameById.get(cell.ingredientId);
    ownIngredients.push({ name: col?.name ?? `#${cell.ingredientId}`, qty: cell.quantity, unit: col?.unit ?? "kg" });
  }
  const transitIngredients = transitToFarmerIng
    .filter((g) => g.ingredient_id != null && (g._sum.quantity?.toNumber() ?? 0) > 0)
    .map((g) => {
      const col = ingNameById.get(g.ingredient_id!);
      return { name: col?.name ?? `#${g.ingredient_id}`, qty: g._sum.quantity!.toNumber(), unit: col?.unit ?? "kg" };
    });

  return {
    farmer: {
      id: farmer.id,
      name: farmer.name,
      active: farmer.active,
      contacts: readContacts(farmer.contacts),
      notes: farmer.notes,
      season,
    },
    kpi: { tareOnBalance, tareByType },
    contracts: { items: contracts, farmerTotal },
    shipments: { weeks },
    balances: {
      tare: { own, transitToFarmer, transitToFactory },
      ingredients: { own: ownIngredients, transitToFarmer: transitIngredients },
    },
  };
}
