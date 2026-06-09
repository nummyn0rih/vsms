"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { farmerSchema, type FarmerContacts, type FarmerInput } from "./schema";

const ENTITY = "Farmer";
const PATH = "/reference/farmers";

// Пустую строку заметок храним как null, иначе тримленную строку.
function norm(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

// contacts пишем в Json-колонку ОБЪЕКТОМ: phone обязателен,
// пустые optional-поля выкидываем (без email:"" и т.п.).
function normalizeContacts(c: FarmerContacts) {
  const out: Record<string, string> = { phone: c.phone.trim() };
  if (c.contactPerson?.trim()) out.contactPerson = c.contactPerson.trim();
  if (c.messenger?.trim()) out.messenger = c.messenger.trim();
  if (c.email?.trim()) out.email = c.email.trim();
  return out;
}

// JsonValue → строка для сравнения/лога (contacts хранится объектом).
function contactsLog(v: unknown): string | null {
  return v == null ? null : JSON.stringify(v);
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

export async function listFarmers(params?: {
  q?: string;
  includeInactive?: boolean;
}) {
  const q = params?.q?.trim();
  return prisma.farmer.findMany({
    where: {
      ...(params?.includeInactive ? {} : { active: true }),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
  });
}

export async function createFarmer(input: FarmerInput): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = farmerSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const farmer = await prisma.farmer.create({
      data: {
        name: parsed.data.name,
        // phone обязателен ⇒ contacts всегда объект, Prisma.DbNull не нужен.
        contacts: normalizeContacts(parsed.data.contacts),
        notes: norm(parsed.data.notes),
      },
    });

    await logChange(
      { entity: ENTITY, entityId: farmer.id, field: "created", newValue: farmer.name },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось создать фермера" };
  }
}

export async function updateFarmer(
  id: number,
  input: FarmerInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = farmerSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const existing = await prisma.farmer.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Фермер не найден" };

    const nextContacts = normalizeContacts(parsed.data.contacts);
    const next = {
      name: parsed.data.name,
      notes: norm(parsed.data.notes),
    };

    // Диф изменённых полей → отдельная запись в ChangeLog на каждое (BR-16).
    const changes = [
      { field: "name", oldValue: existing.name, newValue: next.name },
      {
        field: "contacts",
        oldValue: contactsLog(existing.contacts),
        newValue: contactsLog(nextContacts),
      },
      { field: "notes", oldValue: existing.notes, newValue: next.notes },
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.farmer.update({
      where: { id },
      data: { ...next, contacts: nextContacts },
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
// Эталонный паттерн для всех справочников.
export async function setFarmerActive(
  id: number,
  active: boolean,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.farmer.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Фермер не найден" };
    if (existing.active === active) return { ok: true }; // идемпотентно

    await prisma.farmer.update({ where: { id }, data: { active } });

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
