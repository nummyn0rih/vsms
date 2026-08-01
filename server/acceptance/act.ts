"use server";

import { revalidatePath } from "next/cache";

import { Prisma, type ShipmentStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/server/auth/session";
import { failWithLog } from "@/server/action-result";
import { logChange, type ChangeEntry } from "@/server/changelog";
import type { ActionResult } from "@/lib/action-result";
import { seasonYearOf } from "@/server/shipments/workdays";
import {
  withSeasonPrefix,
  stripSeasonPrefix,
  calibreRangeLabel,
  findSettlementConflict,
  settlementConflictMessage,
  type SettlementConflictCalibre,
} from "./accepted";
import { diffCalibreResults, type CalibreSnapshot } from "./act-diff";
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
  await requireRole();

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
          settlement_percent: true,
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

  // Фактические привязки позиции/акта могут указывать на строку ВНЕ сезонного списка
  // (машину завели на границе сезона, строку перенесли в другой контракт). Опция обязана
  // быть в списке: иначе селект при валидном value рисует плейсхолдер — оператор видит
  // «не привязана», хотя привязка есть и уйдёт в сохранение как есть. В норме множество
  // пустое и запроса не будет. Образец — FK-Select форм (filterContractLines).
  const referenced = new Set<number>();
  if (item.contract_line_id != null) referenced.add(item.contract_line_id);
  for (const c of item.acceptanceAct?.calibreResults ?? [])
    if (c.contract_line_id != null) referenced.add(c.contract_line_id);
  for (const l of lines) referenced.delete(l.id);

  const extraLines = referenced.size
    ? await prisma.contractLine.findMany({
        where: { id: { in: [...referenced] } },
        select: {
          id: true,
          label: true,
          price_per_kg: true,
          contract: { select: { season_year: true } },
        },
        orderBy: { id: "asc" },
      })
    : [];

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
    arrivalDate: toDateStr(item.shipment.arrival_date),
    actualKg:
      item.actual_weight_kg != null ? item.actual_weight_kg.toNumber() : null,
    contractLines: [
      ...lines.map((l) => ({
        id: l.id,
        label: l.label,
        pricePerKg: l.price_per_kg.toString(),
      })),
      // Несезонные строки — в хвост и с пометкой сезона, чтобы не путались с текущими.
      ...extraLines.map((l) => ({
        id: l.id,
        label: `${l.label?.trim() || `строка #${l.id}`} · сезон ${l.contract.season_year}`,
        pricePerKg: l.price_per_kg.toString(),
      })),
    ],
    // Считается по СЕЗОННЫМ строкам: «строк ровно одна → привязка авто» (BR-8).
    // extraLines — заплатка видимости, на семантику авто-привязки не влияют.
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
          settlementPercent:
            item.acceptanceAct.settlement_percent != null
              ? item.acceptanceAct.settlement_percent.toNumber()
              : null,
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

// Статус машины под блокировкой её строки. Общий примитив для всех операций над актами:
// читать статус БЕЗ блокировки бессмысленно — параллельная приёмка успевает его сменить
// между чтением и записью. Блокировка реентерабельна в рамках транзакции, поэтому ранний
// вызов (RBAC-гард saveAct) не мешает повторному в reconcileShipmentAcceptedWithin.
// Prisma не даёт row-lock API — только raw (в интерактивной транзакции идёт по тому же
// соединению).
async function lockShipmentStatusWithin(
  tx: Prisma.TransactionClient,
  shipmentId: number,
): Promise<ShipmentStatus | null> {
  const locked = await tx.$queryRaw<{ status: ShipmentStatus }[]>`
    SELECT status FROM "Shipment" WHERE id = ${shipmentId} FOR UPDATE
  `;
  return locked[0]?.status ?? null;
}

// Пересчёт статуса машины по BR-13: «accepted ⟺ все позиции приняты». Зовётся из ЛЮБОЙ
// операции над актами (saveAct / откаты) в их транзакции.
//
// Блокировка строки машины (lockShipmentStatusWithin) — до подсчёта, и это принципиально:
// параллельная приёмка блокируется на этой строке до нашего коммита, а её count выполнится
// уже СЛЕДУЮЩИМ statement'ом, то есть со свежим снапшотом READ COMMITTED, где наш акт виден.
// Без блокировки обе транзакции видели «ещё есть непринятые» и машина навсегда оставалась
// arrived при всех принятых позициях (П-9).
//
// Идемпотентно: статус уже соответствует → ни update, ни ChangeLog. Обратный переход
// (accepted → arrived) закрывает случай «позиций стало больше / откат акта».
// planned/sent не трогаем — приёмки там ещё нет.
async function reconcileShipmentAcceptedWithin(
  tx: Prisma.TransactionClient,
  shipmentId: number,
): Promise<ChangeEntry[]> {
  const current = await lockShipmentStatusWithin(tx, shipmentId);
  if (current == null) return []; // машины нет — решает вызывающий

  // Последовательно, не Promise.all: внутри транзакции все запросы идут по ОДНОМУ
  // соединению, параллельный запуск драйвер считает ошибкой использования.
  const total = await tx.shipmentItem.count({ where: { shipment_id: shipmentId } });
  const unaccepted = await tx.shipmentItem.count({
    where: { shipment_id: shipmentId, acceptanceAct: null },
  });
  // Машина без позиций «принятой» не становится (иначе пустой каркас ушёл бы в accepted).
  const want = total > 0 && unaccepted === 0 ? "accepted" : "arrived";

  const move =
    want === "accepted" && current === "arrived"
      ? "accepted"
      : want === "arrived" && current === "accepted"
        ? "arrived"
        : null;
  if (move == null) return [];

  await tx.shipment.update({ where: { id: shipmentId }, data: { status: move } });
  return [
    {
      entity: SHIPMENT,
      entityId: shipmentId,
      field: "status",
      oldValue: current,
      newValue: move,
    },
  ];
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
    const { shipmentItemId, actNumber, brakPercent, settlementPercent } = parsed.data;
    // BR-33: поле не прислано (undefined) → значение в БД не трогаем. Форма оператора
    // его не шлёт, поэтому сохранение акта оператором не стирает договорённость админа.
    const settlementProvided = settlementPercent !== undefined;

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
                select: {
                  ranges: {
                    // label/min_cm/max_cm — для НАЗВАНИЯ категории в тексте гарда BR-33.
                    select: {
                      id: true,
                      is_accepted: true,
                      label: true,
                      min_cm: true,
                      max_cm: true,
                    },
                  },
                },
              },
            },
          },
          // status не выбираем: он читается под блокировкой в
          // reconcileShipmentAcceptedWithin — прочитанное здесь значение устарело бы.
          shipment: {
            select: { id: true, arrival_date: true, departure_date: true },
          },
          // Снимок «до» — для дифа в ChangeLog (BR-16): при пересохранении нужно знать
          // прежние № акта, брак и категории, иначе правка уходит в журнал безадресной
          // строкой «Изменено».
          acceptanceAct: {
            select: {
              id: true,
              settlement_percent: true,
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
      if (!item) return { ok: false as const, error: "Позиция не найдена" };

      // BR-25: без фактического веса приёмка невозможна.
      //
      // Гарда «вес не менять» здесь нет намеренно: actual_weight_kg не входит в
      // saveActSchema и в этой функции НЕ пишется — вес читается только как база расчётов.
      // Единственный писатель — setActualWeight, где стоит гард «есть акт → отказ»
      // (actions.ts): вес позиции с актом read-only, потому что расход ингредиентов уже
      // списан по нему (CLAUDE.md «четыре базы веса», BR-32 — правка только через откат).
      // Второй путь очистки веса, revertShipmentToSent, уже отклоняется при наличии акта.
      // Поэтому пересохранение акта (проценты/брак/settlement_percent) остаётся штатным.
      if (item.actual_weight_kg == null) {
        return { ok: false as const, error: "Сначала внесите фактический вес" };
      }

      const isNew = item.acceptanceAct == null;

      // RBAC правки (acceptance-ux-2). Машина уже принята (зона 3) → правка акта меняет
      // деньги закрытой партии, это зона admin, как revertAct. Оператор правит свою
      // приёмку, только пока машина arrived (зона 2) — там акт ещё «в работе».
      // Гард по СТАТУСУ МАШИНЫ из БД под блокировкой, а не по флагу с клиента: статус
      // и есть граница зон (BR-26), а блокировка закрывает окно «машина стала accepted
      // между проверкой роли и записью».
      const shipmentStatus = await lockShipmentStatusWithin(tx, item.shipment.id);
      if (!isNew && shipmentStatus === "accepted" && user.role !== "admin") {
        return {
          ok: false as const,
          error: "Правка акта принятой машины — только администратор",
        };
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
      // Принятый % от факта — база сравнения для BR-33 (считаем в ветке: is_accepted
      // известен только здесь, из схемы калибров культуры).
      let acceptedPct = 0;
      let calibreData: {
        calibre_range_id: number;
        percent: Prisma.Decimal;
        contract_line_id: number | null;
      }[] = [];
      // Вход гарда BR-33 (подпись + is_accepted + строка). Для simple остаётся пустым —
      // конфликта «нестандарт со строкой» там не бывает.
      let conflictCalibres: SettlementConflictCalibre[] = [];
      // Подписи категорий — заполняются в калибр-ветке, нужны и ниже, в дифе ChangeLog.
      let calibreLabelById = new Map<number, string>();

      if (isCalibre) {
        // Калибр (BR-10, одноступенчато): Σ% категорий + brak% = 100% от факта;
        // принятые категории обязаны иметь строку.
        const calibres = parsed.data.calibres;
        if (!calibres || calibres.length === 0) {
          return { ok: false as const, error: "Заполните калибровочные категории" };
        }
        const ranges = item.culture.calibreScheme?.ranges ?? [];
        const acceptedById = new Map(ranges.map((r) => [r.id, r.is_accepted]));
        calibreLabelById = new Map(
          ranges.map((r) => [
            r.id,
            calibreRangeLabel(
              r.min_cm != null ? r.min_cm.toNumber() : null,
              r.max_cm != null ? r.max_cm.toNumber() : null,
              r.label,
            ),
          ]),
        );
        const labelById = calibreLabelById;

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
        acceptedPct = calibres
          .filter((c) => acceptedById.get(c.calibreRangeId) === true)
          .reduce((s, c) => s + c.percent, 0);
        calibreData = calibres.map((c) => ({
          calibre_range_id: c.calibreRangeId,
          percent: new Prisma.Decimal(c.percent),
          contract_line_id: c.contractLineId,
        }));
        conflictCalibres = calibres.map((c) => ({
          label: labelById.get(c.calibreRangeId) ?? String(c.calibreRangeId),
          isAccepted: acceptedById.get(c.calibreRangeId) === true,
          contractLineId: c.contractLineId,
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
        acceptedPct = 100 - brakPercent;
      }

      // --- BR-33: корректировка расчёта (оплата сверх принятого по договорённости) ---
      const currentSettlement = item.acceptanceAct?.settlement_percent ?? null;
      const settlementChanged =
        settlementProvided &&
        (currentSettlement == null
          ? settlementPercent !== null
          : settlementPercent === null ||
            !currentSettlement.equals(new Prisma.Decimal(settlementPercent)));

      // RBAC: деньги — зона admin. Оператор может сохранять акт, но НЕ менять процент;
      // отказываем явно, а не игнорируем присланное значение молча.
      if (settlementChanged && user.role !== "admin") {
        return {
          ok: false as const,
          error: "Изменять процент к оплате может только администратор (BR-33)",
        };
      }
      // Нижняя граница: скидка (ниже принятого%) запрещена. Верхняя (≤100) — в zod.
      if (settlementProvided && settlementPercent != null) {
        if (settlementPercent < acceptedPct - 0.01) {
          const pct = acceptedPct.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
          return {
            ok: false as const,
            error: `Процент к оплате не может быть ниже принятого (${pct}%)`,
          };
        }
      }

      // BR-33 × C3d-2: непринятая категория со СВОЕЙ строкой контракта уже оплачивается
      // целиком (гейт оплаты в execution.ts — contract_line_id, не is_accepted). Вместе с
      // процентом к оплате тот же вес считается дважды — комбинацию запрещаем.
      // Сравниваем ЭФФЕКТИВНОЕ значение процента: оператор поле не шлёт (settlementProvided
      // = false), но заданная админом корректировка остаётся в БД — иначе привязку строки к
      // нестандарту можно было бы протащить сохранением от оператора.
      const effectiveSettlement = settlementProvided
        ? settlementPercent ?? null
        : currentSettlement != null
          ? currentSettlement.toNumber()
          : null;
      const conflictLabel = findSettlementConflict(effectiveSettlement, conflictCalibres);
      if (conflictLabel != null) {
        return { ok: false as const, error: settlementConflictMessage(conflictLabel) };
      }

      // № акта уникален в рамках сезона (BR-9): хранится с префиксом года сезона.
      const refDate =
        item.shipment.arrival_date ?? item.shipment.departure_date ?? new Date();
      const season = seasonYearOf(refDate);
      const storedActNumber = withSeasonPrefix(actNumber, season);

      // BR-33: пишем колонку, только если поле прислано (иначе значение сохраняется).
      const settlementData =
        settlementProvided
          ? {
              settlement_percent:
                settlementPercent == null ? null : new Prisma.Decimal(settlementPercent),
            }
          : {};
      const act = await tx.acceptanceAct.upsert({
        where: { shipment_item_id: shipmentItemId },
        create: {
          shipment_item_id: shipmentItemId,
          act_number: storedActNumber,
          brak_percent: new Prisma.Decimal(brakPercent),
          ...settlementData,
        },
        update: {
          act_number: storedActNumber,
          brak_percent: new Prisma.Decimal(brakPercent),
          ...settlementData,
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

      const entries: ChangeEntry[] = [
        {
          entity: ACT,
          entityId: shipmentItemId,
          field: isNew ? "created" : "updated",
          newValue: storedActNumber,
        },
      ];

      // Диф пересохранения (BR-16: запись на КАЖДОЕ изменённое поле). Раньше правка
      // существующего акта оставляла в журнале только безадресное «Изменено», и понять
      // ЧТО изменилось было нельзя. Для нового акта дифа нет — есть запись «created».
      const before = item.acceptanceAct;
      if (before != null) {
        if (before.act_number !== storedActNumber) {
          entries.push({
            entity: ACT,
            entityId: shipmentItemId,
            field: "act_number",
            oldValue: before.act_number,
            newValue: storedActNumber,
          });
        }
        // brak_percent nullable: «не задан» трактуем как 0% — та же трактовка, что в
        // computeAcceptedKg. Иначе первое пересохранение старого акта давало бы ложную
        // запись null→0.
        const beforeBrak = before.brak_percent ?? new Prisma.Decimal(0);
        if (!beforeBrak.equals(new Prisma.Decimal(brakPercent))) {
          entries.push({
            entity: ACT,
            entityId: shipmentItemId,
            field: "brak_percent",
            oldValue: beforeBrak.toString(),
            newValue: String(brakPercent),
          });
        }
        // Категории заменяются целиком (deleteMany+createMany выше) — что реально
        // изменилось, видно только из сравнения снимков. Одна сводная запись на набор.
        const toSnapshot = (
          rows: {
            calibre_range_id: number;
            percent: Prisma.Decimal;
            contract_line_id: number | null;
          }[],
        ): CalibreSnapshot[] =>
          rows.map((r) => ({
            calibreRangeId: r.calibre_range_id,
            percent: r.percent.toNumber(),
            contractLineId: r.contract_line_id,
          }));
        const calibreDiff = diffCalibreResults(
          toSnapshot(before.calibreResults),
          toSnapshot(calibreData),
          (id) => calibreLabelById.get(id) ?? String(id),
        );
        if (calibreDiff != null) {
          entries.push({
            entity: ACT,
            entityId: shipmentItemId,
            field: "calibres",
            newValue: calibreDiff,
          });
        }
      }

      // BR-33: правка процента к оплате — в аудит, в ТОЙ ЖЕ транзакции.
      if (settlementChanged) {
        entries.push({
          entity: ACT,
          entityId: shipmentItemId,
          field: "settlement_percent",
          oldValue: currentSettlement != null ? currentSettlement.toString() : null,
          newValue: settlementPercent != null ? String(settlementPercent) : null,
        });
      }

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
        });
      }

      // BR-13: все позиции машины приняты → авто-accepted. Пересчёт под блокировкой
      // строки машины (см. reconcileShipmentAcceptedWithin) — иначе две параллельные
      // приёмки последних позиций обе увидят «ещё есть непринятые».
      entries.push(...(await reconcileShipmentAcceptedWithin(tx, item.shipment.id)));

      // C2 (BR-4): авто-расход ингредиентов по рецептуре культуры. База = ФАКТ
      // перевески (item.actual_weight_kg, не null по BR-25 выше). Списание у фермера
      // позиции (from=farmer, to=null — уходит в производство). Культура без
      // рецептуры → движений нет.
      const recipe = await tx.ingredientRecipe.findMany({
        where: { culture_id: item.culture_id },
        select: { ingredient_id: true, qty_per_kg_product: true },
      });
      // Гард — по НЕТТО группы, не по существованию движений (правило 7 CLAUDE.md).
      // Откат — нетто-сторно append'ом, оригиналы остаются в леджере навсегда, поэтому
      // «if (count > 0) skip» после полного цикла приёмка→откат→приёмка молча
      // блокирует легитимное повторное списание — дословный баг materials-fix.
      // Нетто считаем ТЕМ ЖЕ ключом ingredient×фермер, что и сторно в
      // revertActItemWithin: оригинал (to=null) плюс, сторно (from=null) минус.
      // Нетто = 0 → расход неактивен, применяем; нетто ≠ 0 → уже активен, пропускаем.
      const existingMovements = await tx.stockMovement.findMany({
        where: {
          source_doc_type: "acceptance_act",
          source_doc_id: act.id,
          kind: "ingredient",
        },
        select: {
          ingredient_id: true,
          quantity: true,
          from_location_id: true,
          to_location_id: true,
        },
      });
      const netByIngredient = new Map<number, Prisma.Decimal>();
      for (const m of existingMovements) {
        const isOriginal = m.to_location_id == null;
        const farmerId = isOriginal ? m.from_location_id : m.to_location_id;
        if (m.ingredient_id == null || farmerId !== item.farmer_id) continue;
        const cur = netByIngredient.get(m.ingredient_id) ?? new Prisma.Decimal(0);
        netByIngredient.set(
          m.ingredient_id,
          isOriginal ? cur.plus(m.quantity) : cur.minus(m.quantity),
        );
      }

      const consumption = calcIngredientConsumption(
        item.actual_weight_kg,
        recipe.map((r) => ({
          ingredientId: r.ingredient_id,
          qtyPerKgProduct: r.qty_per_kg_product,
        })),
      );
      const toApply = consumption.filter((m) =>
        (netByIngredient.get(m.ingredientId) ?? new Prisma.Decimal(0)).isZero(),
      );
      const skipped = consumption.length - toApply.length;
      if (toApply.length > 0) {
        await tx.stockMovement.createMany({
          data: toApply.map((m) => ({
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
      }
      entries.push({
        entity: ACT,
        entityId: shipmentItemId,
        field: "movements",
        newValue:
          skipped === 0
            ? `расход ингр.: ${toApply.length} движ.`
            : toApply.length === 0
              ? "расход ингр.: 0 движ. (уже активен, нетто≠0)"
              : `расход ингр.: ${toApply.length} движ. (${skipped} пропущено: нетто≠0)`,
      });

      await logChange(entries, Number(user.id), tx);
      return { ok: true as const };
    });

    if (result.ok) revalidate();
    return result;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "№ акта занят в этом сезоне (BR-9)" };
    }
    return failWithLog(e, "Не удалось сохранить акт");
  }
}

// Ядро отката приёмки ПО ПОЗИЦИИ (без транзакции и смены статуса машины — это решает
// вызывающий). Сторно расхода ингредиентов ДО удаления акта: исходные движения НЕ
// трогаем (аудит), сторнируем НЕТТО по (ingredient_id × фермер): оригинал (from=farmer,
// to=null) плюс, уже созданное сторно (from=null, to=farmer) минус — повторный откат
// даёт нетто 0 (идемпотентно). Паттерн revertShipmentToPlanned. Возвращает ChangeEntry[]
// (пустой массив, если акта нет — идемпотентно).
async function revertActItemWithin(
  tx: Prisma.TransactionClient,
  shipmentItemId: number,
): Promise<ChangeEntry[]> {
  const item = await tx.shipmentItem.findUnique({
    where: { id: shipmentItemId },
    select: { acceptanceAct: { select: { id: true, act_number: true } } },
  });
  if (item?.acceptanceAct == null) return []; // идемпотентно
  const act = item.acceptanceAct;

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

  return [
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
}

// Откат приёмки позиции (admin). Удаляет акт; если машина была accepted — возвращает
// arrived (BR-13). Идемпотентно. Сторно склада — C2.
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
        select: { shipment: { select: { id: true } } },
      });
      if (!item) return { ok: false as const, error: "Позиция не найдена" };

      const entries = await revertActItemWithin(tx, shipmentItemId);
      if (entries.length === 0) return { ok: true as const }; // акта не было

      // Тот же пересчёт под блокировкой, что на приёмке: откат одной позиции,
      // идущий параллельно с приёмкой последней, иначе оставил бы машину accepted.
      entries.push(...(await reconcileShipmentAcceptedWithin(tx, item.shipment.id)));

      await logChange(entries, Number(user.id), tx);
      return { ok: true as const };
    });

    if (result.ok) revalidate();
    return result;
  } catch (e) {
    return failWithLog(e, "Не удалось откатить акт");
  }
}

// Откат приёмки ВСЕЙ машины accepted → arrived (admin). Снимает акты у всех позиций
// (сторно ингредиентов по каждой) и переводит машину в arrived одной транзакцией.
// Для ленты, где машина = отгрузка с N позициями. Идемпотентно по позициям.
export async function revertShipmentToArrived(
  shipmentId: number,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");

    const result = await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { status: true, items: { select: { id: true } } },
      });
      if (!shipment) return { ok: false as const, error: "Отгрузка не найдена" };
      if (shipment.status !== "accepted") {
        return { ok: false as const, error: "Откат акта возможен только из статуса «Принята»" };
      }

      const entries: ChangeEntry[] = [];
      for (const it of shipment.items) {
        entries.push(...(await revertActItemWithin(tx, it.id)));
      }

      // Акты сняты со всех позиций → пересчёт вернёт машину в arrived (и запишет
      // ChangeLog). Единая точка смены статуса — та же, что на приёмке.
      entries.push(...(await reconcileShipmentAcceptedWithin(tx, shipmentId)));

      await logChange(entries, Number(user.id), tx);
      return { ok: true as const };
    });

    if (result.ok) revalidate();
    return result;
  } catch (e) {
    return failWithLog(e, "Не удалось откатить приёмку");
  }
}
