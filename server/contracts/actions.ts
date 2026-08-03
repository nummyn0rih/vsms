"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth/session";
import { failWithLog } from "@/server/action-result";
import { logChange, type ChangeEntry } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import {
  contractSchema,
  type ContractInput,
  type ContractListRow,
  type ContractDetail,
  type ContractDetailView,
  type CultureVolume,
  type FarmerOption,
  type SeasonOption,
  type CultureOption,
} from "./schema";
import { ContractLinesError, persistContractLines } from "./lines";
import { getContractExecution } from "./execution";

const ENTITY = "Contract";
const PATH = "/contracts";

// Ошибка FK при удалении строки, на которую ссылается ShipmentItem/CalibreResult
// (onDelete: Restrict). P2003 = нарушение FK, P2014 = нарушение обязательной связи.
function isRestrictError(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.code === "P2003" || e.code === "P2014")
  );
}

// Строка занята приёмкой — ожидаемый исход с адресным текстом, а не поломка: в лог не
// шумим и сообщение отдаём как есть (эталон — toValidationFail в shipments/actions.ts).
function toLinesFail(e: unknown): { ok: false; error: string } | null {
  return e instanceof ContractLinesError ? { ok: false, error: e.message } : null;
}

export async function listContracts(params?: {
  farmerId?: number;
  season?: number;
}): Promise<ContractListRow[]> {
  await requireRole();

  const contracts = await prisma.contract.findMany({
    where: {
      ...(params?.farmerId ? { farmer_id: params.farmerId } : {}),
      ...(params?.season ? { season_year: params.season } : {}),
    },
    include: {
      farmer: { select: { name: true } },
      lines: { include: { culture: { select: { name: true, color: true } } } },
    },
    orderBy: [{ season_year: "desc" }, { id: "desc" }],
  });

  return contracts.map((c) => {
    // Σ тонн по культуре (просто сумма объёмов строк, без выполнения).
    const byCulture = new Map<number, CultureVolume>();
    for (const line of c.lines) {
      const prev = byCulture.get(line.culture_id);
      const tons = Number(line.volume_tons);
      if (prev) {
        prev.tons += tons;
      } else {
        byCulture.set(line.culture_id, {
          culture_id: line.culture_id,
          culture_name: line.culture.name,
          color: line.culture.color,
          tons,
        });
      }
    }

    return {
      id: c.id,
      farmer_id: c.farmer_id,
      farmer_name: c.farmer.name,
      season_year: c.season_year,
      lines_count: c.lines.length,
      volume_by_culture: [...byCulture.values()].sort((a, b) =>
        a.culture_name.localeCompare(b.culture_name),
      ),
    };
  });
}

export async function getContract(id: number): Promise<ContractDetail | null> {
  await requireRole();

  const c = await prisma.contract.findUnique({
    where: { id },
    include: {
      farmer: { select: { name: true } },
      lines: {
        include: { culture: { select: { name: true, color: true } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!c) return null;

  return {
    id: c.id,
    farmer_id: c.farmer_id,
    farmer_name: c.farmer.name,
    season_year: c.season_year,
    notes: c.notes ?? "",
    lines: c.lines.map((l) => ({
      id: l.id,
      culture_id: l.culture_id,
      culture_name: l.culture.name,
      color: l.culture.color,
      label: l.label ?? "",
      volume_tons: l.volume_tons.toString(),
      price_per_kg: l.price_per_kg.toString(),
    })),
  };
}

// Карточка контракта с живым выполнением/стоимостью (C3d). Детали (getContract) +
// расчёт C3a (getContractExecution, гейт чтения admin/operator/user внутри) мёржим по
// line.id ↔ exec.lineId. Строки без принятого веса getContractExecution всё равно
// возвращает (мапит по ВСЕМ строкам) → нули, paid=false.
export async function getContractView(
  id: number,
): Promise<ContractDetailView | null> {
  await requireRole();

  const detail = await getContract(id);
  if (!detail) return null;

  const exec = await getContractExecution({
    contractId: id,
    season: detail.season_year,
  });
  const byLine = new Map(exec.lines.map((e) => [e.lineId, e]));

  return {
    ...detail,
    hasMissingLine: exec.hasMissingLine,
    lines: detail.lines.map((l) => {
      const e = byLine.get(l.id);
      return {
        ...l,
        acceptedKg: e?.acceptedKg ?? 0,
        targetKg: e?.targetKg ?? 0,
        pct: e?.pct ?? 0,
        remainingKg: e?.remainingKg ?? 0,
        surchargeKg: e?.surchargeKg ?? 0,
        paidKg: e?.paidKg ?? 0,
        costRub: e?.cost ?? 0,
        paid: e?.paid ?? false,
      };
    }),
  };
}

// Опции Select'ов: активные фермеры, сезоны из SeasonConfig, активные культуры.
export async function listContractOptions(): Promise<{
  farmers: FarmerOption[];
  seasons: SeasonOption[];
  cultures: CultureOption[];
}> {
  await requireRole();

  const [farmers, seasons, cultures] = await Promise.all([
    prisma.farmer.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.seasonConfig.findMany({
      select: { season_year: true },
      orderBy: { season_year: "desc" },
    }),
    prisma.culture.findMany({
      where: { active: true },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { farmers, seasons, cultures };
}

export async function createContract(
  input: ContractInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = contractSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    // Контракт + строки — атомарно (либо всё, либо ничего), как калибры.
    await prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: {
          farmer_id: Number(parsed.data.farmer_id),
          season_year: Number(parsed.data.season_year),
          notes: parsed.data.notes?.trim() || null,
        },
      });

      // Снимок «до» пуст → диф даёт только создание, по записи на строку (id известны).
      const lines = await persistContractLines(tx, created.id, parsed.data.lines);

      await logChange(
        [
          { entity: ENTITY, entityId: created.id, field: "created", newValue: String(created.id) },
          ...lines.entries,
        ],
        Number(user.id),
        tx,
      );
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    const linesFail = toLinesFail(e);
    if (linesFail) return linesFail;
    if (isRestrictError(e)) {
      return { ok: false, error: "Строка используется в отгрузках/приёмке, удалить нельзя" };
    }
    return failWithLog(e, "Не удалось создать контракт");
  }
}

export async function updateContract(
  id: number,
  input: ContractInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = contractSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const existing = await prisma.contract.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Контракт не найден" };

    // Диф полей шапки → отдельная запись в ChangeLog на каждое (BR-16).
    const nextNotes = parsed.data.notes?.trim() || null;
    const nextFarmerId = Number(parsed.data.farmer_id);
    const nextSeason = Number(parsed.data.season_year);
    const changes = [
      {
        field: "farmer_id",
        oldValue: String(existing.farmer_id),
        newValue: String(nextFarmerId),
      },
      {
        field: "season_year",
        oldValue: String(existing.season_year),
        newValue: String(nextSeason),
      },
      { field: "notes", oldValue: existing.notes ?? null, newValue: nextNotes },
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id },
        data: {
          farmer_id: nextFarmerId,
          season_year: nextSeason,
          notes: nextNotes,
        },
      });

      // Диф строк по id: правки точечные, id строк не меняются (на них держатся привязки
      // ShipmentItem/CalibreResult). Записи журнала — по строке и полю, сводки больше нет.
      const lines = await persistContractLines(tx, id, parsed.data.lines);

      const entries: ChangeEntry[] = [
        ...changes.map((c) => ({ entity: ENTITY, entityId: id, ...c })),
        ...lines.entries,
      ];
      // Сохранение без единой правки не оставляет следа (иначе аудит зашумляется), а
      // logChange на пустом списке пишет warn — поэтому зовём его только по делу.
      if (entries.length > 0) await logChange(entries, Number(user.id), tx);
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    const linesFail = toLinesFail(e);
    if (linesFail) return linesFail;
    if (isRestrictError(e)) {
      // Страховка на гонку: ссылка появилась между гардом и удалением.
      return { ok: false, error: "Строка используется в отгрузках/приёмке, удалить нельзя" };
    }
    return failWithLog(e, "Не удалось сохранить");
  }
}

// Физическое удаление контракта (Cascade снимет строки). Контракт — операционная
// сущность, не справочник: soft-delete не нужен. Restrict от ShipmentItem на строках
// → понятное сообщение (сейчас ссылок нет).
export async function deleteContract(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.contract.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Контракт не найден" };

    await prisma.contract.delete({ where: { id } });

    await logChange(
      { entity: ENTITY, entityId: id, field: "deleted", oldValue: String(id) },
      Number(user.id),
    );

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    if (isRestrictError(e)) {
      return { ok: false, error: "Контракт используется в отгрузках/приёмке, удалить нельзя" };
    }
    return failWithLog(e, "Не удалось удалить контракт");
  }
}
