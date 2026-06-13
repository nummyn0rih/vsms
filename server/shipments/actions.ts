"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import {
  shipmentSchema,
  type ShipmentInput,
  type ShipmentListRow,
  type ShipmentDetail,
  type ShipmentItemRow,
  type ShipmentOptions,
  type ShipmentTarePreview,
} from "./schema";
import { persistShipmentItems, ShipmentValidationError } from "./items";
import {
  calcPackagingUnits,
  loadPackagingContext,
  tripleKey,
  FACTORY_LOCATION_ID,
} from "./packaging";
import {
  isFactoryWorkday,
  parseDateUTC,
  seasonYearOf,
  weekdayName,
} from "./workdays";

const ENTITY = "Shipment";
const PATH = "/shipments";

// Единый перехват ошибок RBAC → ActionResult (страницу не валим). Образец contracts.
function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

// Date → YYYY-MM-DD (даты храним UTC-полночью, см. parseDateUTC).
function toDateString(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// DD.MM.YYYY для текста ошибки BR-11.
function formatRu(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}

// Валидация дат: BR-12 (departure<=arrival, дубль zod) + BR-11 (прибытие в рабочий
// день завода). Возвращает текст ошибки или null. Используют create и update.
async function validateDates(
  departure: string,
  arrival: string,
): Promise<string | null> {
  if (departure > arrival) {
    return "Отправление не может быть позже прибытия";
  }

  const arrivalDate = parseDateUTC(arrival);
  const seasonYear = seasonYearOf(arrivalDate);
  // null → fallback на дефолты BR-18 внутри isFactoryWorkday.
  const cfg = await prisma.seasonConfig.findUnique({
    where: { season_year: seasonYear },
  });

  if (!isFactoryWorkday(arrivalDate, cfg)) {
    return `${formatRu(arrival)} — ${weekdayName(arrivalDate)}, нерабочий день завода`;
  }
  return null;
}

type Tx = Prisma.TransactionClient;

// Сквозной счётчик по ВСЕМ отгрузкам, не переиспользуется (удаление не сдвигает
// последующие). code хранится String, значения целые → MAX(code::int)+1.
async function getNextCode(tx: Tx): Promise<string> {
  const rows = await tx.$queryRaw<{ max: number }[]>`
    SELECT COALESCE(MAX(code::int), 0) AS max FROM "Shipment"
  `;
  return String(Number(rows[0]?.max ?? 0) + 1);
}

function toValidationFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof ShipmentValidationError) {
    return { ok: false, error: e.message };
  }
  return null;
}

export async function createShipment(
  input: ShipmentInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = shipmentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const dateError = await validateDates(
      parsed.data.departure_date,
      parsed.data.arrival_date,
    );
    if (dateError) return { ok: false, error: dateError };

    const driverId = parsed.data.driver_id?.trim();
    const comment = parsed.data.comment?.trim();

    await prisma.$transaction(async (tx) => {
      const code = await getNextCode(tx);
      const created = await tx.shipment.create({
        data: {
          code,
          departure_date: parseDateUTC(parsed.data.departure_date),
          arrival_date: parseDateUTC(parsed.data.arrival_date),
          status: "planned",
          driver_id: driverId ? Number(driverId) : null,
          comment: comment || null,
          created_by: Number(user.id),
        },
      });

      const itemsSummary = await persistShipmentItems(
        tx,
        created.id,
        parsed.data.items,
      );

      await logChange(
        [
          { entity: ENTITY, entityId: created.id, field: "created", newValue: code },
          { entity: ENTITY, entityId: created.id, field: "items", newValue: itemsSummary },
        ],
        Number(user.id),
        tx,
      );
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return (
      toValidationFail(e) ??
      authFail(e) ?? { ok: false, error: "Не удалось создать отгрузку" }
    );
  }
}

export async function updateShipment(
  id: number,
  input: ShipmentInput,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.shipment.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Отгрузка не найдена" };

    // BR-19: правка только в planned. Со статуса sent — сначала откат (B2).
    if (existing.status !== "planned") {
      return {
        ok: false,
        error: "Отгрузка отправлена — сначала откат статуса, потом правка (BR-19)",
      };
    }

    const parsed = shipmentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля формы",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    const dateError = await validateDates(
      parsed.data.departure_date,
      parsed.data.arrival_date,
    );
    if (dateError) return { ok: false, error: dateError };

    const driverId = parsed.data.driver_id?.trim();
    const nextDriverId = driverId ? Number(driverId) : null;
    const nextComment = parsed.data.comment?.trim() || null;
    const nextDeparture = parseDateUTC(parsed.data.departure_date);
    const nextArrival = parseDateUTC(parsed.data.arrival_date);

    // Диф полей шапки → отдельная запись в ChangeLog на каждое (BR-16).
    const changes = [
      {
        field: "driver_id",
        oldValue: existing.driver_id != null ? String(existing.driver_id) : null,
        newValue: nextDriverId != null ? String(nextDriverId) : null,
      },
      {
        field: "departure_date",
        oldValue: toDateString(existing.departure_date),
        newValue: parsed.data.departure_date,
      },
      {
        field: "arrival_date",
        oldValue: toDateString(existing.arrival_date),
        newValue: parsed.data.arrival_date,
      },
      { field: "comment", oldValue: existing.comment ?? null, newValue: nextComment },
    ].filter((c) => c.oldValue !== c.newValue);

    await prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id },
        data: {
          driver_id: nextDriverId,
          departure_date: nextDeparture,
          arrival_date: nextArrival,
          comment: nextComment,
        },
      });

      const itemsSummary = await persistShipmentItems(tx, id, parsed.data.items);

      const entries = changes.map((c) => ({ entity: ENTITY, entityId: id, ...c }));
      entries.push({
        entity: ENTITY,
        entityId: id,
        field: "items",
        oldValue: null,
        newValue: itemsSummary,
      });
      await logChange(entries, Number(user.id), tx);
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return (
      toValidationFail(e) ??
      authFail(e) ?? { ok: false, error: "Не удалось сохранить" }
    );
  }
}

export async function deleteShipment(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const existing = await prisma.shipment.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Отгрузка не найдена" };

    // BR-19: физическое удаление разрешено ТОЛЬКО для planned.
    if (existing.status !== "planned") {
      return {
        ok: false,
        error: "Удаление запрещено: сначала откат статуса до planned (BR-19)",
      };
    }

    await prisma.$transaction(async (tx) => {
      // Позиции уйдут каскадом (ShipmentItem.shipment onDelete: Cascade).
      await tx.shipment.delete({ where: { id } });
      await logChange(
        { entity: ENTITY, entityId: id, field: "deleted", oldValue: existing.code },
        Number(user.id),
        tx,
      );
    });

    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось удалить отгрузку" };
  }
}

// --- B2: переходы статуса planned ↔ sent + авто-движение тары (BR-3, BR-13, BR-19) ---

// Позиция в объёме, нужном расчёту тары (имена — для текста/ChangeLog).
type ItemForTare = {
  farmer_id: number;
  culture_id: number;
  packaging_type_id: number | null;
  planned_weight_kg: Prisma.Decimal;
  farmer: { name: string };
  culture: { name: string };
};

type TarePlanLine = {
  packagingTypeId: number;
  packagingName: string;
  farmerId: number;
  farmerName: string;
  units: number;
};

// Считает тару по всем позициям. lines — что списать (status=ok), missing — пары
// box-культур без нормы (status=none пропускаем, движения нет). Чистый помощник:
// и предпросмотр, и отправка прогоняют один и тот же расчёт.
async function buildTarePlan(
  tx: Tx,
  items: ItemForTare[],
): Promise<{ lines: TarePlanLine[]; missing: string[] }> {
  const ctx = await loadPackagingContext(tx, items);
  const lines: TarePlanLine[] = [];
  const missing: string[] = [];

  for (const item of items) {
    const typeId = item.packaging_type_id;
    const norm =
      typeId != null
        ? ctx.normByTriple.get(tripleKey(item.farmer_id, item.culture_id, typeId))
        : null;
    const calc = calcPackagingUnits(item.planned_weight_kg, typeId, norm);

    if (calc.status === "none") continue;
    const typeName =
      typeId != null ? (ctx.nameByType.get(typeId) ?? "тара") : "тара";
    if (calc.status === "missing_norm") {
      // «культура × фермер × тип тары» — нет нормы по тройке.
      missing.push(`${item.culture.name} × ${item.farmer.name} × ${typeName}`);
      continue;
    }
    lines.push({
      packagingTypeId: calc.packagingTypeId,
      packagingName: typeName,
      farmerId: item.farmer_id,
      farmerName: item.farmer.name,
      units: calc.units,
    });
  }

  return { lines, missing };
}

const tareItemInclude = {
  farmer: { select: { name: true } },
  culture: { select: { name: true } },
} as const;

// Предпросмотр движений тары для AlertDialog «Отправить». Чтение, без записи.
export async function previewShipmentTare(
  id: number,
): Promise<ShipmentTarePreview> {
  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: { items: { include: tareItemInclude } },
  });
  if (!shipment) return { ok: false, driverMissing: false, missing: [] };

  const { lines, missing } = await buildTarePlan(prisma, shipment.items);
  const driverMissing = shipment.driver_id == null;

  if (driverMissing || missing.length > 0) {
    return { ok: false, driverMissing, missing };
  }

  return {
    ok: true,
    lines: lines.map((l) => ({
      farmerName: l.farmerName,
      packagingName: l.packagingName,
      units: l.units,
    })),
  };
}

// Сводка по типам тары для ChangeLog: «Ящик овощной ×62; Бочка 200 ×4».
function tareSummary(lines: TarePlanLine[]): string {
  const byType = new Map<string, number>();
  for (const l of lines) {
    byType.set(l.packagingName, (byType.get(l.packagingName) ?? 0) + l.units);
  }
  return [...byType].map(([name, units]) => `${name} ×${units}`).join("; ");
}

// Доменная ошибка отправки (нет нормы) — откатывает транзакцию, ловится в action.
class ShipmentSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShipmentSendError";
  }
}

// planned → sent: создаёт движения тары (фермер→завод) и переводит статус.
export async function sendShipment(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const result = await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findUnique({
        where: { id },
        include: { items: { include: tareItemInclude } },
      });
      if (!shipment) return { ok: false as const, error: "Отгрузка не найдена" };
      if (shipment.status !== "planned") {
        return { ok: false as const, error: "Отгрузка уже отправлена" };
      }
      // Водитель обязателен при отправке (на planned был опционален).
      if (shipment.driver_id == null) {
        return { ok: false as const, error: "Назначьте водителя перед отправкой" };
      }

      const { lines, missing } = await buildTarePlan(tx, shipment.items);
      if (missing.length > 0) {
        // Хотя бы одна box-культура без нормы → откат всей транзакции (throw уводит
        // в catch как обычная ошибка; см. ShipmentSendError ниже).
        throw new ShipmentSendError(
          `Нет нормы фасовки: ${missing.join("; ")}. Задайте норму в Настройках.`,
        );
      }

      if (lines.length > 0) {
        await tx.stockMovement.createMany({
          data: lines.map((l) => ({
            date: shipment.departure_date ?? new Date(),
            kind: "packaging" as const,
            packaging_type_id: l.packagingTypeId,
            quantity: l.units,
            from_location_id: l.farmerId,
            to_location_id: FACTORY_LOCATION_ID,
            from_state: "good" as const,
            to_state: "good" as const,
            movement_type: "return" as const,
            source_doc_type: "shipment" as const,
            source_doc_id: id,
          })),
        });
      }

      await tx.shipment.update({ where: { id }, data: { status: "sent" } });

      await logChange(
        [
          {
            entity: ENTITY,
            entityId: id,
            field: "status",
            oldValue: "planned",
            newValue: "sent",
          },
          {
            entity: ENTITY,
            entityId: id,
            field: "movements",
            newValue:
              lines.length > 0
                ? `${lines.length} движ.: ${tareSummary(lines)}`
                : "тары нет (навал)",
          },
        ],
        Number(user.id),
        tx,
      );

      return { ok: true as const };
    });

    if (result.ok) revalidatePath(PATH);
    return result;
  } catch (e) {
    if (e instanceof ShipmentSendError) return { ok: false, error: e.message };
    return authFail(e) ?? { ok: false, error: "Не удалось отправить отгрузку" };
  }
}

// sent → planned (только Admin): сторнирует тару обратными движениями. Исходные
// движения НЕ трогаем (аудит). Сторнируем НЕТТО по группам (тип тары × фермер) —
// при повторном цикле отправка/откат сторнируется только несторнированный остаток.
export async function revertShipmentToPlanned(id: number): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const result = await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findUnique({ where: { id } });
      if (!shipment) return { ok: false as const, error: "Отгрузка не найдена" };
      if (shipment.status !== "sent") {
        return { ok: false as const, error: "Откат возможен только из статуса «Отправлена»" };
      }

      const movements = await tx.stockMovement.findMany({
        where: {
          source_doc_type: "shipment",
          source_doc_id: id,
          kind: "packaging",
          movement_type: "return",
        },
      });

      // Нетто по (тип тары × фермер): оригиналы (→завод) минус уже созданные сторно
      // (→фермер). Ключ группы — `${packagingTypeId}:${farmerId}`.
      const net = new Map<string, { packagingTypeId: number; farmerId: number; qty: Prisma.Decimal }>();
      for (const m of movements) {
        const isOriginal = m.to_location_id === FACTORY_LOCATION_ID;
        const farmerId = isOriginal ? m.from_location_id : m.to_location_id;
        if (m.packaging_type_id == null || farmerId == null) continue;
        const key = `${m.packaging_type_id}:${farmerId}`;
        const cur = net.get(key) ?? {
          packagingTypeId: m.packaging_type_id,
          farmerId,
          qty: new Prisma.Decimal(0),
        };
        cur.qty = isOriginal ? cur.qty.plus(m.quantity) : cur.qty.minus(m.quantity);
        net.set(key, cur);
      }

      const storno = [...net.values()].filter((g) => g.qty.gt(0));
      if (storno.length > 0) {
        await tx.stockMovement.createMany({
          data: storno.map((g) => ({
            date: new Date(),
            kind: "packaging" as const,
            packaging_type_id: g.packagingTypeId,
            quantity: g.qty,
            from_location_id: FACTORY_LOCATION_ID,
            to_location_id: g.farmerId,
            from_state: "good" as const,
            to_state: "good" as const,
            movement_type: "return" as const,
            source_doc_type: "shipment" as const,
            source_doc_id: id,
          })),
        });
      }

      await tx.shipment.update({ where: { id }, data: { status: "planned" } });

      await logChange(
        [
          {
            entity: ENTITY,
            entityId: id,
            field: "status",
            oldValue: "sent",
            newValue: "planned",
          },
          {
            entity: ENTITY,
            entityId: id,
            field: "storno",
            newValue: `сторно тары: ${storno.length} групп`,
          },
        ],
        Number(user.id),
        tx,
      );

      return { ok: true as const };
    });

    if (result.ok) revalidatePath(PATH);
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось откатить отгрузку" };
  }
}

// --- Чтение (доступно всем ролям) ---

function mapItem(item: {
  id: number;
  farmer_id: number;
  culture_id: number;
  planned_weight_kg: Prisma.Decimal;
  packaging_type_id: number | null;
  contract_line_id: number | null;
  farmer: { name: string };
  culture: { name: string; color: string };
  packagingType: { name: string } | null;
  contractLine: { label: string | null } | null;
}): ShipmentItemRow {
  return {
    id: item.id,
    farmer_id: item.farmer_id,
    farmer_name: item.farmer.name,
    culture_id: item.culture_id,
    culture_name: item.culture.name,
    color: item.culture.color,
    planned_weight_kg: item.planned_weight_kg.toString(),
    packaging_type_id: item.packaging_type_id,
    packaging_type_name: item.packagingType?.name ?? null,
    contract_line_id: item.contract_line_id,
    contract_line_label: item.contractLine?.label ?? null,
  };
}

const itemInclude = {
  farmer: { select: { name: true } },
  culture: { select: { name: true, color: true } },
  packagingType: { select: { name: true } },
  contractLine: { select: { label: true } },
} as const;

export async function getShipments(): Promise<ShipmentListRow[]> {
  const shipments = await prisma.shipment.findMany({
    include: {
      items: { include: itemInclude, orderBy: { id: "asc" } },
      driver: { include: { transportCompany: { select: { name: true } } } },
    },
    orderBy: { arrival_date: "desc" },
  });

  return shipments.map((s) => ({
    id: s.id,
    code: s.code,
    status: s.status,
    departure_date: toDateString(s.departure_date),
    arrival_date: toDateString(s.arrival_date),
    driver_name: s.driver?.full_name ?? null,
    transport_company_name: s.driver?.transportCompany.name ?? null,
    comment: s.comment,
    items: s.items.map(mapItem),
  }));
}

export async function getShipment(id: number): Promise<ShipmentDetail | null> {
  const s = await prisma.shipment.findUnique({
    where: { id },
    include: { items: { include: itemInclude, orderBy: { id: "asc" } } },
  });
  if (!s) return null;

  return {
    id: s.id,
    status: s.status,
    driver_id: s.driver_id,
    departure_date: toDateString(s.departure_date),
    arrival_date: toDateString(s.arrival_date),
    comment: s.comment ?? "",
    items: s.items.map(mapItem),
  };
}

// Опции Select'ов формы: активные водители (+ТК), активные фермеры/культуры,
// строки контрактов ТЕКУЩЕГО сезона (клиент фильтрует по фермеру+культуре).
export async function listShipmentOptions(): Promise<ShipmentOptions> {
  const currentSeason = seasonYearOf(new Date());

  const [drivers, farmers, cultures, lines, norms] = await Promise.all([
    prisma.driver.findMany({
      where: { active: true },
      include: { transportCompany: { select: { name: true } } },
      orderBy: { full_name: "asc" },
    }),
    prisma.farmer.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.culture.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        color: true,
        packagingTypes: {
          select: {
            is_default: true,
            packagingType: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.contractLine.findMany({
      where: { contract: { season_year: currentSeason } },
      select: {
        id: true,
        culture_id: true,
        label: true,
        price_per_kg: true,
        contract: { select: { farmer_id: true } },
      },
      orderBy: { id: "asc" },
    }),
    prisma.packagingNorm.findMany({
      select: {
        farmer_id: true,
        culture_id: true,
        packaging_type_id: true,
        avg_unit_weight_kg: true,
      },
    }),
  ]);

  return {
    drivers: drivers.map((d) => ({
      id: d.id,
      full_name: d.full_name,
      transport_company_name: d.transportCompany.name,
    })),
    farmers,
    cultures: cultures.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      packagingTypes: c.packagingTypes.map((pt) => ({
        id: pt.packagingType.id,
        name: pt.packagingType.name,
        is_default: pt.is_default,
      })),
    })),
    contractLines: lines.map((l) => ({
      id: l.id,
      farmer_id: l.contract.farmer_id,
      culture_id: l.culture_id,
      label: l.label,
      price_per_kg: l.price_per_kg.toString(),
    })),
    packagingNorms: norms.map((n) => ({
      farmer_id: n.farmer_id,
      culture_id: n.culture_id,
      packaging_type_id: n.packaging_type_id,
      value: n.avg_unit_weight_kg.toString(),
    })),
  };
}
