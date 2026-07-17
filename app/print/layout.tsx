import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import "./print.css";

// Bare-layout печатных роутов: только auth-гард, БЕЗ Sidebar/Mobile-хрома (прецедент —
// app/login). print.css грузится лишь здесь, поэтому @page/скрытие хрома не трогают (app).
export default async function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return children;
}
