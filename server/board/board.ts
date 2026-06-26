import { prisma } from "@/lib/prisma";
import {
  summarizeCultures,
  buildSendPreview,
  type FeedShipment,
} from "@/server/shipments/feed";
import { loadWeekShipments } from "@/server/shipments/feed-loader";
import {
  parseDateUTC,
  subtractWorkdays,
  type SeasonWorkdays,
} from "@/server/shipments/workdays";
import { getPlanWeek } from "@/server/plan/board";
import type { BoardCard, BoardColumn, BoardWeek } from "./schema";

// Загрузчик вида «Доска» (B5-1). Server-only (prisma) — типы для client в schema.ts.
// Максимальный reuse: карточки/чипы/тара — из ленты (feed.ts), прогресс и колонки
// (рабочие дни) — из плана (getPlanWeek). Новых агрегаций тары/культур НЕ вводим.

// Имя фермера(ов) машины: обычно один; при нескольких — «имя +N».
function farmerLabel(fs: FeedShipment): string {
  const seen = new Map<number, string>();
  for (const it of fs.items) if (!seen.has(it.farmerId)) seen.set(it.farmerId, it.farmerName);
  const names = [...seen.values()];
  if (names.length === 0) return "—";
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
}

function toCard(fs: FeedShipment, cfg: SeasonWorkdays | null): BoardCard {
  // Отправление = прибытие − 2 РАБОЧИХ дня (через workdays.ts), НЕ из БД.
  let departureDate: string | null = null;
  if (fs.arrivalDate) {
    departureDate = subtractWorkdays(parseDateUTC(fs.arrivalDate), 2, cfg)
      .toISOString()
      .slice(0, 10);
  }
  return {
    shipmentId: fs.id,
    code: fs.code,
    status: fs.status,
    farmerName: farmerLabel(fs),
    driverName: fs.driverName,
    transportCompanyName: fs.transportCompanyName,
    departureDate,
    arrivalDate: fs.arrivalDate,
    cultures: summarizeCultures([fs]).cultures,
    tare: buildSendPreview(fs.items).totals,
    draggable: fs.status === "planned",
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
  const [shipments, plan, cfg] = await Promise.all([
    loadWeekShipments({ seasonYear, isoYear, isoWeek }),
    // Прогресс по культурам + рабочие дни (колонки) + недельный итог.
    getPlanWeek({ seasonYear, isoYear, isoWeek }),
    prisma.seasonConfig.findUnique({ where: { season_year: seasonYear } }),
  ]);

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
      cards: dayShipments.map((fs) => toCard(fs, cfg)),
    };
  });

  // Прогресс — только культуры с заданной целью на неделю.
  const progress = plan.rows
    .filter((r) => r.weekTarget != null)
    .map((r) => ({
      cultureId: r.cultureId,
      name: r.cultureName,
      color: r.color,
      plannedTons: r.weekProgress.effectiveTons,
      targetTons: r.weekTarget as number,
    }));
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
