"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import {
  transportCompanySchema,
  type TransportCompanyInput,
  type TransportCompanyOption,
} from "./schema";

const ENTITY = "TransportCompany";
const PATH = "/reference/transport-companies";

// Пустая строка/пробелы → null (необязательное поле).
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

export async function listTransportCompanies(params?: {
  q?: string;
  includeInactive?: boolean;
}) {
  const q = params?.q?.trim();
  return prisma.transportCompany.findMany({
    where: {
      ...(params?.includeInactive ? {} : { active: true }),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
  });
}

// Active-компании для Select формы водителя и фильтра по компании.
export async function listTransportCompanyOptions(): Promise<
  TransportCompanyOption[]
> {
  return prisma.transportCompany.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function createTransportCompany(
  input: TransportCompanyInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = transportCompanySchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const created = await prisma.transportCompany.create({
      data: {
        name: parsed.data.name,
        notes: norm(parsed.data.notes),
      },
    });

    await logChange(
      { entity: ENTITY, entityId: created.id, field: "created", newValue: created.name },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось создать компанию" };
  }
}

export async function updateTransportCompany(
  id: number,
  input: TransportCompanyInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = transportCompanySchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const existing = await prisma.transportCompany.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Компания не найдена" };

    // Диф изменённых полей → отдельная запись в ChangeLog на каждое (BR-16).
    const changes = [
      { field: "name", oldValue: existing.name, newValue: parsed.data.name },
      { field: "notes", oldValue: existing.notes, newValue: norm(parsed.data.notes) },
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.transportCompany.update({
      where: { id },
      data: {
        name: parsed.data.name,
        notes: norm(parsed.data.notes),
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
export async function setTransportCompanyActive(
  id: number,
  active: boolean,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.transportCompany.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Компания не найдена" };
    if (existing.active === active) return { ok: true }; // идемпотентно

    await prisma.transportCompany.update({ where: { id }, data: { active } });

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
