import { Fragment } from "react";
import { getFeed } from "@/server/shipments/feed-loader";
import {
  filterFeedWeeks,
  weekSummary,
  daySummary,
  feedTotals,
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
  const filteredWeeks = filterFeedWeeks(feed.weeks, filters);

  // Режим листа: одна неделя (дефолт) / раскрытые недели (CSV в ?weeks) / вся лента.
  const modeRaw = one(sp.mode);
  const mode: "week" | "expanded" | "all" =
    modeRaw === "expanded" || modeRaw === "all" ? modeRaw : "week";

  let selectedWeeks: FeedWeek[];
  if (mode === "all") {
    selectedWeeks = filteredWeeks;
  } else if (mode === "expanded") {
    const wanted = new Set(
      (one(sp.weeks) ?? "")
        .split(",")
        .filter(Boolean)
        .map((tok) => {
          const p = parseWeekParam(tok);
          return `${p.isoYear}-${p.isoWeek}`;
        }),
    );
    // Порядок ленты: фильтруем сам filteredWeeks, а не итерируем по CSV.
    selectedWeeks = filteredWeeks.filter((w) => wanted.has(`${w.isoYear}-${w.isoWeek}`));
  } else {
    selectedWeeks = filteredWeeks.filter(
      (w) => w.isoYear === wk.isoYear && w.isoWeek === wk.isoWeek,
    );
  }

  const wLabel = (w: { isoWeek: number }) => `W${String(w.isoWeek).padStart(2, "0")}`;

  // Период/подпись шапки и подвала — по режиму (footPage без «лист 1/1»: многостраничный).
  let title: string;
  let periodLabel: string;
  let period: string;
  let footPage: string;
  if (mode === "expanded") {
    const list = selectedWeeks.map(wLabel).join(", ") || "—";
    title = "Отгрузки — недели";
    periodLabel = "Недели";
    period = `Раскрытые недели: ${list}`;
    footPage = `Отгрузки · раскрытые недели: ${list}`;
  } else if (mode === "all") {
    title = "Отгрузки — лента";
    periodLabel = "Период";
    period = `Сезон ${feed.seasonYear} · все недели по фильтрам`;
    footPage = `Отгрузки · сезон ${feed.seasonYear} · все недели`;
  } else {
    const range = selectedWeeks[0] ? formatWeekRange(selectedWeeks[0]).range : "";
    title = "Отгрузки — неделя";
    periodLabel = "Неделя";
    period = `W${String(wk.isoWeek).padStart(2, "0")}${range ? ` · ${range}` : ""}`;
    footPage = `Отгрузки · W${String(wk.isoWeek).padStart(2, "0")} · неделя`;
  }

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

  // Общий итог по всем включённым неделям — из чистого feedTotals.
  const totals = feedTotals(selectedWeeks);
  const emptyMsg =
    mode === "week" ? "нет отгрузок за выбранную неделю" : "нет отгрузок по выбранным фильтрам";

  // Секция одной недели: шапка недели + таблица (дни/машины) + подытог недели.
  // Каждая машина — в своём <tbody className="mgrp"> для break-inside: avoid при печати.
  const renderWeek = (week: FeedWeek) => {
    const ws = weekSummary(week);
    const wr = formatWeekRange(week).range;
    return (
      <section className="wk-sec" key={`${week.isoYear}-${week.isoWeek}`}>
        <div className="wk-sec-head">
          <span className="wk-num">{wLabel(week)}</span>
          {wr ? <span className="wk-dates"> · {wr}</span> : null}
        </div>
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
          {week.days.map((day) => {
            const ds = daySummary(day);
            const dl = dayLabel(day.date);
            if (day.shipments.length === 0) {
              return (
                <tbody className="dgrp" key={day.date}>
                  <tr className="grp">
                    <td colSpan={8}>
                      <span className="g-title">
                        <span className="gd">{dl.weekday},</span> {dl.date}
                      </span>
                    </td>
                  </tr>
                </tbody>
              );
            }
            return (
              <Fragment key={day.date}>
                <tbody className="dgrp">
                  <tr className="grp">
                    <td colSpan={5}>
                      <span className="g-title">
                        <span className="gd">{dl.weekday},</span> {dl.date}
                      </span>
                    </td>
                    <td className="r g-meta">{fmtInt(ds.totalKg)}</td>
                    <td className="r g-meta">{fmtInt(ds.factKg)}</td>
                    <td className="r g-meta">{fmtInt(ds.acceptedKg)}</td>
                  </tr>
                </tbody>
                {day.shipments.map((m) => (
                  <tbody className="mgrp" key={m.id}>
                    {m.items.map((it, idx) => (
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
                          {it.acceptedKg == null ? (
                            <span className="dim">—</span>
                          ) : (
                            fmtInt(it.acceptedKg)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </Fragment>
            );
          })}
          <tfoot>
            <tr>
              <td colSpan={5} className="lead">
                Итого недели · {ws.machineCount} машин · {ws.positionCount} позиций
              </td>
              <td className="r num">{fmtInt(ws.totalKg)}</td>
              <td className="r num">{fmtInt(ws.factKg)}</td>
              <td className="r num">{fmtInt(ws.acceptedKg)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    );
  };

  return (
    <PrintSheet
      title={title}
      subtitle="Овощное сырьё на завод · лента отгрузок"
      season={`Сезон ${feed.seasonYear}`}
      period={period}
      periodLabel={periodLabel}
      filters={filtersLine}
      footTotal={
        <>
          <b>Итого:</b> <span className="num">{totals.machineCount}</span> машин ·{" "}
          <span className="num">{totals.positionCount}</span> позиций · эффективный вес{" "}
          <span className="num">{fmtTons(totals.totalKg / 1000)} т</span> · принято{" "}
          <span className="num">{fmtTons(totals.acceptedKg / 1000)} т</span>
        </>
      }
      footPage={footPage}
    >
      {selectedWeeks.length === 0 ? (
        <table className="dt">
          <tbody>
            <tr className="empty">
              <td colSpan={8}>{emptyMsg}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        selectedWeeks.map(renderWeek)
      )}
    </PrintSheet>
  );
}
