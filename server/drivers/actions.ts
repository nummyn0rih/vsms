"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { driverSchema, type DriverInput } from "./schema";

const ENTITY = "Driver";
const PATH = "/reference/drivers";

// transport_company_id из Select (строка) → число. FK-целостность проверит Prisma.
function toCompanyId(v: string): number {
  return Number(v);
}

function norm(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

// Единый перехват ошибок RBAC → ActionResult (страницу не валим).
function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

// Сплошной список водителей всех ТК. Фильтры комбинируются (компания + поиск
// одновременно, оба в where как И-условие).
export async function listDrivers(params?: {
  q?: string;
  companyId?: number;
  includeInactive?: boolean;
}) {
  const q = params?.q?.trim();
  return prisma.driver.findMany({
    where: {
      ...(params?.includeInactive ? {} : { active: true }),
      ...(q ? { full_name: { contains: q, mode: "insensitive" } } : {}),
      ...(params?.companyId ? { transport_company_id: params.companyId } : {}),
    },
    include: { transportCompany: { select: { name: true } } },
    orderBy: { full_name: "asc" },
  });
}

export async function createDriver(input: DriverInput): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = driverSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const created = await prisma.driver.create({
      data: {
        full_name: parsed.data.full_name,
        phone: parsed.data.phone,
        transport_company_id: toCompanyId(parsed.data.transport_company_id),
        info: norm(parsed.data.info),
      },
    });

    await logChange(
      { entity: ENTITY, entityId: created.id, field: "created", newValue: created.full_name },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось создать водителя" };
  }
}

export async function updateDriver(
  id: number,
  input: DriverInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = driverSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const existing = await prisma.driver.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Водитель не найден" };

    const nextCompany = toCompanyId(parsed.data.transport_company_id);

    // Диф изменённых полей → отдельная запись в ChangeLog на каждое (BR-16).
    const changes = [
      { field: "full_name", oldValue: existing.full_name, newValue: parsed.data.full_name },
      { field: "phone", oldValue: existing.phone, newValue: parsed.data.phone },
      {
        field: "transport_company_id",
        oldValue: String(existing.transport_company_id),
        newValue: String(nextCompany),
      },
      { field: "info", oldValue: existing.info, newValue: norm(parsed.data.info) },
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.driver.update({
      where: { id },
      data: {
        full_name: parsed.data.full_name,
        phone: parsed.data.phone,
        transport_company_id: nextCompany,
        info: norm(parsed.data.info),
      },
    });

    if (changes.length > 0) {
      await logChange(
        changes.map((c) => ({ entity: ENTITY, entityId: id, ...c })),
        Number(user.id),
      );
    }

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить" };
  }
}

// Soft delete (BR-15) в обе стороны: active=false/true одной операцией.
export async function setDriverActive(
  id: number,
  active: boolean,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.driver.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Водитель не найден" };
    if (existing.active === active) return { ok: true }; // идемпотентно

    await prisma.driver.update({ where: { id }, data: { active } });

    await logChange(
      {
        entity: ENTITY,
        entityId: id,
        field: "active",
        oldValue: String(existing.active),
        newValue: String(active),
      },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось изменить статус" };
  }
}
