"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/server/auth/session";
import { logChange, type ChangeEntry } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { seasonYearOf } from "@/server/shipments/workdays";
import { withSeasonPrefix, stripSeasonPrefix } from "./accepted";
import { calcIngredientConsumption } from "./ingredients";
import { revalidateStockDashboards } from "@/server/inventory/revalidate";
import {
  saveActSchema,
  revertActSchema,
  type SaveActInput,
  type ActContext,
} from "./schema";

const SHIPMENT = "Shipment";
const ITEM = "ShipmentItem";
const ACT = "AcceptanceAct";
const PATH = "/acceptance";
const FEED_PATH = "/shipments";

function authFail(e: unknown): { ok: false; error: string } | null {
  if (e instanceof AuthError) {
    return {
      ok: false,
      error: e.code === "FORBIDDEN" ? "Нет прав" : "Требуется вход",
    };
  }
  return null;
}

function revalidate() {
  revalidatePath(PATH);
  revalidatePath(FEED_PATH);
  revalidateStockDashboards();
}

function toDateStr(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// Данные формы акта для одной позиции. Чистая выборка (read-only). null = позиция
// не найдена. Строки контракта — фермер+культура+сезон позиции (BR-8).
export async function getActContext({
  shipmentItemId,
}: {
  shipmentItemId: number;
}): Promise<ActContext | null> {
  const item = await prisma.shipmentItem.findUnique({
    where: { id: shipmentItemId },
    select: {
      id: true,
      farmer_id: true,
      culture_id: true,
      actual_weight_kg: true,
      contract_line_id: true,
      culture: {
        select: {
          name: true,
          color: true,
          acceptance_type: true,
          calibreScheme: {
            select: {
              ranges: {
                select: {
                  id: true,
                  label: true,
                  min_cm: true,
                  max_cm: true,
                  is_accepted: true,
                },
                orderBy: { id: "asc" },
              },
            },
          },
        },
      },
      farmer: { select: { name: true } },
      shipment: {
        select: {
          id: true,
          code: true,
          status: true,
          arrival_date: true,
          departure_date: true,
          driver: {
            select: {
              full_name: true,
              transportCompany: { select: { name: true } },
            },
          },
        },
      },
      acceptanceAct: {
        select: {
          act_number: true,
          brak_percent: true,
          calibreResults: {
            select: {
              calibre_range_id: true,
              percent: true,
              contract_line_id: true,
            },
          },
        },
      },
    },
  });
  if (!item) return null;

  // Сезон по дате прибытия (или отправления) машины — как в отгрузках.
  const refDate = item.shipment.arrival_date ?? item.shipment.departure_date ?? new Date();
  const season = seasonYearOf(refDate);

  const lines = await prisma.contractLine.findMany({
    where: {
      culture_id: item.culture_id,
      contract: { farmer_id: item.farmer_id, season_year: season },
    },
    select: { id: true, label: true, price_per_kg: true },
    orderBy: { id: "asc" },
  });

  // «Последняя непринятая» — у машины ровно одна позиция без акта (эта).
  const unaccepted = await prisma.shipmentItem.count({
    where: { shipment_id: item.shipment.id, acceptanceAct: null },
  });

  return {
    shipmentItemId: item.id,
    acceptanceType: item.culture.acceptance_type as "simple" | "calibre",
    cultureName: item.culture.name,
    cultureColor: item.culture.color,
    farmerName: item.farmer.name,
    machineCode: item.shipment.code,
    departureDate: toDateStr(item.shipment.departure_date),
    driverName: item.shipment.driver?.full_name ?? null,
    transportCompanyName: item.shipment.driver?.transportCompany.name ?? null,
    machineStatus: item.shipment.status as "sent" | "arrived" | "accepted",
    actualKg:
      item.actual_weight_kg != null ? item.actual_weight_kg.toNumber() : null,
    contractLines: lines.map((l) => ({
      id: l.id,
      label: l.label,
      pricePerKg: l.price_per_kg.toString(),
    })),
    autoLineId: lines.length === 1 ? lines[0].id : null,
    isLastUnaccepted: item.acceptanceAct == null && unaccepted === 1,
    calibreRanges: (item.culture.calibreScheme?.ranges ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      minCm: r.min_cm != null ? r.min_cm.toString() : null,
      maxCm: r.max_cm != null ? r.max_cm.toString() : null,
      isAccepted: r.is_accepted,
    })),
    itemLineId: item.contract_line_id,
    existing: item.acceptanceAct
      ? {
          actNumber: stripSeasonPrefix(item.acceptanceAct.act_number, season),
          brakPercent:
            item.acceptanceAct.brak_percent != null
              ? item.acceptanceAct.brak_percent.toNumber()
              : 0,
          contractLineId: item.contract_line_id,
          calibres: item.acceptanceAct.calibreResults.map((c) => ({
            calibreRangeId: c.calibre_range_id,
            percent: c.percent.toNumber(),
            contractLineId: c.contract_line_id,
          })),
        }
      : null,
  };
}

// Приёмка позиции актом (C1, simple+calibre). operator/admin. Принятый вес —
// производное, не пишем (BR-10). При приёмке ПОСЛЕДНЕЙ позиции машина авто-→accepted
// (BR-13). Калибр: Σ% категорий = 100% годного, CalibreResult на каждую категорию.
export async function saveAct(input: SaveActInput): Promise<ActionResult> {
  try {
    const user = await requireRole("operator", "admin");

    const parsed = saveActSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Проверьте поля акта",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }
    const { shipmentItemId, actNumber, brakPercent } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.shipmentItem.findUnique({
        where: { id: shipmentItemId },
        select: {
          farmer_id: true,
          culture_id: true,
          actual_weight_kg: true,
          contract_line_id: true,
          culture: {
            select: {
              acceptance_type: true,
              calibreScheme: {
                select: { ranges: { select: { id: true, is_accepted: true } } },
              },
            },
          },
          shipment: {
            select: {
              id: true,
              status: true,
              arrival_date: true,
              departure_date: true,
            },
          },
          acceptanceAct: { select: { id: true } },
        },
      });
      if (!item) return { ok: false as const, error: "Позиция не найдена" };

      // BR-25: без фактического веса приёмка невозможна.
      if (item.actual_weight_kg == null) {
        return { ok: false as const, error: "Сначала внесите фактический вес" };
      }

      // BR-7: строка должна быть того же фермера и культуры.
      const lineMatches = async (lineId: number): Promise<boolean> => {
        const l = await tx.contractLine.findUnique({
          where: { id: lineId },
          select: { culture_id: true, contract: { select: { farmer_id: true } } },
        });
        return (
          l != null &&
          l.culture_id === item.culture_id &&
          l.contract.farmer_id === item.farmer_id
        );
      };

      const isCalibre = item.culture.acceptance_type === "calibre";
      let resolvedLineId: number | null = null;
      let calibreData: {
        calibre_range_id: number;
        percent: Prisma.Decimal;
        contract_line_id: number | null;
      }[] = [];

      if (isCalibre) {
        // Калибр (BR-10, одноступенчато): Σ% категорий + brak% = 100% от факта;
        // принятые категории обязаны иметь строку.
        const calibres = parsed.data.calibres;
        if (!calibres || calibres.length === 0) {
          return { ok: false as const, error: "Заполните калибровочные категории" };
        }
        const ranges = item.culture.calibreScheme?.ranges ?? [];
        const acceptedById = new Map(ranges.map((r) => [r.id, r.is_accepted]));

        for (const c of calibres) {
          if (!acceptedById.has(c.calibreRangeId)) {
            return { ok: false as const, error: "Категория не из схемы культуры" };
          }
        }
        const sum = calibres.reduce((s, c) => s + c.percent, 0) + brakPercent;
        if (Math.abs(sum - 100) > 0.01) {
          return {
            ok: false as const,
            error: "Сумма категорий и брака = 100% факта (BR-10)",
          };
        }

        let acceptedCount = 0;
        for (const c of calibres) {
          const accepted = acceptedById.get(c.calibreRangeId) === true;
          if (accepted) {
            acceptedCount++;
            if (c.contractLineId == null) {
              return {
                ok: false as const,
                error: "Привяжите принятые категории к строке (BR-8)",
              };
            }
            if (!(await lineMatches(c.contractLineId))) {
              return {
                ok: false as const,
                error: "Строка категории — другой культуры/фермера (BR-7)",
              };
            }
            if (resolvedLineId == null) resolvedLineId = c.contractLineId;
          } else if (c.contractLineId != null) {
            if (!(await lineMatches(c.contractLineId))) {
              return {
                ok: false as const,
                error: "Строка категории — другой культуры/фермера (BR-7)",
              };
            }
          }
        }
        if (acceptedCount === 0) {
          return { ok: false as const, error: "Нужна хотя бы одна принятая категория" };
        }
        calibreData = calibres.map((c) => ({
          calibre_range_id: c.calibreRangeId,
          percent: new Prisma.Decimal(c.percent),
          contract_line_id: c.contractLineId,
        }));
      } else {
        // simple (BR-8): одна строка на позицию.
        const lineId = parsed.data.contractLineId;
        if (lineId == null) {
          return { ok: false as const, error: "Выберите строку контракта (BR-8)" };
        }
        if (!(await lineMatches(lineId))) {
          return {
            ok: false as const,
            error: "Строка контракта должна быть того же фермера и культуры (BR-8)",
          };
        }
        resolvedLineId = lineId;
      }

      // № акта уникален в рамках сезона (BR-9): хранится с префиксом года сезона.
      const refDate =
        item.shipment.arrival_date ?? item.shipment.departure_date ?? new Date();
      const season = seasonYearOf(refDate);
      const storedActNumber = withSeasonPrefix(actNumber, season);

      const isNew = item.acceptanceAct == null;
      const act = await tx.acceptanceAct.upsert({
        where: { shipment_item_id: shipmentItemId },
        create: {
          shipment_item_id: shipmentItemId,
          act_number: storedActNumber,
          brak_percent: new Prisma.Decimal(brakPercent),
        },
        update: {
          act_number: storedActNumber,
          brak_percent: new Prisma.Decimal(brakPercent),
        },
        select: { id: true },
      });

      // Калибр: полная замена результатов категорий.
      if (isCalibre) {
        await tx.calibreResult.deleteMany({ where: { acceptance_act_id: act.id } });
        await tx.calibreResult.createMany({
          data: calibreData.map((d) => ({ acceptance_act_id: act.id, ...d })),
        });
      }

      const entries = [
        {
          entity: ACT,
          entityId: shipmentItemId,
          field: isNew ? "created" : "updated",
          newValue: storedActNumber,
        },
      ];

      // BR-8: фиксируем привязку строки на позиции, если изменилась. Для калибра —
      // строка первой принятой категории (выполнение C3 читает CalibreResult).
      if (item.contract_line_id !== resolvedLineId) {
        await tx.shipmentItem.update({
          where: { id: shipmentItemId },
          data: { contract_line_id: resolvedLineId },
        });
        entries.push({
          entity: ITEM,
          entityId: shipmentItemId,
          field: "contract_line_id",
          oldValue: item.contract_line_id != null ? String(item.contract_line_id) : null,
          newValue: resolvedLineId != null ? String(resolvedLineId) : null,
        } as (typeof entries)[number]);
      }

      // BR-13: все позиции машины приняты → авто-accepted.
      const stillUnaccepted = await tx.shipmentItem.count({
        where: { shipment_id: item.shipment.id, acceptanceAct: null },
      });
      if (stillUnaccepted === 0 && item.shipment.status === "arrived") {
        await tx.shipment.update({
          where: { id: item.shipment.id },
          data: { status: "accepted" },
        });
        entries.push({
          entity: SHIPMENT,
          entityId: item.shipment.id,
          field: "status",
          oldValue: "arrived",
          newValue: "accepted",
        } as (typeof entries)[number]);
      }

      // C2 (BR-4): авто-расход ингредиентов по рецептуре культуры. База = ФАКТ
      // перевески (item.actual_weight_kg, не null по BR-25 выше). Списание у фермера
      // позиции (from=farmer, to=null — уходит в производство). Идемпотентно:
      // actual_weight у принятой позиции read-only, расход инвариантен — повторный
      // saveAct не дублирует движения. Культура без рецептуры → движений нет.
      const recipe = await tx.ingredientRecipe.findMany({
        where: { culture_id: item.culture_id },
        select: { ingredient_id: true, qty_per_kg_product: true },
      });
      let movementsCount = 0;
      const already = await tx.stockMovement.count({
        where: {
          source_doc_type: "acceptance_act",
          source_doc_id: act.id,
          kind: "ingredient",
        },
      });
      if (already === 0) {
        const consumption = calcIngredientConsumption(
          item.actual_weight_kg,
          recipe.map((r) => ({
            ingredientId: r.ingredient_id,
            qtyPerKgProduct: r.qty_per_kg_product,
          })),
        );
        if (consumption.length > 0) {
          await tx.stockMovement.createMany({
            data: consumption.map((m) => ({
              date: refDate,
              kind: "ingredient" as const,
              ingredient_id: m.ingredientId,
              quantity: m.quantity,
              from_location_id: item.farmer_id,
              to_location_id: null,
              from_state: null,
              to_state: null,
              movement_type: "consumption" as const,
              source_doc_type: "acceptance_act" as const,
              source_doc_id: act.id,
            })),
          });
          movementsCount = consumption.length;
        }
      }
      entries.push({
        entity: ACT,
        entityId: shipmentItemId,
        field: "movements",
        newValue:
          already > 0
            ? "расход ингр.: 0 движ. (уже списано)"
            : `расход ингр.: ${movementsCount} движ.`,
      } as (typeof entries)[number]);

      await logChange(entries, Number(user.id), tx);
      return { ok: true as const };
    });

    if (result.ok) revalidate();
    return result;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "№ акта занят в этом сезоне (BR-9)" };
    }
    return authFail(e) ?? { ok: false, error: "Не удалось сохранить акт" };
  }
}

// Откат приёмки позиции (admin). Удаляет акт; если машина была accepted — возвращает
// arrived (BR-13). Идемпотентно. Сторно склада — C2 (движений ещё нет).
export async function revertAct(input: {
  shipmentItemId: number;
}): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const parsed = revertActSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Некорректная позиция" };
    const { shipmentItemId } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.shipmentItem.findUnique({
        where: { id: shipmentItemId },
        select: {
          farmer_id: true,
          shipment: { select: { id: true, status: true } },
          acceptanceAct: { select: { id: true, act_number: true } },
        },
      });
      if (!item) return { ok: false as const, error: "Позиция не найдена" };
      if (item.acceptanceAct == null) return { ok: true as const }; // идемпотентно
      const act = item.acceptanceAct;

      // C2: сторно расхода ингредиентов ДО удаления акта. Исходные движения НЕ трогаем
      // (аудит). Сторнируем НЕТТО по (ingredient_id × фермер): оригинал (from=farmer,
      // to=null) плюс, уже созданное сторно (from=null, to=farmer) минус — повторный
      // откат даёт нетто 0 (идемпотентно). Паттерн revertShipmentToPlanned.
      const movements = await tx.stockMovement.findMany({
        where: {
          source_doc_type: "acceptance_act",
          source_doc_id: act.id,
          kind: "ingredient",
        },
      });
      const net = new Map<string, { ingredientId: number; farmerId: number; qty: Prisma.Decimal }>();
      for (const m of movements) {
        const isOriginal = m.to_location_id == null;
        const farmerId = isOriginal ? m.from_location_id : m.to_location_id;
        if (m.ingredient_id == null || farmerId == null) continue;
        const key = `${m.ingredient_id}:${farmerId}`;
        const cur = net.get(key) ?? {
          ingredientId: m.ingredient_id,
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
            kind: "ingredient" as const,
            ingredient_id: g.ingredientId,
            quantity: g.qty,
            from_location_id: null,
            to_location_id: g.farmerId,
            from_state: null,
            to_state: null,
            movement_type: "consumption" as const,
            source_doc_type: "acceptance_act" as const,
            source_doc_id: act.id,
          })),
        });
      }

      await tx.acceptanceAct.delete({ where: { shipment_item_id: shipmentItemId } });

      const entries: ChangeEntry[] = [
        {
          entity: ACT,
          entityId: shipmentItemId,
          field: "deleted",
          oldValue: act.act_number,
        },
        {
          entity: ACT,
          entityId: shipmentItemId,
          field: "storno",
          newValue: `сторно ингр.: ${storno.length} групп`,
        },
      ];

      if (item.shipment.status === "accepted") {
        await tx.shipment.update({
          where: { id: item.shipment.id },
          data: { status: "arrived" },
        });
        entries.push({
          entity: SHIPMENT,
          entityId: item.shipment.id,
          field: "status",
          oldValue: "accepted",
          newValue: "arrived",
        } as (typeof entries)[number]);
      }

      await logChange(entries, Number(user.id), tx);
      return { ok: true as const };
    });

    if (result.ok) revalidate();
    return result;
  } catch (e) {
    return authFail(e) ?? { ok: false, error: "Не удалось откатить акт" };
  }
}
