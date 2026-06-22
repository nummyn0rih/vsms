import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { computeAcceptedKg, calibreRangeLabel, stripSeasonPrefix } from "./accepted";
import { itemCost, type ExecItem } from "@/server/contracts/execution";
import { seasonYearOf } from "@/server/shipments/workdays";
import type {
  AcceptanceBoard,
  AcceptanceMachine,
  AcceptedMachine,
  AcceptedPosition,
} from "./schema";

// Загрузчик доски приёмки (B4b/C3c, BR-26). Server-only (тянет prisma) — типы для
// client лежат в schema.ts. Три зоны: 1 sent (ожидают перевески), 2 arrived (на
// приёмке), 3 accepted (принято). Принятый вес и стоимость зоны 3 — на лету (BR-10/§5),
// ничего не хранится. Сортировка машин — по дате прибытия.

function toDateStr(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

const ZERO = new Prisma.Decimal(0);

export async function getAcceptanceBoard(): Promise<AcceptanceBoard> {
  const [shipments, acceptedShipments] = await Promise.all([
    prisma.shipment.findMany({
      where: { status: { in: ["sent", "arrived"] } },
      include: {
        items: {
          include: {
            culture: { select: { name: true, color: true } },
            farmer: { select: { name: true } },
            acceptanceAct: { select: { act_number: true } },
          },
          orderBy: { id: "asc" },
        },
        driver: {
          select: {
            full_name: true,
            phone: true,
            info: true,
            transportCompany: { select: { name: true } },
          },
        },
      },
      // null arrival_date в конец (машины без даты), затем по id.
      orderBy: [{ arrival_date: "asc" }, { id: "asc" }],
    }),
    // Зона 3: принятые машины с актами и калибр-результатами (для живого расчёта).
    prisma.shipment.findMany({
      where: { status: "accepted" },
      include: {
        items: {
          include: {
            culture: { select: { name: true, color: true } },
            farmer: { select: { name: true } },
            acceptanceAct: {
              select: {
                act_number: true,
                brak_percent: true,
                calibreResults: {
                  select: {
                    percent: true,
                    contract_line_id: true,
                    calibreRange: {
                      select: {
                        label: true,
                        min_cm: true,
                        max_cm: true,
                        is_accepted: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { id: "asc" },
        },
        driver: {
          select: {
            full_name: true,
            phone: true,
            info: true,
            transportCompany: { select: { name: true } },
          },
        },
      },
      orderBy: [{ arrival_date: "asc" }, { id: "asc" }],
    }),
  ]);

  // Цены/подписи строк контракта для всех строк, встреченных в принятых позициях
  // (строка позиции + строки калибр-категорий). Один запрос.
  const lineIds = new Set<number>();
  for (const s of acceptedShipments) {
    for (const it of s.items) {
      if (it.contract_line_id != null) lineIds.add(it.contract_line_id);
      for (const cr of it.acceptanceAct?.calibreResults ?? []) {
        if (cr.contract_line_id != null) lineIds.add(cr.contract_line_id);
      }
    }
  }
  const lines =
    lineIds.size > 0
      ? await prisma.contractLine.findMany({
          where: { id: { in: [...lineIds] } },
          select: { id: true, label: true, price_per_kg: true },
        })
      : [];
  const lineMap = new Map<number, Prisma.Decimal>(
    lines.map((l) => [l.id, l.price_per_kg]),
  );
  const lineInfo = new Map<number, { label: string | null; price: number }>(
    lines.map((l) => [l.id, { label: l.label, price: l.price_per_kg.toNumber() }]),
  );

  const mapMachine = (s: (typeof shipments)[number]): AcceptanceMachine => {
    const season = seasonYearOf(s.arrival_date ?? s.departure_date ?? new Date());
    const items = s.items.map((it) => ({
      id: it.id,
      cultureName: it.culture.name,
      color: it.culture.color,
      farmerName: it.farmer.name,
      plannedKg: it.planned_weight_kg.toNumber(),
      actualKg: it.actual_weight_kg != null ? it.actual_weight_kg.toNumber() : null,
      accepted: it.acceptanceAct != null,
      actNumber: it.acceptanceAct
        ? stripSeasonPrefix(it.acceptanceAct.act_number, season)
        : null,
    }));
    return {
      id: s.id,
      code: s.code,
      status: s.status as "sent" | "arrived",
      departureDate: toDateStr(s.departure_date),
      arrivalDate: toDateStr(s.arrival_date),
      driverName: s.driver?.full_name ?? null,
      transportCompanyName: s.driver?.transportCompany.name ?? null,
      driverPhone: s.driver?.phone ?? null,
      driverInfo: s.driver?.info ?? null,
      comment: s.comment,
      weighed: items.filter((i) => i.actualKg != null).length,
      acceptedCount: items.filter((i) => i.accepted).length,
      total: items.length,
      items,
    };
  };

  const mapAccepted = (
    s: (typeof acceptedShipments)[number],
  ): AcceptedMachine => {
    const season = seasonYearOf(s.arrival_date ?? s.departure_date ?? new Date());
    let machineSum = ZERO;
    const positions: AcceptedPosition[] = s.items.map((it) => {
      const act = it.acceptanceAct;
      const actualKg = it.actual_weight_kg?.toNumber() ?? 0;
      const brakPercent = act?.brak_percent?.toNumber() ?? 0;
      const results = act?.calibreResults ?? [];

      // ExecItem для живого расчёта стоимости (C3a, тот же источник, что execution.ts).
      const exec: ExecItem = {
        actualKg: it.actual_weight_kg,
        brakPercent,
        contractLineId: it.contract_line_id,
        calibres: results.map((cr) => ({
          percent: cr.percent.toNumber(),
          isAccepted: cr.calibreRange.is_accepted,
          contractLineId: cr.contract_line_id,
        })),
      };
      const cost = itemCost(exec, lineMap).cost;
      machineSum = machineSum.add(cost);
      const costRub = cost.toNumber();

      const acceptedKg =
        computeAcceptedKg(actualKg, brakPercent, exec.calibres) ?? 0;

      // Чипы калибра: категории + строка «брак» последней. Только для калибра.
      const calibres = results.map((cr) => {
        const minCm = cr.calibreRange.min_cm?.toNumber() ?? null;
        const maxCm = cr.calibreRange.max_cm?.toNumber() ?? null;
        const percent = cr.percent.toNumber();
        return {
          label: calibreRangeLabel(minCm, maxCm, cr.calibreRange.label),
          percent,
          kg: (actualKg * percent) / 100,
          isAccepted: cr.calibreRange.is_accepted,
        };
      });
      if (calibres.length > 0) {
        calibres.push({
          label: "брак",
          percent: brakPercent,
          kg: (actualKg * brakPercent) / 100,
          isAccepted: false,
          isBrak: true,
        } as (typeof calibres)[number]);
      }

      // Нестандарт со своей строкой контракта — оплачивается по ней (C3d-2, §5).
      // В headline «к оплате» (acceptedKg) НЕ входит, но ₽ идут в costRub/сумму машины.
      const nonStandard = results
        .filter((cr) => !cr.calibreRange.is_accepted && cr.contract_line_id != null)
        .map((cr) => {
          const minCm = cr.calibreRange.min_cm?.toNumber() ?? null;
          const maxCm = cr.calibreRange.max_cm?.toNumber() ?? null;
          const range = calibreRangeLabel(minCm, maxCm, cr.calibreRange.label);
          const info = lineInfo.get(cr.contract_line_id!);
          const nsKg = (actualKg * cr.percent.toNumber()) / 100;
          const price = info?.price ?? null;
          return {
            label: `Нестандарт ${range}`,
            kg: nsKg,
            lineLabel: info?.label ?? null,
            pricePerKg: price,
            costRub: price != null ? nsKg * price : 0,
          };
        });

      // Строка футера: строка позиции, иначе (калибр) — общая строка принятых категорий.
      const footerLineId = pickFooterLineId(it.contract_line_id, exec.calibres);
      const footerLine =
        footerLineId != null ? lineInfo.get(footerLineId) : undefined;

      return {
        id: it.id,
        cultureName: it.culture.name,
        color: it.culture.color,
        farmerName: it.farmer.name,
        actNumber: act ? stripSeasonPrefix(act.act_number, season) : null,
        actualKg,
        brakPercent,
        acceptedKg,
        calibres,
        nonStandard,
        lineLabel: footerLine?.label ?? null,
        pricePerKg: footerLine?.price ?? null,
        costRub,
      };
    });

    return {
      id: s.id,
      code: s.code,
      departureDate: toDateStr(s.departure_date),
      arrivalDate: toDateStr(s.arrival_date),
      driverName: s.driver?.full_name ?? null,
      transportCompanyName: s.driver?.transportCompany.name ?? null,
      driverPhone: s.driver?.phone ?? null,
      driverInfo: s.driver?.info ?? null,
      acceptedCount: positions.length,
      total: positions.length,
      machineSumRub: machineSum.toNumber(),
      positions,
    };
  };

  const zone1: AcceptanceMachine[] = [];
  const zone2: AcceptanceMachine[] = [];
  for (const s of shipments) {
    if (s.status === "sent") zone1.push(mapMachine(s));
    else if (s.status === "arrived") zone2.push(mapMachine(s));
  }
  const zone3 = acceptedShipments.map(mapAccepted);

  return { zone1, zone2, zone3, acceptedCount: zone3.length };
}

// Строка контракта для футера позиции. simple/привязанная → строка позиции. Калибр без
// строки позиции → если все принятые категории идут на одну строку, берём её; иначе null
// (футер покажет только сумму без «× цена»).
function pickFooterLineId(
  itemLineId: number | null,
  calibres: ExecItem["calibres"],
): number | null {
  if (itemLineId != null) return itemLineId;
  const accepted = new Set<number>();
  for (const c of calibres) {
    if (!c.isAccepted) continue;
    const id = c.contractLineId ?? itemLineId;
    if (id != null) accepted.add(id);
  }
  return accepted.size === 1 ? [...accepted][0] : null;
}
