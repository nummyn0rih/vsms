"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { parseDateUTC, seasonYearOf, subtractWorkdays } from "@/server/shipments/workdays";
import { getBoardWeek } from "./board";
import type { BoardWeek } from "./schema";

const ENTITY = "Shipment";

// Перехват RBAC → ActionResult (страницу не валим). Образец shipments/actions.
function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "UNAUTHENTICATED" ? "Требуется вход" : "Недостаточно прав",
    };
  }
  return null;
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

// Перенос отгрузки на другой рабочий день (B5-1b, drag&drop доски). admin-only.
// planned: прибытие = targetDate, отправление = targetDate − 2 рабочих дня.
// sent: отправление НЕ меняем, прибытие = targetDate (гард: прибытие > отправления).
// arrived/accepted — перенос запрещён. Прошлый день — запрещён для всех.
export async function moveShipmentToDay(
  shipmentId: number,
  targetDateISO: string,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const target = parseDateUTC(targetDateISO);
    if (Number.isNaN(target.getTime())) {
      return { ok: false, error: "Некорректная дата" };
    }
    if (targetDateISO < isoOf(new Date())) {
      return { ok: false, error: "Нельзя переносить в прошлый день" };
    }

    const sh = await prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!sh) return { ok: false, error: "Отгрузка не найдена" };
    if (sh.status === "arrived" || sh.status === "accepted") {
      return { ok: false, error: "Прибывшую/принятую отгрузку нельзя переносить" };
    }

    const oldArrival = sh.arrival_date ? isoOf(sh.arrival_date) : null;
    if (oldArrival === targetDateISO) return { ok: true }; // no-op

    const cfg = await prisma.seasonConfig.findUnique({
      where: { season_year: seasonYearOf(target) },
    });

    let newDeparture = sh.departure_date;
    const changes: Parameters<typeof logChange>[0] = [
      {
        entity: ENTITY,
        entityId: shipmentId,
        field: "arrival_date",
        oldValue: oldArrival,
        newValue: targetDateISO,
      },
    ];

    if (sh.status === "sent") {
      // sent: отправление зафиксировано, прибытие не может быть раньше/равно ему.
      if (sh.departure_date && target <= sh.departure_date) {
        return { ok: false, error: "Прибытие не может быть раньше отправления" };
      }
    } else {
      // planned: пересчитываем отправление = прибытие − 2 рабочих дня.
      newDeparture = subtractWorkdays(target, 2, cfg);
      changes.push({
        entity: ENTITY,
        entityId: shipmentId,
        field: "departure_date",
        oldValue: sh.departure_date ? isoOf(sh.departure_date) : null,
        newValue: isoOf(newDeparture),
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipmentId },
        data: { arrival_date: target, departure_date: newDeparture },
      });
      await logChange(changes, Number(user.id), tx);
    });

    revalidatePath("/planner");
    revalidatePath("/shipments");
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось перенести отгрузку" };
  }
}
