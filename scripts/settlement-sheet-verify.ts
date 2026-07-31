// settlement-sheet: сходимость расчётного листа с карточкой контракта и карточкой фермера.
// Запуск: npx tsx scripts/settlement-sheet-verify.ts
//
// Скрипт ТОЛЬКО ЧИТАЕТ: ничего не создаёт и не удаляет, гоняется по реальным данным
// текущего сезона. Смысл — доказать, что лист не завёл параллельных формул: за сезон
// его числа обязаны совпасть с getContractExecution и getFarmerCard в ноль.
//
// getFarmerSettlement требует сессию (requireRole), поэтому `@/auth` подменяется стабом
// через resolve-хук Node — как в scripts/settlement-rbac-verify.ts. Сам server-код не
// трогаем: requireRole выполняется по-настоящему, только пользователь задаётся тестом.
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
globalThis.__TEST_USER__ = null;

const STUB_AUTH = pathToFileURL(new URL("_stubs/auth.ts", import.meta.url).pathname).href;
registerHooks({
  resolve(spec, context, next) {
    if (spec === "@/auth") return { url: STUB_AUTH, shortCircuit: true, format: "module" };
    return next(spec, context);
  },
});

const EPS = 1e-6;
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

const near = (a: number, b: number, eps = EPS) => Math.abs(a - b) < eps;
const kg = (n: number) => n.toFixed(3);

async function main() {
  // Динамические импорты — после регистрации хуков.
  const { prisma } = await import("../lib/prisma");
  const { getFarmerSettlement } = await import("../server/farmers/settlement");
  const { getFarmerCard } = await import("../server/farmers/card");
  const { getContractExecution } = await import("../server/contracts/execution");
  const { UNBOUND_LINE } = await import("../server/farmers/settlement-agg");
  const { attributeAcceptedToLines, attributeSurchargeToLines } = await import(
    "../server/contracts/execution-core"
  );
  const { computeAcceptedKg } = await import("../server/acceptance/accepted");
  const { currentSeasonWeek, seasonYearOf } = await import("../server/shipments/workdays");

  try {
    const admin = await prisma.user.findFirst({ where: { role: "admin", active: true } });
    if (!admin) throw new Error("нет активного админа — некому выдать сессию для чтения");
    globalThis.__TEST_USER__ = { id: String(admin.id), role: "admin" };

    const season = currentSeasonWeek().seasonYear;
    const contracts = await prisma.contract.findMany({
      where: { season_year: season },
      select: { farmer_id: true, farmer: { select: { name: true } } },
    });
    const farmers = [
      ...new Map(contracts.map((c) => [c.farmer_id, c.farmer.name])).entries(),
    ].sort((a, b) => a[1].localeCompare(b[1]));

    console.log(`\nСезон ${season}: фермеров с контрактами — ${farmers.length}`);
    check("есть данные для сверки", farmers.length > 0);

    // --- A. Лист за сезон ≡ карточка контракта (построчно) ---
    console.log("\nA. Строки листа против getContractExecution");
    let linesCompared = 0;
    let lineMismatch = 0;
    for (const [farmerId, name] of farmers) {
      const sheet = await getFarmerSettlement({ farmerId, season });
      const exec = await getContractExecution({ farmerId, season });
      if (!sheet) {
        fail++;
        console.log(`  ✗ ${name}: лист не построился`);
        continue;
      }
      const execById = new Map(exec.lines.map((l) => [l.lineId, l]));

      if (sheet.lines.length !== exec.lines.length) {
        lineMismatch++;
        console.log(
          `  ✗ ${name}: строк в листе ${sheet.lines.length}, в контракте ${exec.lines.length}`,
        );
      }
      for (const l of sheet.lines) {
        const e = execById.get(l.lineId);
        if (!e) {
          lineMismatch++;
          console.log(`  ✗ ${name}: строки #${l.lineId} нет в getContractExecution`);
          continue;
        }
        linesCompared++;
        // Период = сезон → периодные и сезонные числа листа обязаны совпасть с exec.
        const same =
          near(l.season.countedKg, e.acceptedKg) &&
          near(l.season.targetKg, e.targetKg) &&
          near(l.season.pct, e.pct) &&
          near(l.season.remainingKg, e.remainingKg) &&
          near(l.countedKg, e.acceptedKg) &&
          near(l.surchargeKg, e.surchargeKg) &&
          near(l.paidKg, e.paidKg) &&
          near(l.costRub, e.cost);
        if (!same) {
          lineMismatch++;
          console.log(
            `  ✗ ${name} строка #${l.lineId}: лист {зачт ${kg(l.countedKg)}, допл ${kg(
              l.surchargeKg,
            )}, к опл ${kg(l.paidKg)}, ₽ ${l.costRub.toFixed(2)}} vs контракт {зачт ${kg(
              e.acceptedKg,
            )}, допл ${kg(e.surchargeKg)}, к опл ${kg(e.paidKg)}, ₽ ${e.cost.toFixed(2)}}`,
          );
        }
      }
    }
    check(
      `все строки сошлись числом в число (${linesCompared} строк, ${farmers.length} фермеров)`,
      lineMismatch === 0 && linesCompared > 0,
      `расхождений: ${lineMismatch}`,
    );

    // --- B. Итоги листа ≡ farmerTotal карточки фермера ---
    console.log("\nB. Итоги листа против getFarmerCard.contracts.farmerTotal");
    let totalsMismatch = 0;
    for (const [farmerId, name] of farmers) {
      const sheet = await getFarmerSettlement({ farmerId, season });
      const card = await getFarmerCard(farmerId);
      if (!sheet || !card) continue;
      const t = card.contracts.farmerTotal;
      const ok =
        near(sheet.totals.season.countedKg, t.acceptedKg) &&
        near(sheet.totals.season.targetKg, t.targetKg) &&
        near(sheet.totals.season.pct, t.pct) &&
        near(sheet.totals.surchargeKg, t.surchargeKg) &&
        near(sheet.totals.paidKg, t.paidKg) &&
        near(sheet.totals.costRub, t.costRub, 1e-4);
      if (!ok) {
        totalsMismatch++;
        console.log(
          `  ✗ ${name}: лист {принято ${kg(sheet.totals.season.countedKg)}, ₽ ${sheet.totals.costRub.toFixed(
            2,
          )}} vs карточка {принято ${kg(t.acceptedKg)}, ₽ ${t.costRub.toFixed(2)}}`,
        );
      }
    }
    check("итоги листа = «Итого по фермеру» на вкладке «Контракты»", totalsMismatch === 0);

    // --- C. Σ по месяцам сезона = сезон (партиция без потерь на границах) ---
    console.log("\nC. Партиция сезона по месяцам");
    let partitionMismatch = 0;
    let partitionChecked = 0;
    for (const [farmerId, name] of farmers) {
      const seasonSheet = await getFarmerSettlement({ farmerId, season });
      if (!seasonSheet) continue;
      // Позиции без даты в узкие окна не попадают по определению — их лист считает
      // отдельно (notes.undatedCount), поэтому партицию проверяем без них.
      if (seasonSheet.notes.undatedCount > 0) continue;
      partitionChecked++;

      let sum = 0;
      let cost = 0;
      for (let m = 0; m < 12; m++) {
        const year = season + Math.floor((5 + m) / 12);
        const month = ((5 + m) % 12) + 1;
        const monthSheet = await getFarmerSettlement({
          farmerId,
          season,
          period: "month",
          from: `${year}-${String(month).padStart(2, "0")}-15`,
        });
        sum += monthSheet?.totals.countedKg ?? 0;
        cost += monthSheet?.totals.costRub ?? 0;
      }
      if (
        !near(sum, seasonSheet.totals.countedKg, 1e-3) ||
        !near(cost, seasonSheet.totals.costRub, 1e-3)
      ) {
        partitionMismatch++;
        console.log(
          `  ✗ ${name}: Σ12 мес = ${kg(sum)} кг / ${cost.toFixed(2)} ₽, сезон = ${kg(
            seasonSheet.totals.countedKg,
          )} кг / ${seasonSheet.totals.costRub.toFixed(2)} ₽`,
        );
      }
    }
    check(
      `Σ по 12 месяцам = сезон, вес и деньги (${partitionChecked} фермеров)`,
      partitionMismatch === 0,
    );

    // --- D. Ни один килограмм не потерян ---
    // Воспроизводим ТО ЖЕ разбиение sentinel-прогоном по позициям сезона и сверяем
    // с тем, что лист показал в строках и в секции «без привязки».
    console.log("\nD. Полнота разбиения веса");
    let lossMismatch = 0;
    for (const [farmerId, name] of farmers) {
      const sheet = await getFarmerSettlement({ farmerId, season });
      if (!sheet) continue;

      const rawItems = await prisma.shipmentItem.findMany({
        where: { farmer_id: farmerId, acceptanceAct: { isNot: null } },
        select: {
          actual_weight_kg: true,
          contract_line_id: true,
          shipment: { select: { arrival_date: true, departure_date: true } },
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

      let expected = 0;
      for (const it of rawItems) {
        const ref = it.shipment.arrival_date ?? it.shipment.departure_date ?? new Date();
        if (seasonYearOf(ref) !== season) continue;
        const exec = {
          actualKg: it.actual_weight_kg,
          brakPercent: it.acceptanceAct!.brak_percent?.toNumber() ?? null,
          contractLineId: it.contract_line_id ?? UNBOUND_LINE,
          settlementPercent: it.acceptanceAct!.settlement_percent?.toNumber() ?? null,
          calibres: it.acceptanceAct!.calibreResults.map((cr) => ({
            percent: cr.percent.toNumber(),
            isAccepted: cr.calibreRange.is_accepted,
            contractLineId: cr.contract_line_id,
          })),
        };
        for (const [, v] of attributeAcceptedToLines([exec])) expected += v.toNumber();
        for (const [, v] of attributeSurchargeToLines([exec])) expected += v.toNumber();
      }

      const shown = sheet.totals.paidKg + sheet.unpaidTotals.unpaidKg;
      if (!near(shown, expected, 1e-3)) {
        lossMismatch++;
        console.log(
          `  ✗ ${name}: показано ${kg(shown)} кг (строки ${kg(
            sheet.totals.paidKg,
          )} + без привязки ${kg(sheet.unpaidTotals.unpaidKg)}), ожидалось ${kg(expected)}`,
        );
      }
    }
    check("Σ(строки листа) + Σ(без привязки) = весь оплачиваемый вес сезона", lossMismatch === 0);

    // --- E. Реальный кейс ---
    // Берём самого показательного фермера: с корректировкой расчёта (BR-33), иначе
    // с непривязанным весом, иначе первого с партиями.
    console.log("\nE. Реальный кейс");
    let target: [number, string] | null = null;
    let targetRank = -1;
    for (const f of farmers) {
      const s = await getFarmerSettlement({ farmerId: f[0], season });
      if (!s) continue;
      const rank = s.notes.hasSurcharge ? 3 : s.unpaid.length > 0 ? 2 : s.lines.length > 0 ? 1 : 0;
      if (rank > targetRank) {
        targetRank = rank;
        target = f;
      }
    }
    if (target) {
      const [fid, fname] = target;
      const sheet = await getFarmerSettlement({ farmerId: fid, season });
      if (sheet) {
        console.log(`  Фермер: ${fname} · ${sheet.period.label}`);
        for (const l of sheet.lines) {
          const b = l.batches.length;
          console.log(
            `    ${l.cultureName}${l.label ? ` · ${l.label}` : ""} — ${l.pricePerKg} ₽/кг · ` +
              `заявлено ${(l.season.targetKg / 1000).toFixed(1)} т · зачтено ${(
                l.countedKg / 1000
              ).toFixed(3)} т · доплата ${kg(l.surchargeKg)} кг · к оплате ${(
                l.paidKg / 1000
              ).toFixed(3)} т · ${Math.round(l.costRub).toLocaleString("ru-RU")} ₽ · ` +
              `выполнение ${l.season.pct.toFixed(1)}% · партий ${b}`,
          );
        }
        console.log(
          `    ИТОГО: зачтено ${(sheet.totals.countedKg / 1000).toFixed(3)} т · ` +
            `к оплате ${(sheet.totals.paidKg / 1000).toFixed(3)} т · ` +
            `${Math.round(sheet.totals.costRub).toLocaleString("ru-RU")} ₽ · ` +
            `без привязки ${sheet.unpaidTotals.positions} поз. · ожидают приёмки ${sheet.pending.length} поз.`,
        );

        // Партия с корректировкой BR-33: сумма = к оплате × цена строки.
        let withSettlement = 0;
        let plainBatches = 0;
        let batchSumOk = true;
        let costFormulaOk = true;
        let plainOk = true;
        for (const l of sheet.lines) {
          let acc = 0;
          for (const b of l.batches) {
            if (!near(b.costRub, b.paidKg * l.pricePerKg, 1e-4)) costFormulaOk = false;
            if (!near(b.paidKg, b.countedKg + b.surchargeKg)) costFormulaOk = false;
            if (b.settlementPercent != null) {
              withSettlement++;
              console.log(
                `    BR-33 · акт ${b.actNumber}: зачтено ${kg(b.countedKg)} кг + доплата ${kg(
                  b.surchargeKg,
                )} кг = к оплате ${kg(b.paidKg)} кг × ${l.pricePerKg} ₽ = ${b.costRub.toFixed(
                  2,
                )} ₽ (корректировка ${b.settlementPercent} %, принято по акту ${kg(
                  b.position.acceptedKg ?? 0,
                )} кг)`,
              );
            } else {
              plainBatches++;
              // Без корректировки: доплата 0, к оплате = зачтено.
              if (!near(b.surchargeKg, 0) || !near(b.paidKg, b.countedKg)) plainOk = false;
            }
            acc += b.costRub;
          }
          if (l.batches.length > 0 && !near(acc, l.costRub, 1e-4)) batchSumOk = false;
        }
        check("Σ сумм партий = сумма строки", batchSumOk);
        check("сумма партии = к оплате × цена строки; к оплате = зачтено + доплата", costFormulaOk);
        check(
          `партия без корректировки: доплата 0, к оплате = зачтено (${plainBatches} парт.)`,
          plainOk,
        );
        check(
          `в данных нашлась партия с корректировкой расчёта (BR-33)`,
          withSettlement > 0,
          "в dev-БД нет ни одного акта с settlement_percent — случай покрыт юнит-тестами",
        );

        // Принято по акту считается той же формулой, что и везде.
        let acceptedOk = true;
        for (const l of sheet.lines) {
          for (const b of l.batches) {
            const expected = computeAcceptedKg(
              b.position.actualKg,
              b.position.brakPercent,
              [],
            );
            if (b.position.nonStandardPercent === 0 && b.position.brakPercent != null) {
              if (expected != null && !near(b.position.acceptedKg ?? 0, expected, 1e-3)) {
                acceptedOk = false;
              }
            }
          }
        }
        check("«принято по акту» в разборе партии = computeAcceptedKg", acceptedOk);
      }
    }

    // --- F. RBAC ---
    console.log("\nF. RBAC");
    globalThis.__TEST_USER__ = null;
    let denied = false;
    try {
      await getFarmerSettlement({ farmerId: farmers[0][0], season });
    } catch (e) {
      denied = (e as Error).name === "AuthError" || /UNAUTH/i.test((e as Error).message);
    }
    check("без сессии чтение листа отклонено (requireRole)", denied);
  } finally {
    globalThis.__TEST_USER__ = null;
    console.log(`\nИтого: ${pass} ok, ${fail} fail`);
    await prisma.$disconnect();
  }
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
