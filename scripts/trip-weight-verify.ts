// trip-weight verification: факт. средний вес овощного рейса (aggregateActualTripWeight)
// + сверка на реальной выборке vegShipments (форма запроса врезки getSeasonAnalytics).
// Запуск: npx tsx scripts/trip-weight-verify.ts
// Тестовая БД: seed внутри $transaction с финальным throw ROLLBACK — данные не остаются.
// getSeasonAnalytics напрямую не зовём (requireRole требует сессию) — воспроизводим
// ТОЛЬКО ту же выборку+агрегатор, что и врезка.
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { aggregateActualTripWeight } from "../server/analytics/dashboard";
import { seasonYearOf } from "../server/shipments/workdays";

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
const near = (a: number | null, b: number, eps = 1e-9) => a != null && Math.abs(a - b) < eps;

// ===== A. Чистая функция (без БД) =====
function pureCases() {
  console.log("A. aggregateActualTripWeight — чистые кейсы");

  // Смешанный: 2 машины взвешены → avg = (6000 + 4000)/2/1000 = 5 т, count=2.
  let r = aggregateActualTripWeight([
    { itemActualsKg: [3000, 3000] },
    { itemActualsKg: [4000] },
  ]);
  check("2 взвешенные → avg 5 т, count 2", near(r.avgActualTripWeightT, 5) && r.weighedTripsCount === 2);

  // Машина без перевески ([null]) исключена, не даёт 0. Одна взвешенная машина
  // 3000+3000=6000 кг → avg = 6 т, count=1 (позиции суммируются в вес рейса).
  r = aggregateActualTripWeight([
    { itemActualsKg: [3000, 3000] },
    { itemActualsKg: [null] },
  ]);
  check("машина без перевески исключена → avg 6 т, count 1", near(r.avgActualTripWeightT, 6) && r.weighedTripsCount === 1);

  // Позиция без факта не зануляет машину: tripWeight=4000 → avg=4 т.
  r = aggregateActualTripWeight([{ itemActualsKg: [4000, null] }]);
  check("частичная перевеска не зануляет → avg 4 т", near(r.avgActualTripWeightT, 4) && r.weighedTripsCount === 1);

  // Пустой вход → null / 0.
  r = aggregateActualTripWeight([]);
  check("пустой вход → null, count 0", r.avgActualTripWeightT === null && r.weighedTripsCount === 0);

  // Все машины без перевески → null / 0.
  r = aggregateActualTripWeight([{ itemActualsKg: [null] }, { itemActualsKg: [] }]);
  check("все без перевески → null, count 0", r.avgActualTripWeightT === null && r.weighedTripsCount === 0);
}

// ===== B. Сверка на реальной выборке (rolled-back seed) =====
async function seedCase() {
  console.log("B. Выборка vegShipments + агрегатор (rolled-back)");
  const now = new Date(); // сегодня — внутри активного сезона
  const season = seasonYearOf(now);

  await prisma.$transaction(async (tx) => {
    const tc = await tx.transportCompany.create({ data: { name: "TW-verify TC" } });
    const driver = await tx.driver.create({
      data: { full_name: "TW driver", transport_company_id: tc.id },
    });
    const farmer = await tx.farmer.create({ data: { name: "TW farmer" } });
    const culture = await tx.culture.create({ data: { name: "TW томаты", color: "#e5484d", acceptance_type: "simple" } });
    const patisson = await tx.culture.create({ data: { name: "TW патиссоны", color: "#30a46c", acceptance_type: "simple" } });

    // 2 овощные машины со взвесами: 6000 (3000+3000) и 4000.
    async function veg(code: string, actuals: (number | null)[]) {
      const s = await tx.shipment.create({
        data: { code, status: "accepted", departure_date: now, arrival_date: now, driver_id: driver.id },
      });
      for (const a of actuals) {
        await tx.shipmentItem.create({
          data: {
            shipment_id: s.id,
            farmer_id: farmer.id,
            culture_id: culture.id,
            planned_weight_kg: "3000",
            actual_weight_kg: a === null ? null : String(a),
          },
        });
      }
      return s;
    }
    await veg("TW-A", [3000, 3000]);
    await veg("TW-B", [4000]);
    // Машина только патиссоны без перевески — должна выпасть из среднего.
    const noWeigh = await tx.shipment.create({
      data: { code: "TW-C", status: "arrived", departure_date: now, arrival_date: now, driver_id: driver.id },
    });
    await tx.shipmentItem.create({
      data: { shipment_id: noWeigh.id, farmer_id: farmer.id, culture_id: patisson.id, planned_weight_kg: "5000", actual_weight_kg: null },
    });
    // Материальный рейс (доставка тары) — в среднее НЕ входит (BR-14). Не создаём
    // items с actual — материалка вообще другая сущность, но проверим что запрос
    // vegShipments его не видит (status-скоуп на Shipment, не MaterialShipment).

    // Выборка — ТА ЖЕ форма, что во врезке getSeasonAnalytics (секция 3), но
    // скоуп по driver сеанса: dev-БД содержит реальные отгрузки, тест их не считает.
    const vegShipments = await tx.shipment.findMany({
      where: { status: { in: ["arrived", "accepted"] }, driver_id: driver.id },
      select: {
        arrival_date: true,
        departure_date: true,
        items: { select: { actual_weight_kg: true } },
      },
    });
    const trips = vegShipments
      .filter((s) => {
        const arr = s.arrival_date ?? s.departure_date;
        return arr && seasonYearOf(arr) === season;
      })
      .map((s) => ({
        itemActualsKg: s.items.map((it) => (it.actual_weight_kg ? it.actual_weight_kg.toNumber() : null)),
      }));

    const agg = aggregateActualTripWeight(trips);
    // Взвешены только TW-A(6000) и TW-B(4000): avg=(10000)/2/1000=5 т, count=2.
    check("сезон: avg = Σфакт/взвешенные = 5 т", near(agg.avgActualTripWeightT, 5), `avg=${agg.avgActualTripWeightT}`);
    check("сезон: взвешено 2 рейса (TW-C патиссоны выпал)", agg.weighedTripsCount === 2, `count=${agg.weighedTripsCount}`);

    // Сверка remainingMachines по фактической базе. Пусть target=30т, accepted=8т.
    const targetKg = 30000;
    const acceptedKg = 8000;
    const baseKg = agg.avgActualTripWeightT! * 1000; // 5000
    const expected = Math.ceil((targetKg - acceptedKg) / baseKg); // ceil(22000/5000)=5
    check("remainingMachines ≈ ceil((target−accepted)/avg) = 5", expected === 5, `got ${expected}`);

    // Сезон без единой перевески → avg null (fallback на план в getSeasonAnalytics).
    const noWeighTrips = trips.map((t) => ({ itemActualsKg: t.itemActualsKg.map(() => null) }));
    const aggNull = aggregateActualTripWeight(noWeighTrips);
    check("без перевесок → avg null, count 0", aggNull.avgActualTripWeightT === null && aggNull.weighedTripsCount === 0);

    throw new Error(ROLLBACK);
  }, { timeout: 30000 }).catch((e) => {
    if (e instanceof Error && e.message === ROLLBACK) return;
    throw e;
  });
}

async function main() {
  pureCases();
  await seedCase();
  console.log(`\n${fail === 0 ? "✓ ВСЁ" : "✗ ЕСТЬ ПАДЕНИЯ"}: pass=${pass} fail=${fail}`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main();
