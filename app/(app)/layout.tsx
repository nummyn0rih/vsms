import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/session";
import { getActiveAlerts } from "@/server/alert-rules/alerts";
import { Sidebar } from "@/components/layout/Sidebar";
import { NavCollapseProvider } from "@/components/layout/sidebar-collapse";

// Оболочка авторизованной зоны. proxy.ts уже редиректит гостей на /login,
// но дублируем проверку, т.к. отсюда берём роль для фильтрации меню.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // V1.1: дефицит-бейджи в сайдбаре. Этот layout оборачивает ВЕСЬ (app)-сегмент —
  // значит 3 доп. запроса (rules + 2 баланса) на каждый переход между страницами,
  // не только /packaging и /ingredients. Принятая цена read-only фичи на текущем
  // масштабе, кэш-слой не вводим в этом проходе.
  const alerts = await getActiveAlerts();

  return (
    <NavCollapseProvider>
      <div className="flex h-screen">
        <Sidebar
          role={user.role}
          userLabel={user.login}
          badges={{ "/packaging": alerts.tareCount, "/ingredients": alerts.ingredientCount }}
        />
        <main className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="pt-6">{children}</div>
        </main>
      </div>
    </NavCollapseProvider>
  );
}
