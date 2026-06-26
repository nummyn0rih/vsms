"use server";

import { requireRole } from "@/server/auth/session";
import { getBoardWeek } from "./board";
import type { BoardWeek } from "./schema";

// Загрузка недели доски для клиента (смена недели — на клиенте, как в «Плане»).
// Чтение доступно всем аутентифицированным. Зеркало loadPlanWeek.
export async function loadBoardWeek(args: {
  seasonYear: number;
  isoYear: number;
  isoWeek: number;
}): Promise<BoardWeek | null> {
  try {
    await requireRole();
    return await getBoardWeek(args);
  } catch {
    return null;
  }
}
