import { prisma } from "@/lib/prisma";
import type { AcceptanceBoard, AcceptanceMachine } from "./schema";

// Загрузчик доски приёмки (B4b, BR-26). Server-only (тянет prisma) — типы для
// client лежат в schema.ts. Три зоны: 1 sent (ожидают перевески), 2 arrived (на
// приёмке), 3 accepted (заглушка, этап C — грузим только счётчик). Тару/прогресс
// НЕ считаем. Сортировка машин — по дате прибытия.

function toDateStr(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export async function getAcceptanceBoard(): Promise<AcceptanceBoard> {
  const [shipments, acceptedCount] = await Promise.all([
    prisma.shipment.findMany({
      where: { status: { in: ["sent", "arrived"] } },
      include: {
        items: {
          include: {
            culture: { select: { name: true, color: true } },
            farmer: { select: { name: true } },
          },
          orderBy: { id: "asc" },
        },
        driver: {
          select: {
            full_name: true,
            phone: true,
            info: true,
            transportCompany: { select: { name: true } },
          },
        },
      },
      // null arrival_date в конец (машины без даты), затем по id.
      orderBy: [{ arrival_date: "asc" }, { id: "asc" }],
    }),
    prisma.shipment.count({ where: { status: "accepted" } }),
  ]);

  const mapMachine = (s: (typeof shipments)[number]): AcceptanceMachine => {
    const items = s.items.map((it) => ({
      id: it.id,
      cultureName: it.culture.name,
      color: it.culture.color,
      farmerName: it.farmer.name,
      plannedKg: it.planned_weight_kg.toNumber(),
      actualKg: it.actual_weight_kg != null ? it.actual_weight_kg.toNumber() : null,
    }));
    return {
      id: s.id,
      code: s.code,
      status: s.status as "sent" | "arrived",
      departureDate: toDateStr(s.departure_date),
      arrivalDate: toDateStr(s.arrival_date),
      driverName: s.driver?.full_name ?? null,
      transportCompanyName: s.driver?.transportCompany.name ?? null,
      driverPhone: s.driver?.phone ?? null,
      driverInfo: s.driver?.info ?? null,
      comment: s.comment,
      weighed: items.filter((i) => i.actualKg != null).length,
      total: items.length,
      items,
    };
  };

  const zone1: AcceptanceMachine[] = [];
  const zone2: AcceptanceMachine[] = [];
  for (const s of shipments) {
    if (s.status === "sent") zone1.push(mapMachine(s));
    else if (s.status === "arrived") zone2.push(mapMachine(s));
  }

  return { zone1, zone2, acceptedCount };
}
