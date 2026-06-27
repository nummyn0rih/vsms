import "dotenv/config";
import dns from "node:dns";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import {
  applyInboundArrivedTareLeg,
  FACTORY_LOCATION_ID,
  TRANSIT_TO_FACTORY,
} from "../server/shipments/packaging";

// shipment-revert: проверка нетто-консистентности тарных плеч при откате arrived→sent.
// Критично: applyInboundArrivedTareLeg БЕЗ гарда существования должен ПЕРЕСОЗДАВАТЬ
// плечо прибытия после сторно (0→-1). Send-плечо и сторно мимикрируем как в actions.ts
// (sendShipment / revertShipmentToSent) — requireRole не зовём (скрипт без сессии).
// Всё в одной $transaction с финальным throw — БД не меняется (rolled-back).
// Запуск: npx tsx scripts/shipment-revert-verify.ts
dns.setDefaultResultOrder("ipv4first");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

class Rollback extends Error {}
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const QTY = 10;

// Нетто по локации для packaging-плеча отгрузки: Σ(to=L) − Σ(from=L).
async function bal(tx: Tx, shipmentId: number, pkgId: number) {
  const ms = await tx.stockMovement.findMany({
    where: { source_doc_type: "shipment", source_doc_id: shipmentId, kind: "packaging", packaging_type_id: pkgId },
  });
  const net = new Map<number, number>();
  for (const m of ms) {
    const q = Number(m.quantity);
    if (m.to_location_id != null) net.set(m.to_location_id, (net.get(m.to_location_id) ?? 0) + q);
    if (m.from_location_id != null) net.set(m.from_location_id, (net.get(m.from_location_id) ?? 0) - q);
  }
  return net;
}

function fmt(net: Map<number, number>, farmerId: number) {
  const f = (id: number) => net.get(id) ?? 0;
  return `завод=${f(FACTORY_LOCATION_ID)} · транз-1=${f(TRANSIT_TO_FACTORY)} · ферм#${farmerId}=${f(farmerId)}`;
}

let pass = 0;
let fail = 0;
function check(label: string, net: Map<number, number>, farmerId: number, expFactory: number, expTransit: number, expFarmer: number) {
  const ok =
    (net.get(FACTORY_LOCATION_ID) ?? 0) === expFactory &&
    (net.get(TRANSIT_TO_FACTORY) ?? 0) === expTransit &&
    (net.get(farmerId) ?? 0) === expFarmer;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${fmt(net, farmerId)}  (ожид. завод=${expFactory} · транз=${expTransit} · ферм=${expFarmer})`);
  ok ? pass++ : fail++;
}

async function main() {
  try {
    await prisma.$queryRaw`SELECT 1`; // прогрев соединения (Neon cold-start)
    await prisma.$transaction(async (tx) => {
      const farmer = await tx.farmer.findFirst({ where: { active: true }, orderBy: { id: "asc" } });
      const culture = await tx.culture.findFirst({ where: { active: true } });
      const box = await tx.packagingType.findFirst({ where: { kind: "box" } });
      if (!farmer || !culture || !box) throw new Error("Нужны активный фермер, культура и box-тип тары");

      const shipment = await tx.shipment.create({
        data: {
          code: "REV-1", status: "planned", departure_date: new Date(),
          items: { create: [{ farmer_id: farmer.id, culture_id: culture.id, planned_weight_kg: "1000", packaging_type_id: box.id }] },
        },
      });
      const sid = shipment.id;
      const pkg = box.id;

      // 1. SEND (planned→sent): плечо отправки фермер → -1 (как sendShipment).
      console.log("=== Цикл тарных плеч (откат прибытия и повторный ход) ===");
      await tx.stockMovement.create({
        data: { date: new Date(), kind: "packaging", packaging_type_id: pkg, quantity: String(QTY), from_location_id: farmer.id, to_location_id: TRANSIT_TO_FACTORY, from_state: "good", to_state: "good", movement_type: "return", source_doc_type: "shipment", source_doc_id: sid },
      });
      check("send (фермер→-1)", await bal(tx, sid, pkg), farmer.id, 0, QTY, -QTY);

      // 2. ARRIVE (sent→arrived): реальная функция, плечо -1 → 0.
      const c1 = await applyInboundArrivedTareLeg(tx, sid);
      check(`arrive #1 (создано ${c1} движ.)`, await bal(tx, sid, pkg), farmer.id, QTY, 0, -QTY);

      // 2b. Идемпотентность: повтор не дублирует (net=0).
      const c1b = await applyInboundArrivedTareLeg(tx, sid);
      console.log(`  ${c1b === 0 ? "✓" : "✗"} повтор arrive: создано ${c1b} движ. (ожид. 0)`);
      c1b === 0 ? pass++ : fail++;

      // 3. REVERT arrived→sent: сторно прибытия 0 → -1 (как revertShipmentToSent).
      await tx.stockMovement.create({
        data: { date: new Date(), kind: "packaging", packaging_type_id: pkg, quantity: String(QTY), from_location_id: FACTORY_LOCATION_ID, to_location_id: TRANSIT_TO_FACTORY, from_state: "good", to_state: "good", movement_type: "return", source_doc_type: "shipment", source_doc_id: sid },
      });
      check("revertToSent (0→-1)", await bal(tx, sid, pkg), farmer.id, 0, QTY, -QTY);

      // 4. RE-ARRIVE: плечо ДОЛЖНО пересоздаться (доказательство снятия гарда).
      const c2 = await applyInboundArrivedTareLeg(tx, sid);
      console.log(`  ${c2 === 1 ? "✓" : "✗"} re-arrive: создано ${c2} движ. (ожид. 1 — плечо пересоздано без гарда)`);
      c2 === 1 ? pass++ : fail++;
      check("arrive #2", await bal(tx, sid, pkg), farmer.id, QTY, 0, -QTY);

      // 5. REVERT sent→planned после возврата в sent (transit -1 → фермер), затем
      //    повторный send. Сначала вернёмся в sent ещё раз для проверки цепочки план.
      await tx.stockMovement.create({
        data: { date: new Date(), kind: "packaging", packaging_type_id: pkg, quantity: String(QTY), from_location_id: FACTORY_LOCATION_ID, to_location_id: TRANSIT_TO_FACTORY, from_state: "good", to_state: "good", movement_type: "return", source_doc_type: "shipment", source_doc_id: sid },
      });
      // revertShipmentToPlanned: нетто (тип×фермер), оригинал to=-1 +, сторно to=фермер −.
      // здесь чистый остаток транзита = QTY → сторно -1 → фермер.
      await tx.stockMovement.create({
        data: { date: new Date(), kind: "packaging", packaging_type_id: pkg, quantity: String(QTY), from_location_id: TRANSIT_TO_FACTORY, to_location_id: farmer.id, from_state: "good", to_state: "good", movement_type: "return", source_doc_type: "shipment", source_doc_id: sid },
      });
      check("revertToPlanned (-1→фермер)", await bal(tx, sid, pkg), farmer.id, 0, 0, 0);

      // 6. Повторный SEND после отката в план: плечо отправки создаётся заново.
      await tx.stockMovement.create({
        data: { date: new Date(), kind: "packaging", packaging_type_id: pkg, quantity: String(QTY), from_location_id: farmer.id, to_location_id: TRANSIT_TO_FACTORY, from_state: "good", to_state: "good", movement_type: "return", source_doc_type: "shipment", source_doc_id: sid },
      });
      check("re-send", await bal(tx, sid, pkg), farmer.id, 0, QTY, -QTY);
      const c3 = await applyInboundArrivedTareLeg(tx, sid);
      check(`re-arrive #3 (создано ${c3} движ.)`, await bal(tx, sid, pkg), farmer.id, QTY, 0, -QTY);

      console.log(`\nИтог: ${pass} OK, ${fail} FAIL`);
      throw new Rollback();
    }, { timeout: 30000, maxWait: 15000 });
  } catch (e) {
    if (e instanceof Rollback) console.log("✓ Транзакция откачена (БД не изменена).");
    else throw e;
  } finally {
    await prisma.$disconnect();
  }
}

main();
