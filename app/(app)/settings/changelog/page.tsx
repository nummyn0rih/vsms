import { RoleGate } from "@/components/auth/RoleGate";
import { getCurrentUser } from "@/server/auth/session";
import { SYSTEM_USER_ID } from "@/server/changelog/labels";
import { getChangeLog, listChangeLogUsers } from "@/server/changelog/query";

import { ChangeLogPager } from "./_components/ChangeLogPager";
import { ChangeLogTable } from "./_components/ChangeLogTable";
import { ChangeLogToolbar } from "./_components/ChangeLogToolbar";

// Журнал изменений поверх ChangeLog (admin-only). Фильтры и номер страницы — в URL,
// сервер отдаёт ровно одну страницу. searchParams в Next 16 — асинхронный.
//
// RBAC: истина — requireRole("admin") внутри getChangeLog/listChangeLogUsers. Проверка
// роли ниже нужна лишь чтобы не-admin по прямой ссылке увидел объяснение вместо
// error-boundary (в проде Next стирает причину серверной ошибки). RoleGate — клиентский
// пояс. Скрытого пункта меню недостаточно (CLAUDE.md, правило 5).

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const csv = (v: string | string[] | undefined): string[] =>
  one(v)?.split(",").filter(Boolean) ?? [];

export default async function ChangeLogPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Журнал изменений доступен только администратору.
      </p>
    );
  }

  const sp = await searchParams;

  const userParam = csv(sp.user);
  const userIds = userParam
    .filter((v) => v !== SYSTEM_USER_ID)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  const pageRaw = Number(one(sp.page));

  const [data, users] = await Promise.all([
    getChangeLog({
      entities: csv(sp.entity),
      userIds,
      includeSystem: userParam.includes(SYSTEM_USER_ID),
      from: one(sp.from) ?? null,
      to: one(sp.to) ?? null,
      q: one(sp.q) ?? null,
      page: Number.isFinite(pageRaw) ? pageRaw : 1,
    }),
    listChangeLogUsers(),
  ]);

  return (
    <RoleGate allow={["admin"]}>
      <ChangeLogToolbar users={users} />
      <ChangeLogTable rows={data.rows} />
      <ChangeLogPager
        page={data.page}
        pageCount={data.pageCount}
        total={data.total}
      />
    </RoleGate>
  );
}
