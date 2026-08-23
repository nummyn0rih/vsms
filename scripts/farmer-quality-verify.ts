// farmer-quality verification: вкладка «Качество» карточки поставщика (разрез
// «культуры внутри фермера» с бенчмарком против остальных поставщиков культуры).
// Запуск: npx tsx scripts/farmer-quality-verify.ts
//
// Проверяется НАСТОЯЩИЙ getFarmerQuality — целиком, включая requireRole. Три модуля
// подменяются resolve-хуками Node (стабы в scripts/_stubs): `@/auth` — сессия,
// `next/cache` — ревалидация (вне Next её звать нельзя), `@/lib/prisma` — настоящий
// клиент под Proxy-счётчиком: форма обращений к БД здесь такая же часть контракта, как
// числа (одна общая выборка позиций, а не по выборке на культуру).
//
// Главная сверка — с ПРОФИЛЕМ КУЛЬТУРЫ: «Принято» и «Брак» по культуре обязаны совпасть
// со строкой этого фермера в таблице «По поставщикам» (getCultureAnalytics) число в
// число. Оба экрана считаются одним ядром, и расхождение здесь означает, что ядро
// раздвоилось.
//
// Тестовая БД: данные создаются и удаляются в конце (dev-ветка Neon, данные одноразовые —
// CLAUDE.md). Внутри $transaction провести нельзя: загрузчик ходит в БД своим клиентом.
import "dotenv/config";
import nodeModule from "node:module";
import { pathToFileURL } from "node:url";

// registerHooks — Node 22.15+/24; в @types/node ^20 его ещё нет, отсюда локальный тип.
type ResolveResult = { url: string; shortCircuit?: boolean; format?: string };
type ResolveHook = (
  spec: string,
  context: unknown,
  next: (spec: string, context: unknown) => ResolveResult,
) => ResolveResult;
const registerHooks = (
  nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void }
).registerHooks;

type TestUser = { id: string; role: "admin" | "operator" | "user" };
declare global {
  var __TEST_USER__: TestUser | null;
}
globalThis.__TEST_USER__ = { id: "1", role: "admin" };

const stub = (name: string) =>
  pathToFileURL(new URL(`_stubs/${name}`, import.meta.url).pathname).href;
const STUB_AUTH = stub("auth.ts");
const STUB_CACHE = stub("next-cache.ts");
const STUB_PRISMA = stub("prisma-spy.ts");

registerHooks({
  resolve(spec, context, next) {
    if (spec === "@/auth") return { url: STUB_AUTH, shortCircuit: true, format: "module" };
    if (spec === "next/cache")
      return { url: STUB_CACHE, shortCircuit: true, format: "module" };
    if (spec === "@/lib/prisma")
      return { url: STUB_PRISMA, shortCircuit: true, format: "module" };
    return next(spec, context);
  },
});

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
const near = (a: number | null | undefined, b: number, eps = 1e-6) =>
  a != null && Math.abs(a - b) < eps;

// Среды подряд: ISO-недели 29, 30, 31, 32 сезона 2026.
const WEEK = [
  new Date("2026-07-15T00:00:00Z"),
  new Date("2026-07-22T00:00:00Z"),
  new Date("2026-07-29T00:00:00Z"),
  new Date("2026-08-05T00:00:00Z"),
];

async function main() {
  // Динамические импорты — ПОСЛЕ регистрации хуков, иначе модули возьмут настоящий клиент.
  const { prisma } = await import("../lib/prisma");
  const { spyCalls, spyCount, spyReset } = await import("./_stubs/prisma-spy");
  const { getFarmerQuality } = await import("../server/farmers/quality");
  const { getCultureAnalytics } = await import("../server/analytics/culture");
  const { seasonYearOf } = await import("../server/shipments/workdays");

  const season = seasonYearOf(WEEK[0]);
  const tag = `FQ-${Date.now()}`;
  const created: (() => Promise<unknown>)[] = [];

  try {
    // ---------- Данные сценария ----------
    const tc = await prisma.transportCompany.create({ data: { name: `${tag} TC` } });
    const driver = await prisma.driver.create({
      data: { full_name: `${tag} driver`, transport_company_id: tc.id },
    });
    const [f1, f2, f3] = await Promise.all([
      prisma.farmer.create({ data: { name: `${tag} наш` } }),
      prisma.farmer.create({ data: { name: `${tag} сосед-1` } }),
      prisma.farmer.create({ data: { name: `${tag} сосед-2` } }),
    ]);

    // A — калибр, трое поставщиков (рейтинг осмыслен). B — simple, он единственный.
    // C — simple, двое (Δ есть, позиции нет). D — только строка контракта, актов нет.
    const cultA = await prisma.culture.create({
      data: { name: `${tag} огурцы`, color: "#2F9E44", acceptance_type: "calibre" },
    });
    const cultB = await prisma.culture.create({
      data: { name: `${tag} кабачки`, color: "#7C3AED", acceptance_type: "simple" },
    });
    const cultC = await prisma.culture.create({
      data: { name: `${tag} томаты`, color: "#D4322C", acceptance_type: "simple" },
    });
    const cultD = await prisma.culture.create({
      data: { name: `${tag} перец`, color: "#E8730C", acceptance_type: "simple" },
    });

    const scheme = await prisma.calibreScheme.create({ data: { culture_id: cultA.id } });
    const rOk = await prisma.calibreRange.create({
      data: { scheme_id: scheme.id, label: "6–9", min_cm: "6", max_cm: "9", is_accepted: true },
    });
    const rNs = await prisma.calibreRange.create({
      data: { scheme_id: scheme.id, label: ">12", min_cm: "12", is_accepted: false },
    });

    const contract = await prisma.contract.create({
      data: { farmer_id: f1.id, season_year: season },
    });
    await prisma.contractLine.createMany({
      data: [
        { contract_id: contract.id, culture_id: cultA.id, volume_tons: "100", price_per_kg: "30" },
        { contract_id: contract.id, culture_id: cultD.id, volume_tons: "40", price_per_kg: "25" },
      ],
    });

    let actSeq = 0;
    const itemIds: number[] = [];
    const shipmentIds: number[] = [];

    // Позиция + акт. calibres: [% принятой 6–9, % непринятой >12]; вместе с браком = 100.
    async function seed(p: {
      farmerId: number;
      cultureId: number;
      week: number;
      actualKg: number;
      brak: number | null;
      calibres?: [number, number];
      withAct?: boolean;
    }) {
      const shipment = await prisma.shipment.create({
        data: {
          code: `${tag}-${shipmentIds.length + 1}`,
          status: p.withAct === false ? "arrived" : "accepted",
          departure_date: WEEK[p.week],
          arrival_date: WEEK[p.week],
          driver_id: driver.id,
        },
      });
      shipmentIds.push(shipment.id);
      const item = await prisma.shipmentItem.create({
        data: {
          shipment_id: shipment.id,
          farmer_id: p.farmerId,
          culture_id: p.cultureId,
          planned_weight_kg: String(p.actualKg),
          actual_weight_kg: String(p.actualKg),
        },
      });
      itemIds.push(item.id);
      if (p.withAct === false) return item;
      actSeq += 1;
      await prisma.acceptanceAct.create({
        data: {
          shipment_item_id: item.id,
          // BR-9: № хранится с префиксом сезона, показывается без него (stripSeasonPrefix).
          act_number: `${season}-${tag}-${actSeq}`,
          brak_percent: p.brak != null ? String(p.brak) : null,
          calibreResults: p.calibres
            ? {
                create: [
                  { calibre_range_id: rOk.id, percent: String(p.calibres[0]) },
                  { calibre_range_id: rNs.id, percent: String(p.calibres[1]) },
                ],
              }
            : undefined,
        },
      });
      return item;
    }

    // A: наш — три недели по 10 т, брак 2%, нестандарт 10%.
    for (const w of [0, 1, 2]) {
      await seed({ farmerId: f1.id, cultureId: cultA.id, week: w, actualKg: 10000, brak: 2, calibres: [88, 10] });
    }
    // A: соседи — 20 т брак 6% и 5 т брак 1% → база бенчмарка (20×6+5×1)/25 = 5,0%.
    await seed({ farmerId: f2.id, cultureId: cultA.id, week: 0, actualKg: 20000, brak: 6, calibres: [84, 10] });
    await seed({ farmerId: f3.id, cultureId: cultA.id, week: 0, actualKg: 5000, brak: 1, calibres: [89, 10] });
    // B: он единственный поставщик культуры.
    await seed({ farmerId: f1.id, cultureId: cultB.id, week: 0, actualKg: 6000, brak: 7 });
    // C: двое поставщиков — Δ показывается, позиция нет.
    await seed({ farmerId: f1.id, cultureId: cultC.id, week: 0, actualKg: 8000, brak: 3 });
    await seed({ farmerId: f2.id, cultureId: cultC.id, week: 0, actualKg: 8000, brak: 2 });
    // D: у него только строка контракта; акт есть у соседа → «ориентир» начала сезона.
    await seed({ farmerId: f2.id, cultureId: cultD.id, week: 0, actualKg: 6000, brak: 3 });
    // Позиция БЕЗ акта: она обязана попасть в «из N поставок», но не в «партий с актом».
    await seed({ farmerId: f1.id, cultureId: cultA.id, week: 0, actualKg: 9000, brak: null, withAct: false });

    created.push(
      () => prisma.shipmentItem.deleteMany({ where: { id: { in: itemIds } } }),
      () => prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } }),
      () => prisma.contractLine.deleteMany({ where: { contract_id: contract.id } }),
      () => prisma.contract.delete({ where: { id: contract.id } }),
      () => prisma.calibreRange.deleteMany({ where: { scheme_id: scheme.id } }),
      () => prisma.calibreScheme.delete({ where: { id: scheme.id } }),
      () =>
        prisma.culture.deleteMany({
          where: { id: { in: [cultA.id, cultB.id, cultC.id, cultD.id] } },
        }),
      () => prisma.farmer.deleteMany({ where: { id: { in: [f1.id, f2.id, f3.id] } } }),
      () => prisma.driver.delete({ where: { id: driver.id } }),
      () => prisma.transportCompany.delete({ where: { id: tc.id } }),
    );

    // ---------- Фаза 1: форма обращений к БД ----------
    console.log("\n1) Число запросов на открытие вкладки");
    spyReset();
    const q1 = await getFarmerQuality({ farmerId: f1.id, season });
    const calls = spyCalls();
    console.log(`   запросы: ${calls.join(" · ")}`);
    check(
      "выборок позиций ровно две (лёгкая по фермеру + одна общая по культурам)",
      spyCount("shipmentItem", "findMany") === 2,
      `их ${spyCount("shipmentItem", "findMany")}`,
    );
    check("всего обращений к моделям — 5", calls.length === 5, `их ${calls.length}`);
    check(
      "по культуре на выборку НЕ ходим (4 культуры → не 4+ выборки позиций)",
      spyCount("shipmentItem", "findMany") < 4,
    );
    if (!q1) throw new Error("getFarmerQuality вернул null");

    // ---------- Фаза 2: сверка с профилем культуры ----------
    console.log("\n2) Сверка с профилем культуры (/analytics/culture/[id])");
    const profile = await getCultureAnalytics({ season, cultureId: cultA.id });
    const profRow = profile!.bySupplier.find((s) => s.farmerId === f1.id)!;
    const qa = q1.cultures.find((c) => c.cultureId === cultA.id)!;
    check(
      "«Принято, т» = строка фермера в таблице «По поставщикам»",
      near(qa.acceptedKg / 1000, profRow.acceptedTons, 1e-9),
      `${qa.acceptedKg / 1000} vs ${profRow.acceptedTons}`,
    );
    check(
      "«Доля в культуре» = доля той же строки",
      near(qa.sharePct, profRow.sharePct, 1e-9),
      `${qa.sharePct} vs ${profRow.sharePct}`,
    );
    check(
      "категории строки совпадают с профилем (подписи и порядок)",
      JSON.stringify(qa.categories.map((c) => c.label)) ===
        JSON.stringify(profRow.categoryPct.map((c) => c.label)),
      JSON.stringify(qa.categories.map((c) => c.label)),
    );

    // Брак поставщика таблица «По поставщикам» наружу не отдаёт (колонки такой нет), зато
    // отдаёт KPI «Средний брак» — и профиль умеет фильтроваться по поставщикам. Прогоняем
    // экран с фильтром «только он» и «только остальные»: это НЕЗАВИСИМЫЙ путь к тем же
    // двум числам, через реальную фичу экрана, а не через то же ядро другим вызовом.
    const onlyHim = await getCultureAnalytics({
      season,
      cultureId: cultA.id,
      supplierIds: [f1.id],
    });
    check(
      "«Брак у него» = KPI профиля с фильтром «только он»",
      near(qa.brakPct, onlyHim!.kpi.avgBrakPct!, 1e-9),
      `${qa.brakPct} vs ${onlyHim!.kpi.avgBrakPct}`,
    );
    check(
      "«Принято» сходится и на отфильтрованном профиле",
      near(qa.acceptedKg / 1000, onlyHim!.kpi.acceptedTons, 1e-9),
      `${qa.acceptedKg / 1000} vs ${onlyHim!.kpi.acceptedTons}`,
    );

    // ---------- Фаза 3: бенчмарк ----------
    console.log("\n3) Бенчмарк «у остальных»");
    check(
      "брак у остальных = (20 000×6% + 5 000×1%) / 25 000 = 5,0%",
      near(qa.othersBrakPct, 5),
      String(qa.othersBrakPct),
    );
    const onlyOthers = await getCultureAnalytics({
      season,
      cultureId: cultA.id,
      supplierIds: [f2.id, f3.id],
    });
    check(
      "...и совпадает с KPI профиля, отфильтрованного на этих двоих",
      near(qa.othersBrakPct, onlyOthers!.kpi.avgBrakPct!, 1e-9),
      `${qa.othersBrakPct} vs ${onlyOthers!.kpi.avgBrakPct}`,
    );
    check(
      "сам фермер из базы бенчмарка исключён (иначе было бы 4,0%)",
      !near(qa.othersBrakPct, (30000 * 2 + 20000 * 6 + 5000 * 1) / 55000, 1e-3),
    );
    check("Δ = 2,0 − 5,0 = −3,0 п.п. (лучше)", near(qa.deltaPp, -3), String(qa.deltaPp));
    check(
      "позиция при трёх поставщиках: 2 из 3 (Ф3 1% лучше, Ф2 6% хуже)",
      qa.rank?.position === 2 && qa.rank.of === 3,
      JSON.stringify(qa.rank),
    );
    check("«не в зачёт» calibre-культуры = 10%", near(qa.nonStandardPct, 10), String(qa.nonStandardPct));

    // ---------- Фаза 4: деградации ----------
    console.log("\n4) Деградации (мало поставщиков, simple, нет актов)");
    const qb = q1.cultures.find((c) => c.cultureId === cultB.id)!;
    check("единственный поставщик: «у остальных» — прочерк", qb.othersBrakPct === null);
    check("единственный поставщик: Δ — прочерк", qb.deltaPp === null);
    check("единственный поставщик: позиция — прочерк", qb.rank === null);
    check("simple-культура: «не в зачёт» отсутствует", qb.nonStandardPct === null);
    check(
      "simple-культура: категории вырождаются в «Принято / Брак»",
      JSON.stringify(qb.categories.map((c) => c.label)) === JSON.stringify(["Принято", "Брак"]),
      JSON.stringify(qb.categories.map((c) => c.label)),
    );

    const qc = q1.cultures.find((c) => c.cultureId === cultC.id)!;
    check("два поставщика: позиция — прочерк (M < 3)", qc.rank === null, JSON.stringify(qc.rank));
    check("два поставщика: Δ при этом показывается (+1,0 п.п.)", near(qc.deltaPp, 1), String(qc.deltaPp));

    const qd = q1.cultures.find((c) => c.cultureId === cultD.id)!;
    check("культура со строкой контракта, но без актов: строка есть", qd != null);
    check("...принято 0, брак — прочерк", qd.acceptedKg === 0 && qd.brakPct === null);
    check("...план строки контракта виден (40 т)", near(qd.contractTons, 40), String(qd.contractTons));
    check(
      "...«у остальных» показан, потому что у соседа акт ЕСТЬ (3%)",
      near(qd.othersBrakPct, 3),
      String(qd.othersBrakPct),
    );
    check("...Δ всё равно нет — своего брака у него нет", qd.deltaPp === null);

    // ---------- Фаза 5: KPI и порог графика ----------
    console.log("\n5) KPI, недели и порог графика");
    check("партий с актом — 5", q1.kpi.actsCount === 5, String(q1.kpi.actsCount));
    check(
      "«из N поставок» больше: позиция без акта учтена (6)",
      q1.kpi.positionsTotal === 6,
      String(q1.kpi.positionsTotal),
    );
    check(
      "Σ принятого по культурам = kpi.acceptedKg",
      near(q1.cultures.reduce((s, c) => s + c.acceptedKg, 0), q1.kpi.acceptedKg, 1e-6),
    );
    check("недель с актами 3 → графика нет, рисуется таблица", q1.notes.weeksWithActs === 3 && !q1.notes.chartReady, JSON.stringify(q1.notes));
    check("выброс не помечен: партий в культуре меньше четырёх", qa.batches.every((b) => !b.outlier));
    check(
      "№ акта показывается без префикса сезона",
      qa.batches.every((b) => b.actNumber != null && !b.actNumber.startsWith(`${season}-`)),
      JSON.stringify(qa.batches.map((b) => b.actNumber)),
    );

    // Четвёртая неделя + партия с браком 12% — порог графика и подсветка выброса.
    await seed({ farmerId: f1.id, cultureId: cultA.id, week: 3, actualKg: 10000, brak: 12, calibres: [78, 10] });
    const q2 = (await getFarmerQuality({ farmerId: f1.id, season }))!;
    const qa2 = q2.cultures.find((c) => c.cultureId === cultA.id)!;
    check("четвёртая неделя с актами → график", q2.notes.weeksWithActs === 4 && q2.notes.chartReady);
    check(
      "средний брак фермера по культуре стал 4,5%",
      near(qa2.brakPct, (30000 * 2 + 10000 * 12) / 40000),
      String(qa2.brakPct),
    );
    check(
      "партия 12% помечена выбросом (≥ 1,5 × 4,5% и партий ≥ 4)",
      qa2.batches.filter((b) => b.outlier).length === 1 &&
        near(qa2.batches.find((b) => b.outlier)!.brakPct, 12),
      JSON.stringify(qa2.batches.map((b) => [b.brakPct, b.outlier])),
    );
    check(
      "партии отсортированы по дате убыв.",
      qa2.batches.map((b) => b.date ?? "").join(">") ===
        [...qa2.batches.map((b) => b.date ?? "")].sort().reverse().join(">"),
      JSON.stringify(qa2.batches.map((b) => b.date)),
    );
    check(
      "вердикт итога считается только по культурам с базой (A, C, D → 2)",
      q2.totals.benchmark.basedOnCultures === 2,
      JSON.stringify(q2.totals.benchmark),
    );

    // ---------- Фаза 6: RBAC ----------
    console.log("\n6) RBAC");
    globalThis.__TEST_USER__ = null;
    let denied = false;
    try {
      await getFarmerQuality({ farmerId: f1.id, season });
    } catch (e) {
      denied = (e as Error).name === "AuthError";
    }
    check("без сессии загрузчик бросает AuthError", denied);
    globalThis.__TEST_USER__ = { id: "1", role: "user" };
    const asUser = await getFarmerQuality({ farmerId: f1.id, season });
    check("роль user карточку читает (гард — факт аутентификации)", asUser != null);
  } finally {
    globalThis.__TEST_USER__ = null;
    for (const del of created) {
      try {
        await del();
      } catch (e) {
        console.log(`  (уборка) ${(e as Error).message.split("\n")[0]}`);
      }
    }
    console.log(`\nИтого: ${pass} ok, ${fail} fail`);
    await prisma.$disconnect();
  }
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
