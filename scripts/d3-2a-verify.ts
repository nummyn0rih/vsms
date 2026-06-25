// D3-2a verification: per-item arrival legs + statusFromItems/derivedStatus.
// Запуск: npx tsx scripts/d3-2a-verify.ts
// Тестовая БД: всё внутри $transaction с финальным throw ROLLBACK — данные не остаются.
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { Prisma } from "../lib/generated/prisma/client";
import {
  applyOutboundDeliveryLeg,
  applyArrivedLegForItem,
  revertArrivedLegForItem,
  revertDeliveryLeg,
} from "../server/materials/movements";
import { FACTORY_LOCATION_ID, TRANSIT_TO_FARMER } from "../server/shipments/packaging";

const ROLLBACK = "ROLLBACK_OK";
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Зеркало приватного statusFromItems из actions.ts.
function statusFromItems(items: { arrived_at: Date | null }[]): "sent" | "arrived" {
  return items.length > 0 && items.every((i) => i.arrived_at != null) ? "arrived" : "sent";
}
// Зеркало derivedStatus из feed-loader.ts.
function derivedStatus(status: string, arrived: number, total: number) {
  return status === "sent" && arrived > 0 && arrived < total ? "partial" : status;
}

async function main() {
  try {
    await prisma.$transaction(async (tx) => {
      // --- seed ---
      const tc = await tx.transportCompany.create({ data: { name: "TC-D32A" } });
      const driver = await tx.driver.create({
        data: { full_name: "D32A driver", transport_company_id: tc.id },
      });
      const f1 = await tx.farmer.create({ data: { name: "D32A farmer1" } });
      const f2 = await tx.farmer.create({ data: { name: "D32A farmer2" } });
      const box = await tx.packagingType.create({ data: { name: "D32A box", kind: "box" } });
      const salt = await tx.ingredient.create({ data: { name: "D32A salt", unit: "kg" } });

      const trip = await tx.materialShipment.create({
        data: {
          code: "D32A-1",
          departure_date: new Date(),
          arrival_date: new Date(),
          status: "planned",
          driver_id: driver.id,
        },
      });
      await tx.materialShipmentItem.createMany({
        data: [
          { material_shipment_id: trip.id, farmer_id: f1.id, item_kind: "packaging", packaging_type_id: box.id, quantity: "300" },
          { material_shipment_id: trip.id, farmer_id: f2.id, item_kind: "ingredient", ingredient_id: salt.id, quantity: "200" },
        ],
      });
      const items = () =>
        tx.materialShipmentItem.findMany({ where: { material_shipment_id: trip.id }, orderBy: { id: "asc" } });
      const its = await items();
      const boxItem = its[0];
      const saltItem = its[1];

      // balance(location, kind, fk[, state]) = Σ(to=loc) − Σ(from=loc) по движениям рейса.
      async function bal(loc: number, kind: "packaging" | "ingredient", fk: number) {
        const ms = await tx.stockMovement.findMany({
          where: {
            source_doc_type: "material_shipment",
            source_doc_id: trip.id,
            kind,
            ...(kind === "packaging" ? { packaging_type_id: fk } : { ingredient_id: fk }),
          },
        });
        let v = new Prisma.Decimal(0);
        for (const m of ms) {
          if (m.to_location_id === loc) v = v.plus(m.quantity);
          if (m.from_location_id === loc) v = v.minus(m.quantity);
        }
        return Number(v);
      }
      const FACT = FACTORY_LOCATION_ID;
      const T = TRANSIT_TO_FARMER;

      // ===== A. РЕГРЕСС (whole-trip) =====
      console.log("A. Регресс полного цикла");
      await applyOutboundDeliveryLeg(tx, its, trip.id, new Date());
      check("send: завод box −300", (await bal(FACT, "packaging", box.id)) === -300);
      check("send: завод salt −200", (await bal(FACT, "ingredient", salt.id)) === -200);
      check("send: транзит box +300", (await bal(T, "packaging", box.id)) === 300);
      check("send: транзит salt +200", (await bal(T, "ingredient", salt.id)) === 200);

      // markAll = цикл applyArrivedLegForItem
      for (const it of its) await applyArrivedLegForItem(tx, it, trip.id, new Date());
      check("markAll: фермер1 box +300", (await bal(f1.id, "packaging", box.id)) === 300);
      check("markAll: фермер2 salt +200", (await bal(f2.id, "ingredient", salt.id)) === 200);
      check("markAll: транзит box 0", (await bal(T, "packaging", box.id)) === 0);
      // повтор → нет дублей (идемпотентность per-item)
      for (const it of its) await applyArrivedLegForItem(tx, it, trip.id, new Date());
      check("markAll повтор: фермер1 box всё ещё +300", (await bal(f1.id, "packaging", box.id)) === 300);
      check("markAll повтор: фермер2 salt всё ещё +200", (await bal(f2.id, "ingredient", salt.id)) === 200);

      // unmarkAll = цикл revertArrivedLegForItem
      for (const it of its) await revertArrivedLegForItem(tx, it, trip.id, new Date());
      check("unmarkAll: фермер1 box 0", (await bal(f1.id, "packaging", box.id)) === 0);
      check("unmarkAll: фермер2 salt 0", (await bal(f2.id, "ingredient", salt.id)) === 0);
      check("unmarkAll: транзит box назад +300", (await bal(T, "packaging", box.id)) === 300);

      // revertToPlanned = сторно отправки
      await revertDeliveryLeg(tx, trip.id, new Date());
      check("revertToPlanned: завод box назад 0", (await bal(FACT, "packaging", box.id)) === 0);
      check("revertToPlanned: транзит box 0", (await bal(T, "packaging", box.id)) === 0);

      // ===== B. ПО-ПОЗИЦИОННО =====
      console.log("B. По-позиционное прибытие");
      await applyOutboundDeliveryLeg(tx, its, trip.id, new Date());
      // markItem(boxItem)
      await applyArrivedLegForItem(tx, boxItem, trip.id, new Date());
      const stateB1 = [{ arrived_at: new Date() }, { arrived_at: null }];
      const arrivedB1 = stateB1.filter((i) => i.arrived_at != null).length;
      check("markItem(box): фермер1 box +300", (await bal(f1.id, "packaging", box.id)) === 300);
      check("markItem(box): salt у фермера2 ещё 0", (await bal(f2.id, "ingredient", salt.id)) === 0);
      check("markItem(box): статус БД sent", statusFromItems(stateB1) === "sent");
      check("markItem(box): derived partial (1/2)", derivedStatus("sent", arrivedB1, 2) === "partial");

      // markItem(saltItem) → arrived
      await applyArrivedLegForItem(tx, saltItem, trip.id, new Date());
      const stateB2 = [{ arrived_at: new Date() }, { arrived_at: new Date() }];
      check("markItem(salt): фермер2 salt +200", (await bal(f2.id, "ingredient", salt.id)) === 200);
      check("markItem(salt): статус arrived", statusFromItems(stateB2) === "arrived");

      // unmarkItem(saltItem) → только его плечо
      await revertArrivedLegForItem(tx, saltItem, trip.id, new Date());
      const stateB3 = [{ arrived_at: new Date() }, { arrived_at: null }];
      const arrivedB3 = stateB3.filter((i) => i.arrived_at != null).length;
      check("unmarkItem(salt): фермер2 salt 0", (await bal(f2.id, "ingredient", salt.id)) === 0);
      check("unmarkItem(salt): фермер1 box не тронут +300", (await bal(f1.id, "packaging", box.id)) === 300);
      check("unmarkItem(salt): статус назад sent", statusFromItems(stateB3) === "sent");
      check("unmarkItem(salt): derived partial (1/2)", derivedStatus("sent", arrivedB3, 2) === "partial");

      // ===== C. ГАРД отката в planned =====
      console.log("C. Гард revertToPlanned");
      const guardWhenPartial = stateB3.some((i) => i.arrived_at != null);
      check("≥1 прибывшая позиция → откат отклонён", guardWhenPartial === true);
      // снять оставшуюся
      await revertArrivedLegForItem(tx, boxItem, trip.id, new Date());
      const stateClean = [{ arrived_at: null }, { arrived_at: null }];
      check("после снятия всех → откат разрешён", stateClean.some((i) => i.arrived_at != null) === false);

      throw new Error(ROLLBACK);
    }, { timeout: 120000, maxWait: 120000 });
  } catch (e) {
    if (!(e instanceof Error && e.message === ROLLBACK)) throw e;
  }

  console.log(`\nИтог: ${pass} ok, ${fail} fail`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main();
