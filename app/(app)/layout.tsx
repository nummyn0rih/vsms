import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/session";
import { Sidebar } from "@/components/layout/Sidebar";

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
    <div className="flex h-screen">
      <Sidebar role={user.role} userLabel={user.login} />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
