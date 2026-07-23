// culture-analytics verification: агрегатор профиля культуры (aggregateCultureItems)
// + сверка на реальной выборке (форма запроса getCultureAnalytics, секция 1).
// Запуск: npx tsx scripts/culture-analytics-verify.ts
// Тестовая БД: seed внутри $transaction с финальным throw ROLLBACK — данные не остаются.
// getCultureAnalytics напрямую не зовём (requireRole требует сессию) — воспроизводим
// ТОЛЬКО ту же выборку + агрегатор.
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { aggregateCultureItems, type CultureItem } from "../server/analytics/culture";
import { calibreRangeLabel } from "../server/acceptance/accepted";
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
const near = (a: number | null, b: number, eps = 1e-6) =>
  a != null && Math.abs(a - b) < eps;

const W = new Date("2026-07-15T00:00:00Z"); // среда, ISO-неделя 29
const W_NEXT = new Date("2026-07-22T00:00:00Z"); // среда, ISO-неделя 30

function item(p: Partial<CultureItem> & { actualKg: number | null }): CultureItem {
  return {
    shipmentId: p.shipmentId ?? 1,
    farmerId: p.farmerId ?? 1,
    farmerName: p.farmerName ?? "Ф1",
    arrival: p.arrival ?? W,
    actualKg: p.actualKg,
    brakPercent: p.brakPercent ?? null,
    calibres: p.calibres ?? [],
  };
}

// ===== A. Чистые кейсы (без БД) =====
function pureCases() {
  console.log("A. aggregateCultureItems — чистые кейсы");

  // simple: 10000 кг брак 5% + 5000 кг брак 10% →
  // accepted = 9500 + 4500 = 14000 кг; брак = (10000×5 + 5000×10)/15000 = 6,666…%
  let a = aggregateCultureItems([
    item({ actualKg: 10000, brakPercent: 5 }),
    item({ actualKg: 5000, brakPercent: 10, shipmentId: 2 }),
  ]);
  check("simple: принято 14 т", near(a.acceptedKgTotal, 14000));
  check(
    "simple: брак взвешен по факту (6,667%)",
    near(a.avgBrakPct, (10000 * 5 + 5000 * 10) / 15000),
  );
  check("рейсы считаются по distinct shipment_id", a.tripsCount === 2 && a.positionsCount === 2);

  // доли поставщиков: 12000 и 4000 → 75% / 25%, сумма 100
  a = aggregateCultureItems([
    item({ actualKg: 12000, farmerId: 1, farmerName: "Ф1" }),
    item({ actualKg: 4000, farmerId: 2, farmerName: "Ф2", shipmentId: 2 }),
  ]);
  check(
    "доли поставщиков 75/25, Σ = 100%",
    near(a.bySupplier[0].sharePct, 75) &&
      near(a.bySupplier[1].sharePct, 25) &&
      near(a.bySupplier.reduce((s, r) => s + r.sharePct, 0), 100),
  );
  check("сортировка по принятому убыв.", a.bySupplier[0].farmerId === 1);
  check("фермеров — 2", a.farmersCount === 2);

  // недели: две недели прибытия → две точки, брак по неделе отдельно
  a = aggregateCultureItems([
    item({ actualKg: 10000, brakPercent: 4, arrival: W }),
    item({ actualKg: 10000, brakPercent: 8, arrival: W_NEXT, shipmentId: 2 }),
  ]);
  check("две недели → две точки динамики", a.weekTons.size === 2 && a.weekBrakPct.size === 2);
  check(
    "брак по неделе не смешивается (4% и 8%)",
    near(a.weekBrakPct.get("2026-29")!.pct, 4) && near(a.weekBrakPct.get("2026-30")!.pct, 8),
  );

  // calibre: 10000 кг, 60% станд. + 30% мелкий (в зачёт) + 10% не в зачёт
  a = aggregateCultureItems([
    item({
      actualKg: 10000,
      calibres: [
        { label: "станд.", isAccepted: true, percent: 60 },
        { label: "мелкий", isAccepted: true, percent: 30 },
        { label: "не в зачёт", isAccepted: false, percent: 10 },
      ],
    }),
  ]);
  check("calibre: принято = actual × Σ принятых % = 9 т", near(a.acceptedKgTotal, 9000));
  check(
    "calibre: доли 60/30/10, Σ = 100%",
    near(a.calibre[0].pct, 60) &&
      near(a.calibre[1].pct, 30) &&
      near(a.calibre[2].pct, 10) &&
      near(a.calibre.reduce((s, c) => s + c.pct, 0), 100),
  );
  check("calibre: «не в зачёт» — последним", a.calibre[2].isAccepted === false);
  check("calibre: тоннаж категории 6 т", near(a.calibre[0].tons, 6));

  // calibre + брак: категории (50+30+12) + brak 8 = 100. Брак — синтетический ломоть.
  a = aggregateCultureItems([
    item({
      actualKg: 10000,
      brakPercent: 8,
      calibres: [
        { label: "станд.", isAccepted: true, percent: 50 },
        { label: "мелкий", isAccepted: true, percent: 30 },
        { label: "не в зачёт", isAccepted: false, percent: 12 },
      ],
    }),
  ]);
  check("calibre+брак: принято = 80% = 8 т", near(a.acceptedKgTotal, 8000));
  check(
    "calibre+брак: «Брак» добавлен последней категорией, Σ = 100%",
    a.calibre.length === 4 &&
      a.calibre[3].label === "Брак" &&
      a.calibre[3].isAccepted === false &&
      near(a.calibre[3].pct, 8) &&
      near(a.calibre[3].tons, 0.8) &&
      near(a.calibre.reduce((s, c) => s + c.pct, 0), 100),
  );

  // brak = 0 → пустой ломоть НЕ добавляется (регресс-гард)
  a = aggregateCultureItems([
    item({
      actualKg: 10000,
      brakPercent: 0,
      calibres: [{ label: "станд.", isAccepted: true, percent: 100 }],
    }),
  ]);
  check(
    "calibre: brak=0 → категория «Брак» не создаётся",
    a.calibre.length === 1 && a.calibre.every((c) => c.label !== "Брак"),
  );

  // скудный кейс: позиция без перевески — брак «—», принятого нет, ничего не ломается
  a = aggregateCultureItems([item({ actualKg: null })]);
  check(
    "без факт. веса → брак null, принято 0, доля 0",
    a.avgBrakPct === null &&
      a.acceptedKgTotal === 0 &&
      a.bySupplier[0].brakPct === null &&
      a.bySupplier[0].sharePct === 0,
  );

  // пустой вход
  a = aggregateCultureItems([]);
  check(
    "пустой вход → нули/null без падений",
    a.acceptedKgTotal === 0 &&
      a.avgBrakPct === null &&
      a.bySupplier.length === 0 &&
      a.calibre.length === 0 &&
      a.weekTons.size === 0,
  );
}

// ===== B. Сверка на реальной выборке (rolled-back seed) =====
async function seedCase() {
  console.log("B. Выборка позиций культуры + агрегатор (rolled-back)");
  const season = seasonYearOf(W);

  await prisma.$transaction(async (tx) => {
    const tc = await tx.transportCompany.create({ data: { name: "CA-verify TC" } });
    const driver = await tx.driver.create({
      data: { full_name: "CA driver", transport_company_id: tc.id },
    });
    const f1 = await tx.farmer.create({ data: { name: "CA farmer 1" } });
    const f2 = await tx.farmer.create({ data: { name: "CA farmer 2" } });
    const cucumber = await tx.culture.create({
      data: { name: "CA огурцы", color: "#2F9E44", acceptance_type: "calibre" },
    });
    const scheme = await tx.calibreScheme.create({ data: { culture_id: cucumber.id } });
    const rStd = await tx.calibreRange.create({
      data: { scheme_id: scheme.id, label: "стандарт", min_cm: "6", max_cm: "9", is_accepted: true },
    });
    const rOut = await tx.calibreRange.create({
      data: { scheme_id: scheme.id, label: "нестандарт", is_accepted: false },
    });

    async function accepted(
      code: string,
      farmerId: number,
      actualKg: number,
      arrival: Date,
      cats: { rangeId: number; percent: number }[],
    ) {
      const s = await tx.shipment.create({
        data: {
          code,
          status: "accepted",
          departure_date: arrival,
          arrival_date: arrival,
          driver_id: driver.id,
        },
      });
      const it = await tx.shipmentItem.create({
        data: {
          shipment_id: s.id,
          farmer_id: farmerId,
          culture_id: cucumber.id,
          planned_weight_kg: String(actualKg),
          actual_weight_kg: String(actualKg),
        },
      });
      const act = await tx.acceptanceAct.create({
        data: { shipment_item_id: it.id, act_number: `${season}-${code}`, brak_percent: "0" },
      });
      for (const c of cats) {
        await tx.calibreResult.create({
          data: {
            acceptance_act_id: act.id,
            calibre_range_id: c.rangeId,
            percent: String(c.percent),
          },
        });
      }
    }

    // Ф1: 10 т (80% стандарт / 20% нестандарт), Ф2: 5 т (100% стандарт), другая неделя.
    await accepted("CA-A", f1.id, 10000, W, [
      { rangeId: rStd.id, percent: 80 },
      { rangeId: rOut.id, percent: 20 },
    ]);
    await accepted("CA-B", f2.id, 5000, W_NEXT, [{ rangeId: rStd.id, percent: 100 }]);

    // ТА ЖЕ форма выборки, что в getCultureAnalytics (секция 1).
    const rawItems = await tx.shipmentItem.findMany({
      where: { culture_id: cucumber.id, acceptanceAct: { isNot: null } },
      select: {
        shipment_id: true,
        actual_weight_kg: true,
        farmer: { select: { id: true, name: true } },
        shipment: { select: { arrival_date: true, departure_date: true } },
        acceptanceAct: {
          select: {
            brak_percent: true,
            calibreResults: {
              select: {
                percent: true,
                calibreRange: {
                  select: { label: true, min_cm: true, max_cm: true, is_accepted: true },
                },
              },
            },
          },
        },
      },
    });

    const items: CultureItem[] = rawItems
      .filter((it) => {
        const d = it.shipment.arrival_date ?? it.shipment.departure_date;
        return d && seasonYearOf(d) === season;
      })
      .map((it) => ({
        shipmentId: it.shipment_id,
        farmerId: it.farmer.id,
        farmerName: it.farmer.name,
        arrival: it.shipment.arrival_date,
        actualKg: it.actual_weight_kg ? it.actual_weight_kg.toNumber() : null,
        brakPercent: it.acceptanceAct!.brak_percent
          ? it.acceptanceAct!.brak_percent.toNumber()
          : null,
        calibres: it.acceptanceAct!.calibreResults.map((cr) => ({
          label: calibreRangeLabel(
            cr.calibreRange.min_cm ? cr.calibreRange.min_cm.toNumber() : null,
            cr.calibreRange.max_cm ? cr.calibreRange.max_cm.toNumber() : null,
            cr.calibreRange.label,
          ),
          isAccepted: cr.calibreRange.is_accepted,
          percent: cr.percent.toNumber(),
        })),
      }));

    check("выборка вернула 2 позиции", items.length === 2, `got ${items.length}`);

    const a = aggregateCultureItems(items);
    // принято = 10000×0,8 + 5000×1 = 13000 кг
    check("принято 13 т (calibre-формула)", near(a.acceptedKgTotal, 13000));
    // доли: 8000/13000 = 61,538%, 5000/13000 = 38,461%
    check(
      "Σ долей поставщиков = 100%",
      near(a.bySupplier.reduce((s, r) => s + r.sharePct, 0), 100),
    );
    check(
      "Σ принятого по поставщикам = KPI «Принято»",
      near(a.bySupplier.reduce((s, r) => s + r.acceptedKg, 0), a.acceptedKgTotal),
    );
    // категории от Σ факт. веса 15000: стандарт (8000+5000)/15000 = 86,667%, нестанд. 13,333%
    check(
      "доли калибра 86,7 / 13,3 · Σ = 100%",
      near(a.calibre[0].pct, ((8000 + 5000) / 15000) * 100) &&
        near(a.calibre[1].pct, (2000 / 15000) * 100) &&
        near(a.calibre.reduce((s, c) => s + c.pct, 0), 100),
    );
    check("подпись размерной категории «6–9 см»", a.calibre[0].label === "6–9 см");
    check("брак 0% (акты без брака, но с весом)", near(a.avgBrakPct, 0));
    check("две недели прибытия", a.weekTons.size === 2);

    throw new Error(ROLLBACK);
  }, { maxWait: 30_000, timeout: 60_000 }).catch((e: unknown) => {
    if (e instanceof Error && e.message === ROLLBACK) {
      console.log("  ↩ транзакция откатана (данные не остались)");
      return;
    }
    throw e;
  });
}

async function main() {
  pureCases();
  await seedCase();
  console.log(`\nИтого: ${pass} ok, ${fail} fail`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
