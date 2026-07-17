import { Fragment } from "react";
import { getFeed } from "@/server/shipments/feed-loader";
import {
  filterFeedWeeks,
  weekSummary,
  daySummary,
  type FeedFilters,
  type FeedItem,
  type FeedShipment,
  type FeedWeek,
} from "@/server/shipments/feed";
import { listShipmentOptions } from "@/server/shipments/actions";
import { parseWeekParam } from "@/server/shipments/workdays";
import { formatWeekRange } from "@/app/(app)/shipments/_components/week-format";
import { STATUS_STYLE } from "@/app/(app)/shipments/_components/shipment-status";
import { fmtInt, fmtTons } from "@/lib/format";
import { PrintSheet } from "../_components/PrintSheet";

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
// «2026-06-08» → «8 июня»
function dayLabel(iso: string): { weekday: string; date: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  const WD = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    weekday: cap(WD[d.getUTCDay()]),
    date: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
  };
}

function csvNums(raw: string | undefined): Set<number> {
  const s = new Set<number>();
  if (!raw) return s;
  for (const p of raw.split(",")) {
    const n = Number(p);
    if (Number.isFinite(n)) s.add(n);
  }
  return s;
}

// Факт/Принято суммируются на показе (null → не считаем): это отображение, не домен.
function sumFact(items: FeedItem[]): number {
  return items.reduce((a, it) => a + (it.actualKg ?? 0), 0);
}
function sumAccepted(items: FeedItem[]): number {
  return items.reduce((a, it) => a + (it.acceptedKg ?? 0), 0);
}

function tareCell(it: FeedItem): string {
  if (it.packagingTypeName == null) return "—"; // навал
  if (it.tareMissingNorm) return `${it.packagingTypeName} · ?`;
  if (it.tareUnits == null) return it.packagingTypeName;
  return `${it.packagingTypeName} · ${fmtInt(it.tareUnits)}`;
}

export default async function PrintShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;

  const wk = parseWeekParam(sp.week);
  const [feed, options] = await Promise.all([
    getFeed({ seasonYear: wk.seasonYear }),
    listShipmentOptions(),
  ]);

  const supplierSel = csvNums(one(sp.sup));
  const cultureSel = csvNums(one(sp.cult));
  const statusRaw = one(sp.st);
  const statusSel = new Set<FeedShipment["status"]>(
    (statusRaw ? statusRaw.split(",") : []).filter((s): s is FeedShipment["status"] =>
      ["planned", "sent", "arrived", "accepted"].includes(s),
    ),
  );
  const search = one(sp.q) ?? "";
  const hidePlanned = one(sp.hp) === "1";

  const filters: FeedFilters = { search, supplierSel, cultureSel, statusSel, hidePlanned };
  const weeks = filterFeedWeeks(feed.weeks, filters);
  const week: FeedWeek | undefined = weeks.find(
    (w) => w.isoYear === wk.isoYear && w.isoWeek === wk.isoWeek,
  );

  const range = week ? formatWeekRange(week).range : "";
  const period = `W${String(wk.isoWeek).padStart(2, "0")}${range ? ` · ${range}` : ""}`;

  // Строка фильтров в шапке (порт логики ShipmentsFeed).
  const nameList = (opts: { id: number; name: string }[], sel: Set<number>) =>
    opts.filter((o) => sel.has(o.id)).map((o) => o.name).join(", ") || "все";
  const statusList =
    statusSel.size === 0
      ? "все"
      : [...statusSel].map((s) => STATUS_STYLE[s].label).join(", ");
  const searchLabel = search.trim() ? ` · поиск — «${search.trim()}»` : "";
  const filtersLine = (
    <>
      Фильтры: поставщик — <b>{nameList(options.farmers, supplierSel)}</b> · сырьё —{" "}
      <b>{nameList(options.cultures, cultureSel)}</b> · статус — <b>{statusList}</b>
      {hidePlanned ? " · плановые скрыты" : ""}
      {searchLabel}
    </>
  );

  // Итоги недели.
  const ws = week ? weekSummary(week) : { totalKg: 0, machineCount: 0 };
  const allItems = week
    ? week.days.flatMap((d) => d.shipments.flatMap((s) => s.items))
    : [];
  const weekFact = sumFact(allItems);
  const weekAccepted = sumAccepted(allItems);
  const positionsCount = allItems.length;

  return (
    <PrintSheet
      title="Отгрузки — неделя"
      subtitle="Овощное сырьё на завод · лента отгрузок"
      season={`Сезон ${feed.seasonYear}`}
      period={period}
      filters={filtersLine}
      footTotal={
        <>
          <b>Итого:</b> <span className="num">{ws.machineCount}</span> машин ·
          эффективный вес <span className="num">{fmtTons(ws.totalKg / 1000)} т</span> ·
          принято <span className="num">{fmtTons(weekAccepted / 1000)} т</span>
        </>
      }
      footPage={`Отгрузки · W${String(wk.isoWeek).padStart(2, "0")} · лист 1/1`}
    >
      <table className="dt">
        <colgroup>
          <col style={{ width: "20%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>№ машины · перевозчик</th>
            <th>Статус</th>
            <th>Культура</th>
            <th>Поставщик</th>
            <th>Тара</th>
            <th className="r">План, кг</th>
            <th className="r">Факт, кг</th>
            <th className="r">Принято, кг</th>
          </tr>
        </thead>
        <tbody>
          {!week && (
            <tr className="empty">
              <td colSpan={8}>нет отгрузок за выбранную неделю</td>
            </tr>
          )}
          {week?.days.map((day) => {
            const items = day.shipments.flatMap((s) => s.items);
            const ds = daySummary(day);
            const dl = dayLabel(day.date);
            if (day.shipments.length === 0) {
              return (
                <tr className="grp" key={day.date}>
                  <td colSpan={8}>
                    <span className="g-title">
                      <span className="gd">{dl.weekday},</span> {dl.date}
                    </span>
                  </td>
                </tr>
              );
            }
            return (
              <Fragment key={day.date}>
                <tr className="grp">
                  <td colSpan={5}>
                    <span className="g-title">
                      <span className="gd">{dl.weekday},</span> {dl.date}
                    </span>
                  </td>
                  <td className="r g-meta">{fmtInt(ds.totalKg)}</td>
                  <td className="r g-meta">{fmtInt(sumFact(items))}</td>
                  <td className="r g-meta">{fmtInt(sumAccepted(items))}</td>
                </tr>
                {day.shipments.map((m) =>
                  m.items.map((it, idx) => (
                    <tr key={`${m.id}-${it.id}`}>
                      {idx === 0 && (
                        <>
                          <td rowSpan={m.items.length}>
                            <span className="mno">{m.code}</span>
                            <div className="mdrv">
                              {[m.driverName, m.transportCompanyName]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </div>
                          </td>
                          <td rowSpan={m.items.length}>
                            <span className={`st ${m.status}`}>
                              <span className="d" />
                              {STATUS_STYLE[m.status].label}
                            </span>
                          </td>
                        </>
                      )}
                      <td>
                        <span className="cultname">
                          <span className="chip" style={{ background: it.color }} />
                          {it.cultureName}
                        </span>
                      </td>
                      <td>{it.farmerName}</td>
                      <td className="num dim">{tareCell(it)}</td>
                      <td className="r num">{fmtInt(it.plannedKg)}</td>
                      <td className="r num">
                        {it.actualKg == null ? <span className="dim">—</span> : fmtInt(it.actualKg)}
                      </td>
                      <td className="r num">
                        {it.acceptedKg == null ? <span className="dim">—</span> : fmtInt(it.acceptedKg)}
                      </td>
                    </tr>
                  )),
                )}
              </Fragment>
            );
          })}
        </tbody>
        {week && (
          <tfoot>
            <tr>
              <td colSpan={5} className="lead">
                Итого недели · {ws.machineCount} машин · {positionsCount} позиций
              </td>
              <td className="r num">{fmtInt(ws.totalKg)}</td>
              <td className="r num">{fmtInt(weekFact)}</td>
              <td className="r num">{fmtInt(weekAccepted)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </PrintSheet>
  );
}
