import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  summarizeCultures,
  buildSendPreview,
  type FeedShipment,
  type SendPreview,
} from "@/server/shipments/feed";
import { loadWeekShipments } from "@/server/shipments/feed-loader";
import { calcIngredientConsumption } from "@/server/acceptance/ingredients";
import { getTareBalances, getIngredientBalances } from "@/server/inventory/balances";
import {
  parseDateUTC,
  subtractWorkdays,
  type SeasonWorkdays,
} from "@/server/shipments/workdays";
import { getPlanWeek } from "@/server/plan/board";
import type {
  BoardCard,
  BoardColumn,
  BoardFarmerRow,
  BoardWeek,
  IngredientDeficitLine,
  TareDeficitLine,
} from "./schema";

// Загрузчик вида «Доска» (B5-1). Server-only (prisma) — типы для client в schema.ts.
// Максимальный reuse: карточки/чипы/тара — из ленты (feed.ts), прогресс и колонки
// (рабочие дни) — из плана (getPlanWeek). Новых агрегаций тары/культур НЕ вводим.

// Отправление = прибытие − 2 РАБОЧИХ дня (через workdays.ts), НЕ из БД.
function departureISO(arrivalISO: string, cfg: SeasonWorkdays | null): string {
  return subtractWorkdays(parseDateUTC(arrivalISO), 2, cfg).toISOString().slice(0, 10);
}

// Разбивка машины по фермерам (порядок первого появления) — строки .frows карточки.
function farmerRows(fs: FeedShipment): BoardFarmerRow[] {
  const byFarmer = new Map<number, BoardFarmerRow>();
  for (const it of fs.items) {
    let row = byFarmer.get(it.farmerId);
    if (!row) {
      row = { farmerId: it.farmerId, farmerName: it.farmerName, cultureNames: [], totalKg: 0 };
      byFarmer.set(it.farmerId, row);
    }
    if (!row.cultureNames.includes(it.cultureName)) row.cultureNames.push(it.cultureName);
    row.totalKg += it.plannedKg;
  }
  return [...byFarmer.values()];
}

// B5-2: контекст дефицита — балансы фермеров (Σ движений) и рецептуры культур.
// Загружается ОДИН раз на неделю (батч), не на карточку — без N+1.
type RecipeRow = {
  ingredientId: number;
  name: string;
  unit: "kg" | "l";
  qtyPerKgProduct: Prisma.Decimal;
};
type DeficitContext = {
  tareHave: Map<string, number>; // `${farmerId}:${packagingTypeId}` → годная тара
  ingHave: Map<string, number>; // `${farmerId}:${ingredientId}` → баланс ингредиента
  recipesByCulture: Map<number, RecipeRow[]>;
};

const EPS = 1e-9; // отсекаем float-шум при сравнении нужно/доступно (микродозы ингредиентов)

// Дефицит карточки. Тара/ингредиенты живут У ФЕРМЕРА — считаем потребность по
// каждому фермеру рейса, сравниваем с его балансом, агрегируем по типу/ингредиенту
// (short по машине = Σ нехваток фермеров; делиться тарой между фермерами нельзя).
function computeCardDeficit(
  fs: FeedShipment,
  send: SendPreview,
  ctx: DeficitContext,
): { tareDeficit?: TareDeficitLine[]; ingredientDeficit?: IngredientDeficitLine[] } {
  // Тара: send.groups уже = фермер → тип → units (плановый вес / норма, как в ленте).
  const tareByType = new Map<number, TareDeficitLine>();
  for (const g of send.groups) {
    for (const line of g.lines) {
      const have = ctx.tareHave.get(`${g.farmerId}:${line.packagingTypeId}`) ?? 0;
      const short = Math.max(line.units - have, 0);
      const acc = tareByType.get(line.packagingTypeId) ?? {
        packagingTypeId: line.packagingTypeId,
        name: line.packagingName,
        needUnits: 0,
        haveUnits: 0,
        shortUnits: 0,
      };
      acc.needUnits += line.units;
      acc.haveUnits += have;
      acc.shortUnits += short;
      tareByType.set(line.packagingTypeId, acc);
    }
  }

  // Ингредиент: сперва Σ потребности по (фермер, ингредиент) ПО ВСЕМ культурам фермера
  // — баланс ингредиента у фермера один, сравнивать надо с суммарной потребностью.
  const needByFarmerIng = new Map<string, { ingredientId: number; qty: Prisma.Decimal }>();
  const ingMeta = new Map<number, { name: string; unit: "kg" | "l" }>();
  for (const it of fs.items) {
    const recipes = ctx.recipesByCulture.get(it.cultureId);
    if (!recipes) continue;
    const consumption = calcIngredientConsumption(new Prisma.Decimal(it.plannedKg), recipes);
    for (const c of consumption) {
      const meta = recipes.find((r) => r.ingredientId === c.ingredientId);
      if (meta) ingMeta.set(c.ingredientId, { name: meta.name, unit: meta.unit });
      const key = `${it.farmerId}:${c.ingredientId}`;
      const prev = needByFarmerIng.get(key);
      if (prev) prev.qty = prev.qty.plus(c.quantity);
      else needByFarmerIng.set(key, { ingredientId: c.ingredientId, qty: c.quantity });
    }
  }
  const ingByIngredient = new Map<number, IngredientDeficitLine>();
  for (const [key, { ingredientId, qty }] of needByFarmerIng) {
    const farmerId = Number(key.split(":")[0]);
    const need = qty.toNumber();
    const have = ctx.ingHave.get(`${farmerId}:${ingredientId}`) ?? 0;
    const short = Math.max(need - have, 0);
    const meta = ingMeta.get(ingredientId);
    const acc = ingByIngredient.get(ingredientId) ?? {
      ingredientId,
      name: meta?.name ?? "ингредиент",
      unit: meta?.unit ?? "kg",
      needQty: 0,
      haveQty: 0,
      shortQty: 0,
    };
    acc.needQty += need;
    acc.haveQty += have;
    acc.shortQty += short;
    ingByIngredient.set(ingredientId, acc);
  }

  const tareDeficit = [...tareByType.values()].filter((t) => t.shortUnits > 0);
  const ingredientDeficit = [...ingByIngredient.values()].filter((i) => i.shortQty > EPS);
  return {
    tareDeficit: tareDeficit.length > 0 ? tareDeficit : undefined,
    ingredientDeficit: ingredientDeficit.length > 0 ? ingredientDeficit : undefined,
  };
}

function toCard(
  fs: FeedShipment,
  cfg: SeasonWorkdays | null,
  ctx: DeficitContext,
): BoardCard {
  const locked = fs.status === "arrived" || fs.status === "accepted";
  const send = buildSendPreview(fs.items); // переиспользуем и для totals, и для дефицита
  return {
    shipmentId: fs.id,
    code: fs.code,
    status: fs.status,
    farmers: farmerRows(fs),
    driverName: fs.driverName,
    transportCompanyName: fs.transportCompanyName,
    departureDate: fs.arrivalDate ? departureISO(fs.arrivalDate, cfg) : null,
    arrivalDate: fs.arrivalDate,
    cultures: summarizeCultures([fs]).cultures,
    tare: send.totals,
    draggable: fs.status === "planned" || fs.status === "sent",
    arrivalOnly: fs.status === "sent",
    locked,
    ...computeCardDeficit(fs, send, ctx),
  };
}

export async function getBoardWeek({
  seasonYear,
  isoYear,
  isoWeek,
}: {
  seasonYear: number;
  isoYear: number;
  isoWeek: number;
}): Promise<BoardWeek> {
  const shipments = await loadWeekShipments({ seasonYear, isoYear, isoWeek });
  // Культуры недели → рецептуры подтягиваем только по ним (батч, без N+1).
  const cultureIds = [
    ...new Set(shipments.flatMap((s) => s.items.map((i) => i.cultureId))),
  ];

  const [plan, cfg, tareBal, ingBal, recipes] = await Promise.all([
    // Прогресс по культурам + рабочие дни (колонки) + недельный итог.
    getPlanWeek({ seasonYear, isoYear, isoWeek }),
    prisma.seasonConfig.findUnique({ where: { season_year: seasonYear } }),
    // Балансы фермеров (Σ движений) — переиспользуем агрегацию инвентаря (B5-2).
    getTareBalances(),
    getIngredientBalances(),
    cultureIds.length > 0
      ? prisma.ingredientRecipe.findMany({
          where: { culture_id: { in: cultureIds } },
          select: {
            culture_id: true,
            ingredient_id: true,
            qty_per_kg_product: true,
            ingredient: { select: { name: true, unit: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  // Контекст дефицита: годная тара и ингредиенты по фермерам + рецептуры по культуре.
  const tareHave = new Map<string, number>();
  for (const c of tareBal.cells) {
    if (c.state !== "good" || c.locationId <= 0) continue; // только фермеры, годная тара
    tareHave.set(`${c.locationId}:${c.packagingTypeId}`, c.quantity);
  }
  const ingHave = new Map<string, number>();
  for (const c of ingBal.cells) {
    if (c.locationId <= 0) continue; // только фермеры (завод/транзит не считаем)
    ingHave.set(`${c.locationId}:${c.ingredientId}`, c.quantity);
  }
  const recipesByCulture = new Map<number, RecipeRow[]>();
  for (const r of recipes) {
    const row: RecipeRow = {
      ingredientId: r.ingredient_id,
      name: r.ingredient.name,
      unit: r.ingredient.unit as "kg" | "l",
      qtyPerKgProduct: r.qty_per_kg_product,
    };
    const arr = recipesByCulture.get(r.culture_id);
    if (arr) arr.push(row);
    else recipesByCulture.set(r.culture_id, [row]);
  }
  const deficitCtx: DeficitContext = { tareHave, ingHave, recipesByCulture };

  // Машины по дню прибытия. Машина в НЕрабочий день не попадёт ни в одну колонку
  // (колонки = только рабочие дни); в недельный прогресс она учтена через
  // getPlanWeek. Плановые прибытия — рабочие дни; B5-1b (drag) закрепит инвариант.
  const byDate = new Map<string, FeedShipment[]>();
  for (const s of shipments) {
    if (!s.arrivalDate) continue;
    const arr = byDate.get(s.arrivalDate);
    if (arr) arr.push(s);
    else byDate.set(s.arrivalDate, [s]);
  }

  const columns: BoardColumn[] = plan.days.map((d) => {
    const dayShipments = byDate.get(d.date) ?? [];
    return {
      dateISO: d.date,
      weekdayName: d.weekdayName,
      daySubtotalKg: summarizeCultures(dayShipments).totalKg,
      machineCount: dayShipments.length,
      addDepartureISO: departureISO(d.date, cfg),
      cards: dayShipments.map((fs) => toCard(fs, cfg, deficitCtx)),
    };
  });

  // Прогресс — культуры с целью на неделю в ЛЮБОМ режиме (BR-20): недельная строка
  // (date=null) ИЛИ сумма дневных (date≠null). getPlanWeek уже свёл оба в PlanRow.
  const progress = plan.rows
    .map((r) => ({
      cultureId: r.cultureId,
      name: r.cultureName,
      color: r.color,
      plannedTons: r.weekProgress.effectiveTons,
      targetTons:
        r.weekTarget != null
          ? r.weekTarget
          : Object.values(r.dayTargets).reduce((s, t) => s + t, 0),
    }))
    .filter((p) => p.targetTons > 0);
  const totalTargetTons = progress.reduce((s, p) => s + p.targetTons, 0);

  return {
    seasonYear,
    isoYear,
    isoWeek,
    startDate: plan.startDate,
    endDate: plan.endDate,
    columns,
    progress,
    totalPlannedTons: plan.weekTotalProgress.effectiveTons,
    totalTargetTons,
    hasPlan: progress.length > 0,
  };
}
