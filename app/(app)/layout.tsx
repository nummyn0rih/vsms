import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/session";
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

  return (
    <NavCollapseProvider>
      <div className="flex h-screen">
        <Sidebar role={user.role} userLabel={user.login} />
        <main className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="pt-6">{children}</div>
        </main>
      </div>
    </NavCollapseProvider>
  );
}
