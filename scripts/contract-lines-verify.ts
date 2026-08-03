// contract-lines-diff: проверка сохранения строк контракта «как из приложения».
// Запуск: npx tsx scripts/contract-lines-verify.ts
//
//   A. Контракт с приёмкой: добавление строки той же культуры (BR-5) — раньше падало о FK,
//      id существующих строк обязаны остаться прежними (на них держатся привязки).
//   B. Правка цены → по-строчная запись в ChangeLog («Цена, ₽/кг: было → стало»).
//   C. Сохранение без правок → журнал молчит.
//   D. Удаление строки, по которой есть позиция → адресная ошибка, данные не тронуты.
//   E. Смена культуры у занятой строки → адресная ошибка, culture_id прежний.
//   F. Удаление строки БЕЗ ссылок → проходит, в журнале запись «Строка удалена».
//   G. Создание контракта → по-строчные записи, сводки «N строк(а)» больше нет.
//
// Server Actions требуют сессию (requireRole) и Next-контекст (revalidatePath), поэтому
// подменяем `@/auth` и `next/cache` loader-хуками Node (тот же приём, что в w5a-verify).
// Сам server-код НЕ трогаем: выполняется настоящая логика create/updateContract, включая
// RBAC, транзакцию и ChangeLog.
//
// Каждое сохранение — своя транзакция, поэтому обернуть сценарий в один rolled-back
// $transaction нельзя: данные создаются реально и удаляются в finally (dev-ветка Neon,
// данные одноразовые — правило проекта). Приёмку целиком не проводим: достаточно
// ShipmentItem со ссылкой на строку — ровно то состояние, которое ломало старый код.
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
const STUB_CACHE = pathToFileURL(
  new URL("_stubs/next-cache.ts", import.meta.url).pathname,
).href;

registerHooks({
  resolve(spec, context, next) {
    if (spec === "@/auth") return { url: STUB_AUTH, shortCircuit: true, format: "module" };
    if (spec === "next/cache") return { url: STUB_CACHE, shortCircuit: true, format: "module" };
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

async function main() {
  // Динамические импорты — после регистрации хуков.
  const { prisma } = await import("../lib/prisma");
  const { createContract, updateContract } = await import("../server/contracts/actions");
  const { seasonYearOf } = await import("../server/shipments/workdays");

  // Гард подключения: работаем против рабочей dev-БД, а не пустой/чужой.
  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "StockMovement"
  `;
  console.log(`БД: StockMovement = ${count} движ.`);
  if (Number(count) <= 0) {
    throw new Error("StockMovement пуст — это не рабочая dev-БД, выходим");
  }

  const W = new Date("2026-07-15T00:00:00Z");
  const season = seasonYearOf(W);
  const cleanup: (() => Promise<unknown>)[] = [];
  // id строк, которые засветились в журнале (в т.ч. удалённых) — для уборки ChangeLog.
  const seenLines = new Set<number>();
  const seenContracts: number[] = [];

  try {
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: "admin", active: true },
    });
    globalThis.__TEST_USER__ = { id: String(admin.id), role: "admin" };

    // ------------------------------------------------------------------ seed
    const farmer = await prisma.farmer.create({ data: { name: "CLD farmer" } });
    const culture = await prisma.culture.create({
      data: { name: "CLD огурцы", color: "#2F9E44", acceptance_type: "simple" },
    });
    const culture2 = await prisma.culture.create({
      data: { name: "CLD томаты", color: "#E03131", acceptance_type: "simple" },
    });
    const contract = await prisma.contract.create({
      data: { farmer_id: farmer.id, season_year: season },
    });
    seenContracts.push(contract.id);
    const lineA = await prisma.contractLine.create({
      data: {
        contract_id: contract.id,
        culture_id: culture.id,
        label: "стандарт",
        volume_tons: "10",
        price_per_kg: "30",
      },
    });
    const lineB = await prisma.contractLine.create({
      data: {
        contract_id: contract.id,
        culture_id: culture.id,
        label: "нестандарт",
        volume_tons: "10",
        price_per_kg: "20",
      },
    });
    seenLines.add(lineA.id);
    seenLines.add(lineB.id);

    // Позиция отгрузки со ссылкой на lineA: ровно то состояние, при котором прежний
    // deleteMany+createMany падал о Restrict при ЛЮБОМ сохранении контракта.
    const shipment = await prisma.shipment.create({
      data: {
        code: `CLD-${Date.now()}`,
        status: "arrived",
        departure_date: W,
        arrival_date: W,
      },
    });
    const item = await prisma.shipmentItem.create({
      data: {
        shipment_id: shipment.id,
        farmer_id: farmer.id,
        culture_id: culture.id,
        planned_weight_kg: "5000",
        actual_weight_kg: "5000",
        contract_line_id: lineA.id,
      },
    });

    cleanup.push(
      () =>
        prisma.changeLog.deleteMany({
          where: { entity: "ContractLine", entity_id: { in: [...seenLines] } },
        }),
      () =>
        prisma.changeLog.deleteMany({
          where: { entity: "Contract", entity_id: { in: seenContracts } },
        }),
      () => prisma.shipmentItem.deleteMany({ where: { shipment_id: shipment.id } }),
      () => prisma.shipment.delete({ where: { id: shipment.id } }),
      () =>
        prisma.contractLine.deleteMany({ where: { contract_id: { in: seenContracts } } }),
      () => prisma.contract.deleteMany({ where: { id: { in: seenContracts } } }),
      () => prisma.culture.delete({ where: { id: culture2.id } }),
      () => prisma.culture.delete({ where: { id: culture.id } }),
      () => prisma.farmer.delete({ where: { id: farmer.id } }),
    );

    // ---------------------------------------------------------------- хелперы
    const linesOf = async (contractId: number) => {
      const rows = await prisma.contractLine.findMany({
        where: { contract_id: contractId },
        orderBy: { id: "asc" },
      });
      for (const r of rows) seenLines.add(r.id);
      return rows;
    };
    const lastLogId = async () =>
      (await prisma.changeLog.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))
        ?.id ?? 0;
    const logsSince = (afterId: number) =>
      prisma.changeLog.findMany({
        where: {
          id: { gt: afterId },
          OR: [
            { entity: "ContractLine", entity_id: { in: [...seenLines] } },
            { entity: "Contract", entity_id: { in: seenContracts } },
          ],
        },
        orderBy: { id: "asc" },
      });
    // Строка формы: id пустой = новая строка (так шлёт форма).
    const asInput = (
      l: { id?: number; culture_id: number; label: string | null; volume_tons: string; price_per_kg: string },
    ) => ({
      id: l.id ? String(l.id) : "",
      culture_id: String(l.culture_id),
      label: l.label ?? "",
      volume_tons: l.volume_tons,
      price_per_kg: l.price_per_kg,
    });
    const payload = (lines: ReturnType<typeof asInput>[]) => ({
      farmer_id: String(farmer.id),
      season_year: String(season),
      notes: "",
      lines,
    });
    const rowInput = (r: { id: number; culture_id: number; label: string | null; volume_tons: unknown; price_per_kg: unknown }) =>
      asInput({
        id: r.id,
        culture_id: r.culture_id,
        label: r.label,
        volume_tons: String(r.volume_tons),
        price_per_kg: String(r.price_per_kg),
      });

    // ------------------------------------------------- A. добавление строки (BR-5)
    console.log(
      `\nA. Контракт #${contract.id} с приёмкой: id строк ДО — A=${lineA.id}, B=${lineB.id}; ` +
        `ShipmentItem #${item.id} → строка ${item.contract_line_id}`,
    );
    let logFrom = await lastLogId();
    let res = await updateContract(
      contract.id,
      payload([
        rowInput(lineA),
        rowInput(lineB),
        // Третья строка ТОЙ ЖЕ культуры — дубли культур разрешены (BR-5).
        asInput({ culture_id: culture.id, label: "доп. объём", volume_tons: "5", price_per_kg: "25" }),
      ]),
    );
    check("A1 сохранение контракта с приёмкой проходит", res.ok, JSON.stringify(res));

    let rows = await linesOf(contract.id);
    const lineC = rows.find((r) => r.label === "доп. объём");
    console.log(
      `   id строк ПОСЛЕ — ${rows.map((r) => `${r.label}=${r.id}`).join(", ")}`,
    );
    check(
      "A2 id существующих строк не изменились",
      rows.some((r) => r.id === lineA.id) && rows.some((r) => r.id === lineB.id),
      rows.map((r) => r.id).join(","),
    );
    check("A3 строк стало три (дубль культуры разрешён, BR-5)", rows.length === 3);
    check(
      "A4 три строки одной культуры в одном контракте",
      rows.every((r) => r.culture_id === culture.id),
    );
    const itemAfter = await prisma.shipmentItem.findUniqueOrThrow({ where: { id: item.id } });
    check(
      "A5 привязка ShipmentItem цела",
      itemAfter.contract_line_id === lineA.id,
      String(itemAfter.contract_line_id),
    );
    let logs = await logsSince(logFrom);
    check(
      "A6 в журнале одна запись «Строка добавлена» с составом",
      logs.length === 1 &&
        logs[0].entity === "ContractLine" &&
        logs[0].field === "created" &&
        logs[0].entity_id === lineC?.id &&
        (logs[0].new_value ?? "").includes("CLD огурцы · доп. объём"),
      logs.map((l) => `${l.entity}/${l.field}=${l.new_value}`).join(" | "),
    );

    // --------------------------------------------------------- B. правка цены
    console.log("\nB. Правка цены строки «стандарт» 30 → 31");
    logFrom = await lastLogId();
    rows = await linesOf(contract.id);
    res = await updateContract(
      contract.id,
      payload(rows.map((r) => (r.id === lineA.id ? { ...rowInput(r), price_per_kg: "31" } : rowInput(r)))),
    );
    check("B1 правка цены сохраняется", res.ok, JSON.stringify(res));
    const priced = await prisma.contractLine.findUniqueOrThrow({ where: { id: lineA.id } });
    check("B2 цена в БД = 31", priced.price_per_kg.toString() === "31", priced.price_per_kg.toString());
    check("B3 id строки не изменился", priced.id === lineA.id);
    logs = await logsSince(logFrom);
    console.log(
      `   журнал: ${logs.map((l) => `${l.entity}#${l.entity_id} ${l.field}: ${l.old_value} → ${l.new_value}`).join(" | ")}`,
    );
    check(
      "B4 запись «price_per_kg: 30 → 31» по строке",
      logs.length === 1 &&
        logs[0].entity === "ContractLine" &&
        logs[0].entity_id === lineA.id &&
        logs[0].field === "price_per_kg" &&
        logs[0].old_value === "30" &&
        logs[0].new_value === "31",
      JSON.stringify(logs),
    );
    check(
      "B5 записей по неизменённым полям нет",
      logs.every((l) => l.field === "price_per_kg"),
    );

    // ------------------------------------------------ C. сохранение без правок
    console.log("\nC. Пересохранение без единой правки");
    logFrom = await lastLogId();
    rows = await linesOf(contract.id);
    res = await updateContract(contract.id, payload(rows.map(rowInput)));
    check("C1 сохраняется", res.ok, JSON.stringify(res));
    logs = await logsSince(logFrom);
    check("C2 журнал молчит (нет фиктивных правок)", logs.length === 0, JSON.stringify(logs));
    check(
      "C3 набор строк не изменился",
      (await linesOf(contract.id)).length === 3,
    );

    // ------------------------------------- D. удаление строки с принятой позицией
    console.log("\nD. Попытка удалить строку «стандарт» (по ней есть позиция)");
    logFrom = await lastLogId();
    rows = await linesOf(contract.id);
    res = await updateContract(
      contract.id,
      payload(rows.filter((r) => r.id !== lineA.id).map(rowInput)),
    );
    check("D1 сохранение отклонено", !res.ok, JSON.stringify(res));
    const dErr = res.ok ? "" : res.error;
    console.log(`   текст: ${dErr}`);
    check("D2 ошибка называет строку", dErr.includes("«CLD огурцы · стандарт»"), dErr);
    check("D3 ошибка объясняет причину", dErr.includes("уже есть отгрузки или принятые позиции"), dErr);
    check(
      "D4 общего «Не удалось сохранить» нет",
      !dErr.includes("Не удалось сохранить"),
      dErr,
    );
    check("D5 строка на месте", (await linesOf(contract.id)).some((r) => r.id === lineA.id));
    check(
      "D6 привязка ShipmentItem цела",
      (await prisma.shipmentItem.findUniqueOrThrow({ where: { id: item.id } }))
        .contract_line_id === lineA.id,
    );
    logs = await logsSince(logFrom);
    check("D7 журнал не вырос (транзакция откатилась)", logs.length === 0, JSON.stringify(logs));

    // ---------------------------------- E. смена культуры у занятой строки
    console.log("\nE. Попытка сменить культуру строки «стандарт»");
    logFrom = await lastLogId();
    rows = await linesOf(contract.id);
    res = await updateContract(
      contract.id,
      payload(
        rows.map((r) =>
          r.id === lineA.id ? { ...rowInput(r), culture_id: String(culture2.id) } : rowInput(r),
        ),
      ),
    );
    check("E1 сохранение отклонено", !res.ok, JSON.stringify(res));
    const eErr = res.ok ? "" : res.error;
    console.log(`   текст: ${eErr}`);
    check("E2 ошибка называет строку", eErr.includes("«CLD огурцы · стандарт»"), eErr);
    check(
      "E3 культура в БД прежняя",
      (await prisma.contractLine.findUniqueOrThrow({ where: { id: lineA.id } })).culture_id ===
        culture.id,
    );
    logs = await logsSince(logFrom);
    check("E4 журнал не вырос", logs.length === 0, JSON.stringify(logs));

    // ------------------------------------------- F. удаление строки без ссылок
    console.log("\nF. Удаление строки «нестандарт» (ссылок нет)");
    logFrom = await lastLogId();
    rows = await linesOf(contract.id);
    res = await updateContract(
      contract.id,
      payload(rows.filter((r) => r.id !== lineB.id).map(rowInput)),
    );
    check("F1 удаление проходит", res.ok, JSON.stringify(res));
    check(
      "F2 строки в БД нет",
      (await prisma.contractLine.findUnique({ where: { id: lineB.id } })) === null,
    );
    logs = await logsSince(logFrom);
    console.log(
      `   журнал: ${logs.map((l) => `${l.entity}#${l.entity_id} ${l.field}: ${l.old_value}`).join(" | ")}`,
    );
    check(
      "F3 запись «Строка удалена» с составом",
      logs.length === 1 &&
        logs[0].entity === "ContractLine" &&
        logs[0].entity_id === lineB.id &&
        logs[0].field === "deleted" &&
        (logs[0].old_value ?? "").includes("CLD огурцы · нестандарт") &&
        (logs[0].old_value ?? "").includes(`контракт #${contract.id}`),
      JSON.stringify(logs),
    );

    // -------------------------------------------------- G. создание контракта
    console.log("\nG. Создание нового контракта с двумя строками");
    logFrom = await lastLogId();
    res = await createContract(
      payload([
        asInput({ culture_id: culture.id, label: "стандарт", volume_tons: "7", price_per_kg: "12,5" }),
        asInput({ culture_id: culture2.id, label: null, volume_tons: "3", price_per_kg: "40" }),
      ]),
    );
    check("G1 контракт создан", res.ok, JSON.stringify(res));
    const contract2 = await prisma.contract.findFirstOrThrow({
      where: { farmer_id: farmer.id, id: { not: contract.id } },
      orderBy: { id: "desc" },
    });
    seenContracts.push(contract2.id);
    const rows2 = await linesOf(contract2.id);
    check("G2 обе строки записаны", rows2.length === 2, String(rows2.length));
    check(
      "G3 цена с запятой сохранена как 12,5",
      rows2.some((r) => r.price_per_kg.toString() === "12.5"),
      rows2.map((r) => r.price_per_kg.toString()).join(","),
    );
    logs = await logsSince(logFrom);
    const created = logs.filter((l) => l.entity === "ContractLine" && l.field === "created");
    check("G4 две по-строчные записи «Строка добавлена»", created.length === 2, JSON.stringify(logs));
    check(
      "G5 сводки «N строк(а)» больше нет",
      !logs.some((l) => l.field === "lines"),
      JSON.stringify(logs.map((l) => l.field)),
    );
    check(
      "G6 строка без метки названа одной культурой",
      created.some((l) => (l.new_value ?? "").startsWith("CLD томаты · 3 т")),
      created.map((l) => l.new_value).join(" | "),
    );
  } finally {
    globalThis.__TEST_USER__ = null;
    for (const fn of cleanup) {
      try {
        await fn();
      } catch (e) {
        console.log(`  ! уборка: ${(e as Error).message}`);
      }
    }
    await prisma.$disconnect();
  }

  console.log(`\nИтог: ${pass} ✓ / ${fail} ✗`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
