import { prisma } from "@/lib/prisma";
import {
  calcPackagingUnits,
  loadPackagingContext,
  tripleKey,
} from "./packaging";
import {
  isoWeek,
  isoWeekRange,
  weekdayName,
  currentSeasonWeek,
  compareIsoWeek,
  isFactoryWorkday,
  type SeasonWorkdays,
} from "./workdays";
import type { Feed, FeedDay, FeedItem, FeedShipment, FeedWeek } from "./feed";

// Серверный загрузчик ленты (B3). ОТДЕЛЁН от feed.ts, т.к. тянет prisma — чтобы
// чистые типы/подытоги (feed.ts) можно было импортировать в client-компоненты
// без затягивания pg/dns в бандл. Дерево: сезон → неделя(ISO) → день → машина →
// позиция. Неделя/день — по дате ПРИБЫТИЯ (DESIGN §2, BR-17). Тара позиции
// считается здесь через calcPackagingUnits (подытоги остаются чистыми).

function toDateStr(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

const feedItemInclude = {
  farmer: { select: { name: true } },
  culture: { select: { name: true, color: true } },
  packagingType: { select: { name: true, kind: true } },
  contractLine: { select: { label: true } },
} as const;

export async function getFeed({
  seasonYear,
  weekFrom,
  weekTo,
}: {
  seasonYear: number;
  weekFrom?: number;
  weekTo?: number;
}): Promise<Feed> {
  // Сезон = год начала (июнь, BR-17): [июнь seasonYear, июнь seasonYear+1).
  const seasonStart = new Date(Date.UTC(seasonYear, 5, 1));
  const seasonEnd = new Date(Date.UTC(seasonYear + 1, 5, 1));

  const [shipments, cfg] = await Promise.all([
    prisma.shipment.findMany({
      where: { arrival_date: { gte: seasonStart, lt: seasonEnd } },
      include: {
        items: { include: feedItemInclude, orderBy: { id: "asc" } },
        // Модалка водителя (DESIGN §2): кроме имени/ТК нужны id, телефон, инфо.
        driver: {
          select: {
            id: true,
            full_name: true,
            phone: true,
            info: true,
            transportCompany: { select: { name: true } },
          },
        },
      },
      // Машины внутри дня сортируем стабильно: время создания, затем id.
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    }),
    prisma.seasonConfig.findUnique({ where: { season_year: seasonYear } }),
  ]);

  // Один пакетный проход нормы по тройкам для ВСЕХ позиций (без N+1).
  const allItems = shipments.flatMap((s) => s.items);
  const ctx = await loadPackagingContext(prisma, allItems);

  function mapItem(item: (typeof allItems)[number]): FeedItem {
    const norm =
      item.packaging_type_id != null
        ? ctx.normByTriple.get(
            tripleKey(item.farmer_id, item.culture_id, item.packaging_type_id),
          )
        : null;
    const calc = calcPackagingUnits(
      item.planned_weight_kg,
      item.packaging_type_id,
      norm,
    );
    return {
      id: item.id,
      farmerId: item.farmer_id,
      farmerName: item.farmer.name,
      cultureId: item.culture_id,
      cultureName: item.culture.name,
      color: item.culture.color,
      plannedKg: item.planned_weight_kg.toNumber(),
      packagingTypeId: item.packaging_type_id,
      packagingTypeName: item.packagingType?.name ?? null,
      packagingKind: item.packagingType?.kind ?? null,
      tareUnits: calc.status === "ok" ? calc.units : null,
      tareMissingNorm: calc.status === "missing_norm",
      contractLineId: item.contract_line_id,
      contractLineLabel: item.contractLine?.label ?? null,
    };
  }

  // Группируем машины по дням (дата прибытия) → потом дни в недели.
  const shipmentsByDate = new Map<string, FeedShipment[]>();
  for (const s of shipments) {
    if (!s.arrival_date) continue;
    const key = s.arrival_date.toISOString().slice(0, 10);
    const fs: FeedShipment = {
      id: s.id,
      code: s.code,
      status: s.status,
      departureDate: toDateStr(s.departure_date),
      arrivalDate: toDateStr(s.arrival_date),
      driverName: s.driver?.full_name ?? null,
      transportCompanyName: s.driver?.transportCompany.name ?? null,
      driverId: s.driver?.id ?? null,
      driverPhone: s.driver?.phone ?? null,
      driverInfo: s.driver?.info ?? null,
      comment: s.comment,
      createdAt: s.created_at.toISOString(),
      items: s.items.map(mapItem),
    };
    const arr = shipmentsByDate.get(key);
    if (arr) arr.push(fs);
    else shipmentsByDate.set(key, [fs]);
  }

  // Недели, в которых есть отгрузки (по ISO-неделе даты прибытия).
  const weekKeys = new Map<string, { isoYear: number; isoWeek: number }>();
  for (const dateKey of shipmentsByDate.keys()) {
    const w = isoWeek(new Date(`${dateKey}T00:00:00Z`));
    weekKeys.set(`${w.isoYear}-${w.isoWeek}`, w);
  }

  const today = currentSeasonWeek();
  const seasonCfg: SeasonWorkdays | null = cfg;

  const weeks: FeedWeek[] = [...weekKeys.values()]
    .filter(
      (w) =>
        (weekFrom == null || w.isoWeek >= weekFrom) &&
        (weekTo == null || w.isoWeek <= weekTo),
    )
    .sort((a, b) => compareIsoWeek(a, b))
    .map((w) => {
      const { start, end } = isoWeekRange(w.isoYear, w.isoWeek);
      // Все дни Пн..Вс: рабочий день показываем всегда, нерабочий — только с машинами.
      const days: FeedDay[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setUTCDate(d.getUTCDate() + i);
        const dateKey = d.toISOString().slice(0, 10);
        const dayShipments = shipmentsByDate.get(dateKey) ?? [];
        const workday = isFactoryWorkday(d, seasonCfg);
        if (dayShipments.length === 0 && !workday) continue;
        days.push({
          date: dateKey,
          weekdayName: weekdayName(d),
          isWorkday: workday,
          shipments: dayShipments,
        });
      }
      const cmp = compareIsoWeek(w, today);
      return {
        isoYear: w.isoYear,
        isoWeek: w.isoWeek,
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        position: cmp < 0 ? "past" : cmp > 0 ? "future" : "current",
        days,
      } satisfies FeedWeek;
    });

  return { seasonYear, weeks };
}
