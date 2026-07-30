import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/session";
import { getActiveAlerts } from "@/server/alert-rules/alerts";
import { Sidebar } from "@/components/layout/Sidebar";
import { NavCollapseProvider } from "@/components/layout/sidebar-collapse";
import { MobileNavProvider } from "@/components/layout/mobile-nav-context";
import { MobileAppBar } from "@/components/layout/MobileAppBar";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { MobileNavDrawer } from "@/components/layout/MobileNavDrawer";

// Оболочка авторизованной зоны. proxy.ts уже редиректит гостей на /login,
// но дублируем проверку, т.к. отсюда берём роль для фильтрации меню.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // V1.1: дефицит-бейджи в сайдбаре. Этот layout оборачивает ВЕСЬ (app)-сегмент, т.е.
  // отрабатывает на каждом переходе. audit-w4b: без правил дефицита запрос ровно один
  // (сами правила), с правилами — Σ движений агрегирует БД (groupBy) и только по тем
  // позициям, на которые есть порог. Кэш-слой сознательно не вводим.
  const alerts = await getActiveAlerts();

  return (
    <NavCollapseProvider>
      <MobileNavProvider>
        <div className="flex h-screen">
          <div className="hidden md:flex">
            <Sidebar
              role={user.role}
              userLabel={user.login}
              badges={{ "/packaging": alerts.tareCount, "/ingredients": alerts.ingredientCount }}
            />
          </div>
          <main className="flex-1 overflow-y-auto px-0 pb-[calc(56px+env(safe-area-inset-bottom))] md:px-6 md:pb-6">
            <MobileAppBar />
            <div className="pt-6">{children}</div>
          </main>
          <MobileTabBar role={user.role} />
          <MobileNavDrawer role={user.role} userLabel={user.login} />
        </div>
      </MobileNavProvider>
    </NavCollapseProvider>
  );
}
