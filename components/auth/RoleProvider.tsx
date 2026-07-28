"use client";

import { createContext, useContext } from "react";

import type { Role } from "@/lib/generated/prisma/client";

// Роль текущего пользователя для клиентских гейтов. Питается пропом из серверного
// app/layout.tsx — никакого клиентского состояния сессии.
//
// Почему не useSession: SessionProvider (next-auth v5) кладёт проп session в useState с
// ленивым инициализатором — тот срабатывает один раз при монтировании, и при клиентской
// навигации новое значение пропа в состояние уже не попадает. Отсюда «пропадающие»
// админские элементы до F5. Здесь значение берётся ПРЯМО из пропа на каждом рендере:
// никаких useState/useEffect/useMemo — иначе воспроизведём тот же дефект.
//
// ВНИМАНИЕ: это только UX. Серверная проверка (requireRole) обязательна всё равно.
const RoleContext = createContext<Role | null>(null);

export function RoleProvider({
  role,
  children,
}: {
  role: Role | null;
  children: React.ReactNode;
}) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): Role | null {
  return useContext(RoleContext);
}
