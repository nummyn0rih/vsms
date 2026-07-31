// changelog-viewer: проверка чтения журнала «как из приложения».
// Запуск: npx tsx scripts/changelog-viewer-verify.ts
//
// getChangeLog зовёт requireRole("admin"), поэтому подменяем `@/auth` на стаб
// (scripts/_stubs/auth.ts) через loader-хук Node: сессия берётся из globalThis.__TEST_USER__.
// Сам server-код НЕ трогаем — проверяется настоящий гард, настоящий where и настоящая
// пагинация. Писателя (server/changelog.ts) задача не касается вовсе.
//
// Тестовая БД: временные записи создаются и удаляются в конце (dev-ветка Neon).
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

// Метка-маркер: по ней находим и убираем ровно свои записи.
const TAG = `clv-${Date.now()}`;

async function main() {
  const { prisma } = await import("../lib/prisma");
  const { getChangeLog, listChangeLogUsers } = await import("../server/changelog/query");
  const { entityLabel, fieldLabel, formatValue } = await import(
    "../server/changelog/labels"
  );

  const created: (() => Promise<unknown>)[] = [];

  try {
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: "admin", active: true },
    });
    const operator = await prisma.user.create({
      data: { login: `clv-op-${Date.now()}`, password_hash: "x", role: "operator" },
    });

    // Записи журнала: две «нормальные», одна со сторонним словарю entity/field и одна
    // системная (user_id = null). Отметки времени разнесены, чтобы проверять период,
    // и отнесены в 2019-й — в dev-БД есть настоящие логи, и пересечение по датам
    // ломало бы утверждения о количестве строк.
    const day = (iso: string) => new Date(iso);
    await prisma.changeLog.createMany({
      data: [
        {
          entity: "Shipment",
          entity_id: 999_001,
          field: "status",
          old_value: "sent",
          new_value: "arrived",
          user_id: admin.id,
          timestamp: day("2019-03-10T09:00:00Z"),
        },
        {
          entity: "AcceptanceAct",
          entity_id: 999_002,
          field: "settlement_percent",
          old_value: null,
          new_value: `97 ${TAG}`,
          user_id: operator.id,
          timestamp: day("2019-03-11T09:00:00Z"),
        },
        {
          entity: "ZzzUnknown",
          entity_id: 999_003,
          field: "zzz_field",
          old_value: "было",
          new_value: `стало ${TAG}`,
          user_id: admin.id,
          timestamp: day("2019-03-12T09:00:00Z"),
        },
        {
          entity: "StockMovement",
          entity_id: 999_004,
          field: "opening",
          old_value: null,
          new_value: `1000 ${TAG}`,
          user_id: null, // «система»
          timestamp: day("2019-03-12T10:00:00Z"),
        },
      ],
    });

    created.push(
      () => prisma.changeLog.deleteMany({ where: { entity_id: { gte: 999_001, lte: 999_009 } } }),
      () => prisma.user.delete({ where: { id: operator.id } }),
    );

    const window = { from: "2019-03-10", to: "2019-03-12" };

    console.log("A. RBAC (серверный отказ, не только скрытое меню)");

    globalThis.__TEST_USER__ = { id: String(operator.id), role: "operator" };
    let denied = false;
    try {
      await getChangeLog({ pageSize: 5 });
    } catch (e) {
      denied = (e as Error).name === "AuthError";
    }
    check("operator НЕ может читать журнал (AuthError)", denied);

    denied = false;
    try {
      await listChangeLogUsers();
    } catch (e) {
      denied = (e as Error).name === "AuthError";
    }
    check("operator НЕ может получить список пользователей", denied);

    globalThis.__TEST_USER__ = { id: String(admin.id), role: "user" };
    denied = false;
    try {
      await getChangeLog({ pageSize: 5 });
    } catch (e) {
      denied = (e as Error).name === "AuthError";
    }
    check("роль user отклонена", denied);

    globalThis.__TEST_USER__ = null;
    denied = false;
    try {
      await getChangeLog({ pageSize: 5 });
    } catch (e) {
      denied = (e as Error).name === "AuthError";
    }
    check("без сессии отклонено (UNAUTHENTICATED)", denied);

    globalThis.__TEST_USER__ = { id: String(admin.id), role: "admin" };
    const first = await getChangeLog({ pageSize: 5 });
    check("admin читает журнал", first.rows.length > 0, JSON.stringify(first.total));

    console.log("\nB. Пагинация (грузится страница, не вся таблица)");

    check("страница не длиннее pageSize", first.rows.length <= 5, String(first.rows.length));
    check("total не меньше числа строк страницы", first.total >= first.rows.length);
    check(
      "pageCount согласован с total",
      first.pageCount === Math.max(1, Math.ceil(first.total / 5)),
      `${first.pageCount} vs ${first.total}/5`,
    );

    const second = await getChangeLog({ pageSize: 5, page: 2 });
    const ids1 = new Set(first.rows.map((r) => r.id));
    check(
      "страницы 1 и 2 не пересекаются по id",
      second.rows.every((r) => !ids1.has(r.id)),
    );

    const sortedDesc = [...first.rows].every(
      (r, i, a) =>
        i === 0 ||
        a[i - 1].timestamp.getTime() > r.timestamp.getTime() ||
        (a[i - 1].timestamp.getTime() === r.timestamp.getTime() && a[i - 1].id > r.id),
    );
    check("порядок стабилен: timestamp DESC, затем id DESC", sortedDesc);

    const far = await getChangeLog({ pageSize: 5, page: 9999 });
    check(
      "?page=9999 клампится до последней страницы, а не отдаёт пустоту",
      far.page === far.pageCount && far.rows.length > 0,
      `page=${far.page} of ${far.pageCount}, rows=${far.rows.length}`,
    );

    console.log("\nC. Фильтры по отдельности");

    const byEntity = await getChangeLog({ entities: ["ZzzUnknown"], pageSize: 50 });
    check(
      "фильтр по сущности возвращает только её",
      byEntity.rows.length > 0 && byEntity.rows.every((r) => r.entity === "ZzzUnknown"),
    );

    const byUser = await getChangeLog({ userIds: [operator.id], pageSize: 50 });
    check(
      "фильтр по пользователю возвращает только его правки",
      byUser.rows.length > 0 && byUser.rows.every((r) => r.userId === operator.id),
    );
    check("логин пользователя подтянут джойном", byUser.rows[0]?.userLogin === operator.login);

    const bySystem = await getChangeLog({
      includeSystem: true,
      from: window.from,
      to: window.to,
      pageSize: 50,
    });
    check(
      "«система» — это записи с user_id = null",
      bySystem.rows.length > 0 &&
        bySystem.rows.every((r) => r.userId === null && r.userLogin === null),
    );

    const byPeriod = await getChangeLog({ from: "2019-03-11", to: "2019-03-11", pageSize: 50 });
    check(
      "период выбирает только свой день",
      byPeriod.rows.length === 1 && byPeriod.rows[0].entity === "AcceptanceAct",
      `rows=${byPeriod.rows.length}`,
    );

    const byQ = await getChangeLog({ q: TAG, pageSize: 50 });
    check("поиск по new_value находит все меченые записи", byQ.total === 3, String(byQ.total));

    const byQField = await getChangeLog({ q: "ZZZ_FIE", pageSize: 50 });
    check(
      "поиск по имени поля регистронезависим",
      byQField.rows.some((r) => r.field === "zzz_field"),
    );

    // Границы суток — в заводской зоне, а не в UTC: 2019-03-11T21:30Z это уже
    // 12 марта 00:30 МСК, и в фильтр «по 11 марта» запись попадать не должна.
    // Ровно тот сдвиг, из-за которого «сегодня» в проекте считается todayLocalISO().
    const edge = await prisma.changeLog.create({
      data: {
        entity: "ZzzUnknown",
        entity_id: 999_005,
        field: "zzz_field",
        new_value: `край ${TAG}`,
        timestamp: new Date("2019-03-11T21:30:00Z"),
      },
    });

    const edgeIn = await getChangeLog({ from: "2019-03-12", to: "2019-03-12", q: TAG, pageSize: 50 });
    const edgeOut = await getChangeLog({ from: "2019-03-11", to: "2019-03-11", q: TAG, pageSize: 50 });
    check(
      "00:30 МСК относится к своим суткам, а не к предыдущим (границы в FACTORY_TZ)",
      edgeIn.rows.some((r) => r.id === edge.id) && !edgeOut.rows.some((r) => r.id === edge.id),
    );

    console.log("\nD. Фильтры вместе (пересечение, а не объединение)");

    const combo = await getChangeLog({
      entities: ["AcceptanceAct", "ZzzUnknown"],
      userIds: [operator.id],
      from: window.from,
      to: window.to,
      q: TAG,
      pageSize: 50,
    });
    check(
      "сущность + пользователь + период + поиск дают одну строку",
      combo.total === 1 && combo.rows[0]?.entity === "AcceptanceAct",
      `total=${combo.total}`,
    );

    const comboEmpty = await getChangeLog({
      entities: ["ZzzUnknown"],
      userIds: [operator.id],
      pageSize: 50,
    });
    check("несовместимые фильтры дают пустой результат, а не ошибку", comboEmpty.total === 0);

    console.log("\nE. Читаемость (словарь не теряет записи)");

    const unknown = byEntity.rows[0];
    check(
      "неизвестная словарю запись присутствует в выдаче",
      unknown != null && unknown.field === "zzz_field",
    );
    check("неизвестный entity показывается raw", entityLabel(unknown.entity) === "ZzzUnknown");
    check("неизвестный field показывается raw", fieldLabel(unknown.entity, unknown.field) === "zzz_field");

    // entityId, а не поиск: в dev-БД полно настоящих смен статуса, и rows[0] оказался бы
    // чужой строкой — например откатом arrived → sent.
    const statusRow = (await getChangeLog({ entities: ["Shipment"], entityId: 999_001 }))
      .rows[0];
    check(
      "статус отгрузки переведён: Отправлена → Прибыла",
      statusRow != null &&
        formatValue(statusRow.entity, statusRow.field, statusRow.oldValue) === "Отправлена" &&
        formatValue(statusRow.entity, statusRow.field, statusRow.newValue) === "Прибыла",
    );

    const actRow = (await getChangeLog({ entities: ["AcceptanceAct"], entityId: 999_002 }))
      .rows[0];
    check(
      "процент к оплате: подпись поля и прочерк на месте null",
      actRow != null &&
        fieldLabel(actRow.entity, actRow.field) === "Процент к оплате" &&
        formatValue(actRow.entity, actRow.field, actRow.oldValue) === "—",
    );

    const users = await listChangeLogUsers();
    check(
      "список пользователей для фильтра непуст и содержит тестового оператора",
      users.some((u) => u.id === operator.id),
    );
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
