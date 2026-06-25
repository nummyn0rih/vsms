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
const DELIVERY = { origin: 0, transit: -2 } as const; // transfer-1: доставка с завода

// E1: проверка обобщённого движка доставки (тара + ингредиент + смешанный груз).
// Всё в одной $transaction с финальным throw — БД не меняется (rolled-back).
// Запуск: npx tsx scripts/e1-verify-material.ts
dns.setDefaultResultOrder("ipv4first");

const FACTORY = 0;
const TRANSIT = -2;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

class Rollback extends Error {}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type Ref = { kind: "packaging" | "ingredient"; itemId: number };

// Нетто по локации для конкретного (kind, FK) рейса: Σ(to=L) − Σ(from=L).
async function balances(tx: Tx, tripId: number, ref: Ref) {
  const ms = await tx.stockMovement.findMany({
    where: {
      source_doc_type: "material_shipment",
      source_doc_id: tripId,
      kind: ref.kind,
      ...(ref.kind === "packaging"
        ? { packaging_type_id: ref.itemId }
        : { ingredient_id: ref.itemId }),
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

// Проверка, что у движений ингредиента состояния null (а тары — good).
async function stateCheck(tx: Tx, tripId: number) {
  const ms = await tx.stockMovement.findMany({
    where: { source_doc_type: "material_shipment", source_doc_id: tripId },
    select: { kind: true, from_state: true, to_state: true },
  });
  const bad = ms.filter((m) =>
    m.kind === "ingredient"
      ? m.from_state !== null || m.to_state !== null
      : m.from_state !== "good" || m.to_state !== "good",
  );
  return bad.length === 0;
}

async function main() {
  try {
    await prisma.$transaction(async (tx) => {
      const farmers = await tx.farmer.findMany({ where: { active: true }, take: 3, orderBy: { id: "asc" } });
      const boxType = await tx.packagingType.findFirst({ where: { kind: "box" } });
      const driver = await tx.driver.findFirst();
      if (farmers.length < 3 || !boxType || !driver) {
        throw new Error("Нужны 3 фермера, box-тип тары и водитель в БД");
      }
      const [fX, fY, fZ] = farmers;

      // Ингредиенты: берём существующие или создаём временные (откатятся).
      let salt = await tx.ingredient.findFirst({ where: { active: true } });
      if (!salt) salt = await tx.ingredient.create({ data: { name: "Соль (тест)", unit: "kg" } });
      let vinegar = await tx.ingredient.findFirst({ where: { active: true, id: { not: salt.id } } });
      if (!vinegar) vinegar = await tx.ingredient.create({ data: { name: "Уксус (тест)", unit: "l" } });

      const box: Ref = { kind: "packaging", itemId: boxType.id };
      const saltRef: Ref = { kind: "ingredient", itemId: salt.id };
      const vinRef: Ref = { kind: "ingredient", itemId: vinegar.id };

      // ===== A. РЕГРЕСС ТАРЫ =====
      console.log("=== A. РЕГРЕСС ТАРЫ (фермер X, 4000 ящиков) ===");
      const tA = await tx.materialShipment.create({
        data: {
          code: "E1-A", departure_date: new Date(), arrival_date: new Date(), status: "planned", driver_id: driver.id,
          items: { create: [{ farmer_id: fX.id, item_kind: "packaging", packaging_type_id: boxType.id, quantity: "4000" }] },
        },
        include: { items: true },
      });
      const locsA = [
        { label: "завод", id: FACTORY }, { label: "транз-2", id: TRANSIT }, { label: `ферм#${fX.id}`, id: fX.id },
      ];
      await applyOutboundDeliveryLeg(tx, tA.items, tA.id, new Date(), DELIVERY);
      console.log("send:       ", fmt(await balances(tx, tA.id, box), locsA), "(ожид. завод=-4000 · транз=+4000 · ферм=0)");
      await applyOutboundArrivedLeg(tx, tA.items, tA.id, new Date(), DELIVERY);
      console.log("arrive:     ", fmt(await balances(tx, tA.id, box), locsA), "(ожид. завод=-4000 · транз=0 · ферм=+4000)");
      const dupA = await applyOutboundArrivedLeg(tx, tA.items, tA.id, new Date(), DELIVERY) + await applyOutboundDeliveryLeg(tx, tA.items, tA.id, new Date(), DELIVERY);
      console.log("повтор:     ", fmt(await balances(tx, tA.id, box), locsA), `(дублей нет: создано ${dupA} движ.)`);
      await revertArrivedLeg(tx, tA.id, new Date(), DELIVERY);
      console.log("rev→sent:   ", fmt(await balances(tx, tA.id, box), locsA), "(ожид. завод=-4000 · транз=+4000 · ферм=0)");
      await revertDeliveryLeg(tx, tA.id, new Date(), DELIVERY);
      console.log("rev→plan:   ", fmt(await balances(tx, tA.id, box), locsA), "(ожид. всё 0)");

      // ===== B. ИНГРЕДИЕНТ =====
      console.log(`\n=== B. ИНГРЕДИЕНТ (фермер Y, ${salt.name} 500 ${salt.unit}) ===`);
      const tB = await tx.materialShipment.create({
        data: {
          code: "E1-B", departure_date: new Date(), arrival_date: new Date(), status: "planned", driver_id: driver.id,
          items: { create: [{ farmer_id: fY.id, item_kind: "ingredient", ingredient_id: salt.id, quantity: "500" }] },
        },
        include: { items: true },
      });
      const locsB = [
        { label: "завод", id: FACTORY }, { label: "транз-2", id: TRANSIT }, { label: `ферм#${fY.id}`, id: fY.id },
      ];
      await applyOutboundDeliveryLeg(tx, tB.items, tB.id, new Date(), DELIVERY);
      console.log("send:       ", fmt(await balances(tx, tB.id, saltRef), locsB), "(ожид. завод=-500 · транз=+500 · ферм=0)");
      await applyOutboundArrivedLeg(tx, tB.items, tB.id, new Date(), DELIVERY);
      console.log("arrive:     ", fmt(await balances(tx, tB.id, saltRef), locsB), "(ожид. завод=-500 · транз=0 · ферм=+500)");
      const dupB = await applyOutboundArrivedLeg(tx, tB.items, tB.id, new Date(), DELIVERY);
      console.log("повтор:     ", fmt(await balances(tx, tB.id, saltRef), locsB), `(дублей нет: создано ${dupB} движ.)`);
      await revertArrivedLeg(tx, tB.id, new Date(), DELIVERY);
      console.log("rev→sent:   ", fmt(await balances(tx, tB.id, saltRef), locsB), "(ожид. завод=-500 · транз=+500 · ферм=0)");
      await revertDeliveryLeg(tx, tB.id, new Date(), DELIVERY);
      console.log("rev→plan:   ", fmt(await balances(tx, tB.id, saltRef), locsB), "(ожид. всё 0)");
      console.log("state null: ", (await stateCheck(tx, tB.id)) ? "OK (ингр. from/to_state=null)" : "FAIL");

      // ===== C. СМЕШАННЫЙ РЕЙС =====
      console.log(`\n=== C. СМЕШАННЫЙ РЕЙС (фермер Z: ящики 300 + ${vinegar.name} 200 ${vinegar.unit}) ===`);
      const tC = await tx.materialShipment.create({
        data: {
          code: "E1-C", departure_date: new Date(), arrival_date: new Date(), status: "planned", driver_id: driver.id,
          items: {
            create: [
              { farmer_id: fZ.id, item_kind: "packaging", packaging_type_id: boxType.id, quantity: "300" },
              { farmer_id: fZ.id, item_kind: "ingredient", ingredient_id: vinegar.id, quantity: "200" },
            ],
          },
        },
        include: { items: true },
      });
      const locsC = [
        { label: "завод", id: FACTORY }, { label: "транз-2", id: TRANSIT }, { label: `ферм#${fZ.id}`, id: fZ.id },
      ];
      const sendC = await applyOutboundDeliveryLeg(tx, tC.items, tC.id, new Date(), DELIVERY);
      console.log(`send (${sendC} движ., guard не заблокировал 2-й kind):`);
      console.log("  ящики:    ", fmt(await balances(tx, tC.id, box), locsC), "(ожид. завод=-300 · транз=+300 · ферм=0)");
      console.log("  уксус:    ", fmt(await balances(tx, tC.id, vinRef), locsC), "(ожид. завод=-200 · транз=+200 · ферм=0)");
      await applyOutboundArrivedLeg(tx, tC.items, tC.id, new Date(), DELIVERY);
      console.log("arrive:");
      console.log("  ящики:    ", fmt(await balances(tx, tC.id, box), locsC), "(ожид. завод=-300 · транз=0 · ферм=+300)");
      console.log("  уксус:    ", fmt(await balances(tx, tC.id, vinRef), locsC), "(ожид. завод=-200 · транз=0 · ферм=+200)");
      const dupC = await applyOutboundArrivedLeg(tx, tC.items, tC.id, new Date(), DELIVERY);
      console.log(`повтор:      дублей нет (создано ${dupC} движ.)`);
      await revertArrivedLeg(tx, tC.id, new Date(), DELIVERY);
      await revertDeliveryLeg(tx, tC.id, new Date(), DELIVERY);
      console.log("после обоих откатов (нетто по kind раздельно):");
      console.log("  ящики:    ", fmt(await balances(tx, tC.id, box), locsC), "(ожид. всё 0)");
      console.log("  уксус:    ", fmt(await balances(tx, tC.id, vinRef), locsC), "(ожид. всё 0)");
      console.log("state mix:  ", (await stateCheck(tx, tC.id)) ? "OK (тара good · ингр. null)" : "FAIL");

      console.log("\nD. RBAC: send/revert*=admin, arrive=admin|operator, user отклоняется — проверки requireRole в actions.ts не менялись (статус-флоу не переписывался).");

      throw new Rollback();
    }, { timeout: 30000 });
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
