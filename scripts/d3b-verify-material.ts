import "dotenv/config";
import dns from "node:dns";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import {
  applyOutboundDeliveryLeg,
  applyOutboundArrivedLeg,
  revertArrivedLeg,
  revertDeliveryLeg,
} from "../server/materials/movements";

// D3b: проверка движений рейса тары завод→фермер. Всё в одной $transaction с
// финальным throw — БД не меняется (rolled-back). Запуск: npx tsx scripts/d3b-verify-material.ts
dns.setDefaultResultOrder("ipv4first");

const FACTORY = 0;
const TRANSIT = -2;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

class Rollback extends Error {}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// Нетто по локации для типа тары рейса: Σ(to=L) − Σ(from=L).
async function balances(tx: Tx, tripId: number, typeId: number) {
  const ms = await tx.stockMovement.findMany({
    where: {
      source_doc_type: "material_shipment",
      source_doc_id: tripId,
      kind: "packaging",
      packaging_type_id: typeId,
    },
  });
  const net = new Map<number, number>();
  for (const m of ms) {
    const q = Number(m.quantity);
    if (m.to_location_id != null) net.set(m.to_location_id, (net.get(m.to_location_id) ?? 0) + q);
    if (m.from_location_id != null) net.set(m.from_location_id, (net.get(m.from_location_id) ?? 0) - q);
  }
  return net;
}

function fmt(net: Map<number, number>, locs: { label: string; id: number }[]) {
  return locs.map((l) => `${l.label}=${net.get(l.id) ?? 0}`).join(" · ");
}

async function main() {
  try {
    await prisma.$transaction(async (tx) => {
      const farmers = await tx.farmer.findMany({
        where: { active: true },
        take: 2,
        orderBy: { id: "asc" },
      });
      const boxType = await tx.packagingType.findFirst({ where: { kind: "box" } });
      if (farmers.length < 2 || !boxType) {
        throw new Error("Нужны 2 фермера и box-тип тары в БД");
      }
      const [fA, fB] = farmers;
      const driver = await tx.driver.findFirst();
      if (!driver) throw new Error("Нужен хотя бы один водитель");

      const locsA = [
        { label: "завод", id: FACTORY },
        { label: "транзит-2", id: TRANSIT },
        { label: `фермер#${fA.id}`, id: fA.id },
      ];

      console.log("=== Сценарий 1-4: один фермер, 4000 ящиков ===");
      const trip = await tx.materialShipment.create({
        data: {
          code: "T-TEST",
          departure_date: new Date(),
          arrival_date: new Date(),
          status: "planned",
          driver_id: driver.id,
          items: {
            create: [
              {
                farmer_id: fA.id,
                item_kind: "packaging",
                packaging_type_id: boxType.id,
                quantity: "4000",
              },
            ],
          },
        },
        include: { items: true },
      });

      await applyOutboundDeliveryLeg(tx, trip.items, trip.id, new Date());
      console.log("отправка:   ", fmt(await balances(tx, trip.id, boxType.id), locsA), "(ожид. завод=-4000 · транзит=+4000 · фермер=0)");

      await applyOutboundArrivedLeg(tx, trip.items, trip.id, new Date());
      console.log("прибытие:   ", fmt(await balances(tx, trip.id, boxType.id), locsA), "(ожид. завод=-4000 · транзит=0 · фермер=+4000)");

      const dup = await applyOutboundArrivedLeg(tx, trip.items, trip.id, new Date());
      console.log("повтор приб:", fmt(await balances(tx, trip.id, boxType.id), locsA), `(дублей нет: создано ${dup} движ.)`);

      await revertArrivedLeg(tx, trip.id, new Date());
      console.log("revert→sent:", fmt(await balances(tx, trip.id, boxType.id), locsA), "(ожид. завод=-4000 · транзит=+4000 · фермер=0)");

      await revertDeliveryLeg(tx, trip.id, new Date());
      console.log("revert→plan:", fmt(await balances(tx, trip.id, boxType.id), locsA), "(ожид. завод=0 · транзит=0 · фермер=0)");

      console.log("\n=== Сценарий 5: многопозиционный рейс (2 фермера) ===");
      const trip2 = await tx.materialShipment.create({
        data: {
          code: "T-TEST2",
          departure_date: new Date(),
          arrival_date: new Date(),
          status: "planned",
          driver_id: driver.id,
          items: {
            create: [
              { farmer_id: fA.id, item_kind: "packaging", packaging_type_id: boxType.id, quantity: "200" },
              { farmer_id: fB.id, item_kind: "packaging", packaging_type_id: boxType.id, quantity: "120" },
            ],
          },
        },
        include: { items: true },
      });
      await applyOutboundDeliveryLeg(tx, trip2.items, trip2.id, new Date());
      await applyOutboundArrivedLeg(tx, trip2.items, trip2.id, new Date());
      const net2 = await balances(tx, trip2.id, boxType.id);
      const locs2 = [
        { label: "завод", id: FACTORY },
        { label: "транзит-2", id: TRANSIT },
        { label: `фермер#${fA.id}`, id: fA.id },
        { label: `фермер#${fB.id}`, id: fB.id },
      ];
      console.log("после приб: ", fmt(net2, locs2), "(ожид. завод=-320 · транзит=0 · фермерA=+200 · фермерB=+120)");

      // ChangeLog проверяется в actions (logChange в той же tx). Здесь — только движения.
      throw new Rollback();
    });
  } catch (e) {
    if (e instanceof Rollback) {
      console.log("\n✓ Транзакция откачена (БД не изменена).");
    } else {
      throw e;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
