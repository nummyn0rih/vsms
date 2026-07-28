// settlement-adjustment verification (BR-33): корректировка расчёта с поставщиком.
// Запуск: npx tsx scripts/settlement-verify.ts
// Тестовая БД: seed внутри $transaction с финальным throw ROLLBACK — данные не остаются.
// getContractExecution напрямую не зовём (requireRole требует сессию) — воспроизводим
// ТУ ЖЕ выборку + те же чистые функции (itemCost / attribute*ToLines / lineExecution).
import "dotenv/config";
import { Prisma } from "../lib/generated/prisma/client";
import { prisma } from "../lib/prisma";
import {
  computeAcceptedKg,
  computeSettlement,
  computeWeightedBrak,
} from "../server/acceptance/accepted";
import {
  itemCost,
  attributeAcceptedToLines,
  attributeSurchargeToLines,
  lineExecution,
  type ExecItem,
} from "../server/contracts/execution";
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

// Эталон из спеки: огурцы, факт 6850 кг, 6–9 см 53,7% · 9–12 см 34,5% (принятые),
// >12 нестандарт 10,4%, брак 1,4%. Договорённость — 97% от факта.
const ACTUAL = 6850;
const P_69 = 53.7;
const P_912 = 34.5;
const P_NS = 10.4;
const BRAK = 1.4;
const SETTLEMENT = 97;
const PRICE_69 = 30; // ₽/кг строки 6–9
const PRICE_912 = 20; // ₽/кг строки 9–12

// ===== A. Чистые кейсы (без БД) =====
function pureCases() {
  console.log("A. computeSettlement — чистые кейсы");

  const calibres = [
    { percent: P_69, isAccepted: true, contractLineId: 101 },
    { percent: P_912, isAccepted: true, contractLineId: 102 },
    { percent: P_NS, isAccepted: false, contractLineId: null },
  ];
  const acceptedKg = computeAcceptedKg(ACTUAL, BRAK, calibres);
  check("эталон: принятый вес 6041,7 кг", near(acceptedKg, 6041.7, 1e-9), String(acceptedKg));

  const s = computeSettlement({
    actualKg: ACTUAL,
    acceptedKg,
    settlementPercent: SETTLEMENT,
    itemLineId: 101,
    calibres,
  });
  check("эталон: доплата 602,8 кг", near(s.surchargeKg, 602.8, 1e-9), String(s.surchargeKg));
  check("эталон: к оплате 6644,5 кг", near(s.paidKg, 6644.5, 1e-9), String(s.paidKg));
  check(
    "эталон: разнос 367,0 кг на строку 6–9",
    near(s.allocation.find((a) => a.contractLineId === 101)?.kg ?? null, 367.0, 0.05),
    String(s.allocation.find((a) => a.contractLineId === 101)?.kg),
  );
  check(
    "эталон: разнос 235,8 кг на строку 9–12",
    near(s.allocation.find((a) => a.contractLineId === 102)?.kg ?? null, 235.8, 0.05),
    String(s.allocation.find((a) => a.contractLineId === 102)?.kg),
  );
  check(
    "разнос в сумме = доплате (ничего не потеряно)",
    near(s.allocation.reduce((acc, a) => acc + a.kg, 0), s.surchargeKg, 1e-9),
  );
  check(
    "нестандарт без строки доплату НЕ получает",
    s.allocation.every((a) => a.contractLineId !== null) && s.allocation.length === 2,
  );

  // null → полный паритет с поведением до BR-33.
  const none = computeSettlement({
    actualKg: ACTUAL,
    acceptedKg,
    settlementPercent: null,
    itemLineId: 101,
    calibres,
  });
  check(
    "settlementPercent=null → доплаты нет, к оплате = принятый",
    none.surchargeKg === 0 && near(none.paidKg, acceptedKg!, 1e-9) && none.allocation.length === 0,
  );

  // simple: брак 5%, договорённость 97% → доплата на строку позиции.
  const simpleAccepted = computeAcceptedKg(10000, 5, []);
  const simple = computeSettlement({
    actualKg: 10000,
    acceptedKg: simpleAccepted,
    settlementPercent: 97,
    itemLineId: 55,
    calibres: [],
  });
  check(
    "simple: доплата 200 кг (97 − 95) на строку позиции",
    near(simple.surchargeKg, 200, 1e-9) &&
      simple.allocation.length === 1 &&
      simple.allocation[0].contractLineId === 55 &&
      near(simple.allocation[0].kg, 200, 1e-9),
  );

  // Защита от деления на ноль: принятых категорий нет (Σ percent принятых = 0).
  const zeroDen = computeSettlement({
    actualKg: 10000,
    acceptedKg: 0,
    settlementPercent: 97,
    itemLineId: null,
    calibres: [{ percent: 100, isAccepted: false, contractLineId: null }],
  });
  check(
    "Σ принятых = 0 → доплата 0, без падения",
    zeroDen.surchargeKg === 0 && zeroDen.allocation.length === 0 && zeroDen.paidKg === 0,
  );

  // Договорённость не выше принятого% — доплаты нет (расчёт деградирует безопасно).
  const below = computeSettlement({
    actualKg: ACTUAL,
    acceptedKg,
    settlementPercent: 80,
    itemLineId: 101,
    calibres,
  });
  check("settlement ниже принятого% → доплата 0", below.surchargeKg === 0);
}

// ===== B. Сид + выборка execution (rolled-back) =====
async function seedCase() {
  console.log("\nB. Выполнение (тонны) vs стоимость (деньги) на данных БД (rolled-back)");
  const season = seasonYearOf(W);

  await prisma.$transaction(async (tx) => {
    const tc = await tx.transportCompany.create({ data: { name: "SET-verify TC" } });
    const driver = await tx.driver.create({
      data: { full_name: "SET driver", transport_company_id: tc.id },
    });
    const farmer = await tx.farmer.create({ data: { name: "SET farmer" } });
    const culture = await tx.culture.create({
      data: { name: "SET огурцы", color: "#2F9E44", acceptance_type: "calibre" },
    });
    const scheme = await tx.calibreScheme.create({ data: { culture_id: culture.id } });
    const r69 = await tx.calibreRange.create({
      data: { scheme_id: scheme.id, label: "6–9", min_cm: "6", max_cm: "9", is_accepted: true },
    });
    const r912 = await tx.calibreRange.create({
      data: { scheme_id: scheme.id, label: "9–12", min_cm: "9", max_cm: "12", is_accepted: true },
    });
    const rNs = await tx.calibreRange.create({
      data: { scheme_id: scheme.id, label: ">12", min_cm: "12", is_accepted: false },
    });

    const contract = await tx.contract.create({
      data: { farmer_id: farmer.id, season_year: season },
    });
    const line69 = await tx.contractLine.create({
      data: {
        contract_id: contract.id,
        culture_id: culture.id,
        label: "6–9 см",
        volume_tons: "10",
        price_per_kg: String(PRICE_69),
      },
    });
    const line912 = await tx.contractLine.create({
      data: {
        contract_id: contract.id,
        culture_id: culture.id,
        label: "9–12 см",
        volume_tons: "10",
        price_per_kg: String(PRICE_912),
      },
    });

    const shipment = await tx.shipment.create({
      data: {
        code: "SET-A",
        status: "accepted",
        departure_date: W,
        arrival_date: W,
        driver_id: driver.id,
      },
    });
    const item = await tx.shipmentItem.create({
      data: {
        shipment_id: shipment.id,
        farmer_id: farmer.id,
        culture_id: culture.id,
        planned_weight_kg: String(ACTUAL),
        actual_weight_kg: String(ACTUAL),
        contract_line_id: line69.id,
      },
    });
    const act = await tx.acceptanceAct.create({
      data: {
        shipment_item_id: item.id,
        act_number: `${season}-SET-A`,
        brak_percent: String(BRAK),
      },
    });
    await tx.calibreResult.createMany({
      data: [
        { acceptance_act_id: act.id, calibre_range_id: r69.id, percent: String(P_69), contract_line_id: line69.id },
        { acceptance_act_id: act.id, calibre_range_id: r912.id, percent: String(P_912), contract_line_id: line912.id },
        { acceptance_act_id: act.id, calibre_range_id: rNs.id, percent: String(P_NS), contract_line_id: null },
      ],
    });

    // ТА ЖЕ форма выборки, что в getContractExecution (секции 2–4).
    async function loadExec(): Promise<ExecItem[]> {
      const rows = await tx.shipmentItem.findMany({
        where: { farmer_id: farmer.id, acceptanceAct: { isNot: null } },
        select: {
          actual_weight_kg: true,
          contract_line_id: true,
          acceptanceAct: {
            select: {
              brak_percent: true,
              settlement_percent: true,
              calibreResults: {
                select: {
                  percent: true,
                  contract_line_id: true,
                  calibreRange: { select: { is_accepted: true } },
                },
              },
            },
          },
        },
      });
      return rows.map((it) => ({
        actualKg: it.actual_weight_kg,
        brakPercent: it.acceptanceAct!.brak_percent?.toNumber() ?? null,
        contractLineId: it.contract_line_id,
        settlementPercent: it.acceptanceAct!.settlement_percent?.toNumber() ?? null,
        calibres: it.acceptanceAct!.calibreResults.map((cr) => ({
          percent: cr.percent.toNumber(),
          isAccepted: cr.calibreRange.is_accepted,
          contractLineId: cr.contract_line_id,
        })),
      }));
    }

    const lines = [
      { id: line69.id, volumeTons: new Prisma.Decimal(10), price: new Prisma.Decimal(PRICE_69) },
      { id: line912.id, volumeTons: new Prisma.Decimal(10), price: new Prisma.Decimal(PRICE_912) },
    ];
    const lineMap = new Map(lines.map((l) => [l.id, l.price]));

    function run(items: ExecItem[]) {
      const accepted = attributeAcceptedToLines(items);
      const surcharge = attributeSurchargeToLines(items);
      const rows = lines.map((l) =>
        lineExecution(
          { volumeTons: l.volumeTons, price: l.price },
          accepted.get(l.id) ?? new Prisma.Decimal(0),
          surcharge.get(l.id) ?? new Prisma.Decimal(0),
        ),
      );
      const cost = items.reduce(
        (s, i) => s.add(itemCost(i, lineMap).cost),
        new Prisma.Decimal(0),
      );
      const missing = items.some((i) => itemCost(i, lineMap).missingLine);
      return { rows, cost, missing, quality: items };
    }

    // --- Прогон 1: БЕЗ корректировки (settlement_percent = null) ---
    const before = run(await loadExec());

    // --- Прогон 2: С корректировкой 97% ---
    await tx.acceptanceAct.update({
      where: { id: act.id },
      data: { settlement_percent: String(SETTLEMENT) },
    });
    const after = run(await loadExec());

    // 1) Тонны выполнения и % — не изменились.
    check(
      "выполнение строки 6–9 не изменилось (тонны)",
      before.rows[0].acceptedKg.equals(after.rows[0].acceptedKg) &&
        before.rows[0].pct.equals(after.rows[0].pct) &&
        before.rows[0].remainingKg.equals(after.rows[0].remainingKg),
      `${before.rows[0].acceptedKg} → ${after.rows[0].acceptedKg}`,
    );
    check(
      "выполнение строки 9–12 не изменилось (тонны)",
      before.rows[1].acceptedKg.equals(after.rows[1].acceptedKg) &&
        before.rows[1].pct.equals(after.rows[1].pct),
    );
    check(
      "принятый вес строк = actual × percent (3678,45 / 2363,25 кг)",
      near(before.rows[0].acceptedKg.toNumber(), (ACTUAL * P_69) / 100, 1e-9) &&
        near(before.rows[1].acceptedKg.toNumber(), (ACTUAL * P_912) / 100, 1e-9),
    );

    // 2) Доплата легла в оплачиваемый вес строк.
    check(
      "доплата разнесена: 367,0 кг на 6–9, 235,8 кг на 9–12",
      near(after.rows[0].surchargeKg.toNumber(), 367.0, 0.05) &&
        near(after.rows[1].surchargeKg.toNumber(), 235.8, 0.05),
      `${after.rows[0].surchargeKg} / ${after.rows[1].surchargeKg}`,
    );
    check(
      "paidKg = acceptedKg + доплата",
      after.rows[0].paidKg.equals(after.rows[0].acceptedKg.add(after.rows[0].surchargeKg)) &&
        after.rows[1].paidKg.equals(after.rows[1].acceptedKg.add(after.rows[1].surchargeKg)),
    );
    check(
      "Σ доплаты по строкам = 602,8 кг",
      near(
        after.rows[0].surchargeKg.add(after.rows[1].surchargeKg).toNumber(),
        602.8,
        1e-9,
      ),
    );

    // 3) Стоимость выросла ровно на разнесённую доплату × цены строк.
    const expectedDelta =
      after.rows[0].surchargeKg.mul(PRICE_69).add(after.rows[1].surchargeKg.mul(PRICE_912));
    check(
      "стоимость выросла ровно на доплату × цены строк",
      after.cost.sub(before.cost).equals(expectedDelta),
      `Δ=${after.cost.sub(before.cost)} ожидалось ${expectedDelta}`,
    );
    check(
      "стоимость строк = paidKg × price",
      after.rows[0].cost.equals(after.rows[0].paidKg.mul(PRICE_69)) &&
        after.rows[1].cost.equals(after.rows[1].paidKg.mul(PRICE_912)),
    );
    check(
      "itemCost = Σ стоимости строк (одно число сверху и снизу)",
      after.cost.equals(after.rows[0].cost.add(after.rows[1].cost)),
      `${after.cost} vs ${after.rows[0].cost.add(after.rows[1].cost)}`,
    );
    check("доплата не создала «строку без цены»", !before.missing && !after.missing);

    // 4) Регресс: до корректировки стоимость = принятый × цена (как до BR-33).
    check(
      "без корректировки стоимость = принятый × цена (регресса нет)",
      before.cost.equals(
        before.rows[0].acceptedKg.mul(PRICE_69).add(before.rows[1].acceptedKg.mul(PRICE_912)),
      ) && before.rows[0].surchargeKg.isZero(),
    );

    // 5) Аналитика качества идентична (проценты категорий, брак, принятый вес).
    const q = (items: ExecItem[]) => ({
      brak: computeWeightedBrak(
        items.map((i) => ({
          actualKg: i.actualKg?.toNumber() ?? 0,
          brakPercent: i.brakPercent ?? 0,
        })),
      ),
      accepted: computeAcceptedKg(
        items[0].actualKg?.toNumber() ?? null,
        items[0].brakPercent,
        items[0].calibres,
      ),
      percents: items[0].calibres.map((c) => `${c.percent}:${c.isAccepted}`).join("|"),
    });
    const qb = q(before.quality);
    const qa = q(after.quality);
    check(
      "качество не изменилось: % брака, % категорий, принятый вес",
      qb.brak === qa.brak && qb.percents === qa.percents && qb.accepted === qa.accepted,
      `${JSON.stringify(qb)} vs ${JSON.stringify(qa)}`,
    );
    check("принятый вес позиции остался 6041,7 кг", near(qa.accepted, 6041.7, 1e-9));

    throw new Error(ROLLBACK);
    // Neon (pooled) просыпается медленно — даём запас на старт транзакции.
  }, { maxWait: 30000, timeout: 60000 }).catch((e) => {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
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
