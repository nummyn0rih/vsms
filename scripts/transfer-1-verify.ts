import "dotenv/config";
import dns from "node:dns";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import {
  applyOutboundDeliveryLeg,
  applyArrivedLegForItem,
  revertArrivedLegForItem,
  revertDeliveryLeg,
  legContext,
} from "../server/materials/movements";
import { materialShipmentSchema } from "../server/materials/schema";

// transfer-1: проверка переноса остатков фермер→фермер на том же движке доставки.
// origin/transit берутся из рейса через legContext: доставка {0,-2}, перенос {A,-3}.
// Всё в одной $transaction с финальным throw — БД не меняется (rolled-back).
// Запуск: npx tsx scripts/transfer-1-verify.ts
dns.setDefaultResultOrder("ipv4first");

const FACTORY = 0;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

class Rollback extends Error {}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type Ref = { kind: "packaging" | "ingredient"; itemId: number };

// Нетто по локации для (kind, FK) рейса: Σ(to=L) − Σ(from=L).
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

async function main() {
  try {
    await prisma.$transaction(async (tx) => {
      const farmers = await tx.farmer.findMany({ where: { active: true }, take: 3, orderBy: { id: "asc" } });
      const boxType = await tx.packagingType.findFirst({ where: { kind: "box" } });
      const driver = await tx.driver.findFirst();
      if (farmers.length < 3 || !boxType || !driver) {
        throw new Error("Нужны 3 активных фермера, box-тип тары и водитель в БД");
      }
      const [fX, fA, fB] = farmers; // fX — для регресса доставки; fA→fB — перенос
      let ing = await tx.ingredient.findFirst({ where: { active: true } });
      if (!ing) ing = await tx.ingredient.create({ data: { name: "Соль (тест)", unit: "kg" } });

      const box: Ref = { kind: "packaging", itemId: boxType.id };
      const ingRef: Ref = { kind: "ingredient", itemId: ing.id };

      // ===== A. РЕГРЕСС ДОСТАВКИ (source=null → origin=0, транзит -2) =====
      console.log("=== A. РЕГРЕСС ДОСТАВКИ (завод→фермер, смешанный груз) ===");
      const tA = await tx.materialShipment.create({
        data: {
          code: "T1-A", departure_date: new Date(), arrival_date: new Date(), status: "planned", driver_id: driver.id,
          source_farmer_id: null,
          items: { create: [
            { farmer_id: fX.id, item_kind: "packaging", packaging_type_id: boxType.id, quantity: "300" },
            { farmer_id: fX.id, item_kind: "ingredient", ingredient_id: ing.id, quantity: "200" },
          ] },
        },
        include: { items: true },
      });
      const ctxA = legContext(tA);
      console.log(`  legContext: origin=${ctxA.origin} transit=${ctxA.transit} (ожид. 0 / -2)`);
      const locsA = [{ label: "завод", id: FACTORY }, { label: "транз-2", id: -2 }, { label: `ферм#${fX.id}`, id: fX.id }];
      await applyOutboundDeliveryLeg(tx, tA.items, tA.id, new Date(), ctxA);
      console.log("  send  ящики:", fmt(await balances(tx, tA.id, box), locsA), "(ожид. завод=-300 · транз=+300 · ферм=0)");
      console.log("  send  ингр.:", fmt(await balances(tx, tA.id, ingRef), locsA), "(ожид. завод=-200 · транз=+200 · ферм=0)");
      // markAll = цикл per-item; затем повтор → дублей нет
      for (const it of tA.items) await applyArrivedLegForItem(tx, it, tA.id, new Date(), ctxA);
      for (const it of tA.items) await applyArrivedLegForItem(tx, it, tA.id, new Date(), ctxA);
      console.log("  arrive ящ.: ", fmt(await balances(tx, tA.id, box), locsA), "(ожид. завод=-300 · транз=0 · ферм=+300)");
      console.log("  arrive инг.:", fmt(await balances(tx, tA.id, ingRef), locsA), "(ожид. завод=-200 · транз=0 · ферм=+200)");
      for (const it of tA.items) await revertArrivedLegForItem(tx, it, tA.id, new Date(), ctxA);
      console.log("  unmark ящ.: ", fmt(await balances(tx, tA.id, box), locsA), "(ожид. завод=-300 · транз=+300 · ферм=0)");
      await revertDeliveryLeg(tx, tA.id, new Date(), ctxA);
      console.log("  revPlan ящ.:", fmt(await balances(tx, tA.id, box), locsA), "(ожид. всё 0)");
      console.log("  revPlan инг:", fmt(await balances(tx, tA.id, ingRef), locsA), "(ожид. всё 0)");

      // ===== B. TRANSFER (source=A → origin=A, транзит -3) =====
      console.log(`\n=== B. TRANSFER (фермер#${fA.id} → фермер#${fB.id}, ящики 100) ===`);
      const tB = await tx.materialShipment.create({
        data: {
          code: "T1-B", departure_date: new Date(), arrival_date: new Date(), status: "planned", driver_id: driver.id,
          source_farmer_id: fA.id,
          items: { create: [{ farmer_id: fB.id, item_kind: "packaging", packaging_type_id: boxType.id, quantity: "100" }] },
        },
        include: { items: true },
      });
      const ctxB = legContext(tB);
      console.log(`  legContext: origin=${ctxB.origin} transit=${ctxB.transit} (ожид. ${fA.id} / -3)`);
      const locsB = [{ label: "завод", id: FACTORY }, { label: `источ.A#${fA.id}`, id: fA.id }, { label: "транз-3", id: -3 }, { label: `получ.B#${fB.id}`, id: fB.id }];
      await applyOutboundDeliveryLeg(tx, tB.items, tB.id, new Date(), ctxB);
      console.log("  send:       ", fmt(await balances(tx, tB.id, box), locsB), `(ожид. завод=0 · A=-100 · транз-3=+100 · B=0)`);
      const m1 = await applyArrivedLegForItem(tx, tB.items[0], tB.id, new Date(), ctxB);
      console.log("  markItem B: ", fmt(await balances(tx, tB.id, box), locsB), `(ожид. завод=0 · A=-100 · транз-3=0 · B=+100) [+${m1} движ.]`);
      const m2 = await applyArrivedLegForItem(tx, tB.items[0], tB.id, new Date(), ctxB);
      console.log(`  повтор markItem: создано ${m2} движ. (ожид. 0 — дублей нет)`);

      // ===== C. TRANSFER ОТКАТЫ =====
      console.log("\n=== C. TRANSFER ОТКАТЫ ===");
      await revertArrivedLegForItem(tx, tB.items[0], tB.id, new Date(), ctxB);
      console.log("  unmarkItem: ", fmt(await balances(tx, tB.id, box), locsB), "(ожид. A=-100 · транз-3=+100 · B=0)");
      await revertDeliveryLeg(tx, tB.id, new Date(), ctxB);
      console.log("  revToPlan:  ", fmt(await balances(tx, tB.id, box), locsB), "(ожид. всё 0 — вернулось к A)");
      console.log("  guard «прибывшая → revToPlanned отклонён»: в action revertMaterialToPlanned (trip.items.some(arrived)) — НЕ менялся.");

      // ===== D. ВАЛИДАЦИЯ (schema) =====
      console.log("\n=== D. ВАЛИДАЦИЯ ===");
      const base = { driver_id: String(driver.id), departure_date: "2026-06-25", arrival_date: "2026-06-25" };
      const selfT = materialShipmentSchema.safeParse({
        ...base, source_farmer_id: String(fA.id),
        items: [{ farmer_id: String(fA.id), item_kind: "packaging", packaging_type_id: String(boxType.id), quantity: "10" }],
      });
      console.log("  self-transfer (B==A):", selfT.success ? "FAIL (пропущено)" : "OK (zod-ошибка) — " + JSON.stringify(selfT.error.issues.map((i) => i.path.join("."))));
      const badSrc = materialShipmentSchema.safeParse({
        ...base, source_farmer_id: "0",
        items: [{ farmer_id: String(fB.id), item_kind: "packaging", packaging_type_id: String(boxType.id), quantity: "10" }],
      });
      console.log("  source<=0:           ", badSrc.success ? "FAIL" : "OK (zod-ошибка)");
      const okTransfer = materialShipmentSchema.safeParse({
        ...base, source_farmer_id: String(fA.id),
        items: [
          { farmer_id: String(fB.id), item_kind: "packaging", packaging_type_id: String(boxType.id), quantity: "10" },
          { farmer_id: String(fB.id), item_kind: "ingredient", ingredient_id: String(ing.id), quantity: "5" },
        ],
      });
      console.log("  смешанный transfer:  ", okTransfer.success ? "OK (схема валидна)" : "FAIL — " + JSON.stringify(okTransfer.error.issues));

      // источник архивный → перенос разрешён (схема не смотрит active; resolveTransferSource — findUnique без active-фильтра)
      const arch = await tx.farmer.create({ data: { name: "Архивный (тест)", active: false } });
      const found = await tx.farmer.findUnique({ where: { id: arch.id }, select: { id: true, active: true } });
      const archParse = materialShipmentSchema.safeParse({
        ...base, source_farmer_id: String(arch.id),
        items: [{ farmer_id: String(fB.id), item_kind: "packaging", packaging_type_id: String(boxType.id), quantity: "10" }],
      });
      console.log("  источник архивный:   ", found && !found.active && archParse.success ? "OK (перенос ОТ архивного разрешён)" : "FAIL");

      // D-mixed: реальные плечи смешанного transfer по kind
      console.log("\n  -- смешанный transfer: плечи по kind (transit=-3 для обоих) --");
      const tD = await tx.materialShipment.create({
        data: {
          code: "T1-D", departure_date: new Date(), arrival_date: new Date(), status: "planned", driver_id: driver.id,
          source_farmer_id: fA.id,
          items: { create: [
            { farmer_id: fB.id, item_kind: "packaging", packaging_type_id: boxType.id, quantity: "40" },
            { farmer_id: fB.id, item_kind: "ingredient", ingredient_id: ing.id, quantity: "5" },
          ] },
        },
        include: { items: true },
      });
      const ctxD = legContext(tD);
      const locsD = [{ label: `A#${fA.id}`, id: fA.id }, { label: "транз-3", id: -3 }, { label: `B#${fB.id}`, id: fB.id }];
      await applyOutboundDeliveryLeg(tx, tD.items, tD.id, new Date(), ctxD);
      for (const it of tD.items) await applyArrivedLegForItem(tx, it, tD.id, new Date(), ctxD);
      console.log("    ящики:", fmt(await balances(tx, tD.id, box), locsD), "(ожид. A=-40 · транз-3=0 · B=+40)");
      console.log("    ингр.:", fmt(await balances(tx, tD.id, ingRef), locsD), "(ожид. A=-5 · транз-3=0 · B=+5)");

      console.log("\nE. RBAC: send/markAll/markItem=admin|operator, unmark*/revert=admin — requireRole в actions.ts не менялся.");

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
