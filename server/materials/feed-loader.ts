import { prisma } from "@/lib/prisma";
import {
  isoWeek,
  isoWeekRange,
  currentSeasonWeek,
  compareIsoWeek,
} from "@/server/shipments/workdays";
import type { MaterialFeed, MaterialTrip, MaterialWeek } from "./feed";

// Серверный загрузчик ленты материалов (D3b). Тянет prisma — отдельно от feed.ts
// (чистые типы/подытоги). Дерево: сезон → неделя(ISO ОТПРАВЛЕНИЯ) → рейс → позиция.

function toDateStr(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

const itemInclude = {
  farmer: { select: { name: true } },
  packagingType: { select: { name: true, kind: true, capacity_kg: true } },
  ingredient: { select: { name: true, unit: true } },
} as const;

export async function getMaterialShipments(
  seasonYear: number,
): Promise<MaterialFeed> {
  // Сезон = год начала (июнь, BR-17): [июнь seasonYear, июнь seasonYear+1).
  const seasonStart = new Date(Date.UTC(seasonYear, 5, 1));
  const seasonEnd = new Date(Date.UTC(seasonYear + 1, 5, 1));

  const trips = await prisma.materialShipment.findMany({
    where: { departure_date: { gte: seasonStart, lt: seasonEnd } },
    include: {
      items: { include: itemInclude, orderBy: { id: "asc" } },
      driver: {
        select: {
          full_name: true,
          phone: true,
          info: true,
          transportCompany: { select: { name: true } },
        },
      },
      transfer_source_farmer: { select: { name: true } },
    },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
  });

  const current = currentSeasonWeek();

  // Группировка по ISO-неделе отправления. Ключ — `${isoYear}-${isoWeek}`.
  const byWeek = new Map<string, MaterialWeek>();
  for (const t of trips) {
    if (!t.departure_date) continue;
    const { isoYear, isoWeek: week } = isoWeek(t.departure_date);
    const key = `${isoYear}-${week}`;

    let bucket = byWeek.get(key);
    if (!bucket) {
      const { start, end } = isoWeekRange(isoYear, week);
      const cmp = compareIsoWeek({ isoYear, isoWeek: week }, current);
      bucket = {
        isoYear,
        isoWeek: week,
        startDate: toDateStr(start)!,
        endDate: toDateStr(end)!,
        position: cmp < 0 ? "past" : cmp > 0 ? "future" : "current",
        trips: [],
      };
      byWeek.set(key, bucket);
    }

    const status = t.status as MaterialTrip["status"];
    const totalCount = t.items.length;
    const arrivedCount = t.items.filter((i) => i.arrived_at != null).length;
    // "partial" — производное только для UI: рейс отправлен, прибыла часть позиций.
    const derivedStatus: MaterialTrip["derivedStatus"] =
      status === "sent" && arrivedCount > 0 && arrivedCount < totalCount
        ? "partial"
        : status;

    const trip: MaterialTrip = {
      id: t.id,
      code: t.code,
      status,
      derivedStatus,
      sourceFarmerId: t.source_farmer_id,
      sourceLabel:
        t.source_farmer_id == null
          ? "Завод"
          : (t.transfer_source_farmer?.name ?? "—"),
      arrivedCount,
      totalCount,
      departureDate: toDateStr(t.departure_date),
      arrivalDate: toDateStr(t.arrival_date),
      driverName: t.driver.full_name,
      transportCompanyName: t.driver.transportCompany.name,
      driverPhone: t.driver.phone,
      driverInfo: t.driver.info,
      createdAt: t.created_at.toISOString(),
      items: t.items.map((i) => ({
        id: i.id,
        farmerId: i.farmer_id,
        farmerName: i.farmer.name,
        itemKind: i.item_kind,
        packagingTypeId: i.packaging_type_id,
        packagingTypeName: i.packagingType?.name ?? null,
        packagingKind: i.packagingType?.kind ?? null,
        capacityKg: i.packagingType?.capacity_kg
          ? Number(i.packagingType.capacity_kg)
          : null,
        ingredientId: i.ingredient_id,
        ingredientName: i.ingredient?.name ?? null,
        ingredientUnit: i.ingredient?.unit ?? null,
        quantity: Number(i.quantity),
        arrivedAt: toDateStr(i.arrived_at),
      })),
    };
    bucket.trips.push(trip);
  }

  // Недели по возрастанию (прошлые → будущие), как лента отгрузок.
  const weeks = [...byWeek.values()].sort((a, b) =>
    compareIsoWeek(a, b),
  );

  return { seasonYear, weeks };
}
