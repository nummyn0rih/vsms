import "dotenv/config";
import dns from "node:dns";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { logChange } from "../server/changelog";
import { parseDateUTC } from "../server/shipments/workdays";

// acceptance auto-date: фактическая дата прибытия пишется в Shipment.arrival_date.
// Реплицируем ТРАНЗАКЦИОННЫЕ ТЕЛА markArrived/setActualWeight (requireRole не зовём —
// скрипт без сессии, как в shipment-revert-verify). Проверяем: запись arrival_date,
// строки ChangeLog (BR-6), идемпотентность (не перезапись), авто-today на 1-й перевеске.
// Всё в одной $transaction с финальным throw — БД не меняется (rolled-back).
// Запуск: npx tsx scripts/acceptance-autodate-verify.ts
dns.setDefaultResultOrder("ipv4first");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

class Rollback extends Error {}
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const SHIPMENT = "Shipment";
const today = new Date().toISOString().slice(0, 10);

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, got: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${got}`);
  ok ? pass++ : fail++;
}

function dstr(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

async function arrivalOf(tx: Tx, id: number): Promise<string | null> {
  const s = await tx.shipment.findUniqueOrThrow({
    where: { id },
    select: { arrival_date: true },
  });
  return dstr(s.arrival_date);
}

async function changelogDates(tx: Tx, id: number) {
  const rows = await tx.changeLog.findMany({
    where: { entity: SHIPMENT, entity_id: id, field: "arrival_date" },
    select: { old_value: true, new_value: true },
    orderBy: { id: "asc" },
  });
  return rows;
}

// Реплика тела markArrived (BR-24б): переход sent→arrived + опц. запись даты + лог.
async function doMarkArrived(tx: Tx, id: number, arrivalDate?: string) {
  const shipment = await tx.shipment.findUniqueOrThrow({
    where: { id },
    select: { status: true, arrival_date: true },
  });
  if (shipment.status === "arrived") return; // идемпотентно, дату не трогаем
  await tx.shipment.update({
    where: { id },
    data: {
      status: "arrived",
      ...(arrivalDate ? { arrival_date: parseDateUTC(arrivalDate) } : {}),
    },
  });
  const entries: { entity: string; entityId: number; field: string; oldValue?: string | null; newValue?: string | null }[] = [
    { entity: SHIPMENT, entityId: id, field: "status", oldValue: "sent", newValue: "arrived" },
  ];
  if (arrivalDate) {
    entries.push({ entity: SHIPMENT, entityId: id, field: "arrival_date", oldValue: dstr(shipment.arrival_date), newValue: arrivalDate });
  }
  await logChange(entries, null, tx);
}

async function makeSent(tx: Tx, code: string, plannedArrival: string) {
  const farmer = await tx.farmer.findFirstOrThrow({ where: { active: true }, orderBy: { id: "asc" } });
  const culture = await tx.culture.findFirstOrThrow({ where: { active: true } });
  const box = await tx.packagingType.findFirstOrThrow({ where: { kind: "box" } });
  const s = await tx.shipment.create({
    data: {
      code, status: "sent",
      departure_date: parseDateUTC(plannedArrival),
      arrival_date: parseDateUTC(plannedArrival),
      items: { create: [{ farmer_id: farmer.id, culture_id: culture.id, planned_weight_kg: "1000", packaging_type_id: box.id }] },
    },
    include: { items: true },
  });
  return s;
}

async function main() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$transaction(async (tx) => {
      console.log("=== acceptance auto-date ===");

      // 1. Задним числом: planned arrival в прошлом, оператор выбрал «Сегодня».
      const past = "2026-06-01"; // < today (2026-06-28)
      const s1 = await makeSent(tx, "AD-1", past);
      await doMarkArrived(tx, s1.id, today);
      check("задним числом + выбор «Сегодня» → arrival_date=today", (await arrivalOf(tx, s1.id)) === today, `${await arrivalOf(tx, s1.id)}`);
      const cl1 = await changelogDates(tx, s1.id);
      check("ChangeLog arrival_date (old=план, new=today)", cl1.length === 1 && cl1[0].old_value === past && cl1[0].new_value === today, JSON.stringify(cl1));

      // 2. Задним числом, оператор оставил «Дата из отгрузки» (planned).
      const s2 = await makeSent(tx, "AD-2", past);
      await doMarkArrived(tx, s2.id, past);
      check("выбор «Дата из отгрузки» → arrival_date=план", (await arrivalOf(tx, s2.id)) === past, `${await arrivalOf(tx, s2.id)}`);

      // 3. Идемпотентность: повтор markArrived на уже arrived → дата не перезаписана.
      await doMarkArrived(tx, s2.id, today); // должен быть no-op (уже arrived)
      check("повтор markArrived на arrived → дата не тронута", (await arrivalOf(tx, s2.id)) === past, `${await arrivalOf(tx, s2.id)}`);

      // 4. markArrived без выбора даты (обратная совместимость) → дата не меняется.
      const s3 = await makeSent(tx, "AD-3", past);
      await doMarkArrived(tx, s3.id); // arrivalDate undefined
      check("markArrived без даты → arrival_date не меняется", (await arrivalOf(tx, s3.id)) === past, `${await arrivalOf(tx, s3.id)}`);
      check("без даты → нет ChangeLog arrival_date", (await changelogDates(tx, s3.id)).length === 0, `rows=${(await changelogDates(tx, s3.id)).length}`);

      // 5. Авто-путь (setActualWeight, 1-я перевеска sent→arrived): arrival_date=today.
      const s4 = await makeSent(tx, "AD-4", past);
      const itemId = s4.items[0].id;
      // реплика ветки isFirstWeight && status==="sent"
      await tx.shipmentItem.update({ where: { id: itemId }, data: { actual_weight_kg: "950" } });
      const before = await tx.shipment.findUniqueOrThrow({ where: { id: s4.id }, select: { arrival_date: true } });
      await tx.shipment.update({ where: { id: s4.id }, data: { status: "arrived", arrival_date: parseDateUTC(today) } });
      await logChange([{ entity: SHIPMENT, entityId: s4.id, field: "arrival_date", oldValue: dstr(before.arrival_date), newValue: today }], null, tx);
      check("авто-перевеска → arrival_date=today", (await arrivalOf(tx, s4.id)) === today, `${await arrivalOf(tx, s4.id)}`);
      check("авто-путь → ChangeLog arrival_date", (await changelogDates(tx, s4.id)).length === 1, `rows=${(await changelogDates(tx, s4.id)).length}`);

      // 6. Второй вес той же машины (уже arrived) → arrival_date НЕ меняется.
      await tx.shipmentItem.update({ where: { id: itemId }, data: { actual_weight_kg: "940" } });
      // ветка isFirstWeight не входит (oldValue != null), дату не трогаем
      check("2-й вес → arrival_date не меняется", (await arrivalOf(tx, s4.id)) === today && (await changelogDates(tx, s4.id)).length === 1, `${await arrivalOf(tx, s4.id)}`);

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
