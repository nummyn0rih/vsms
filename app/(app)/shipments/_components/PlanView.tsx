"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import type { PlanWeek } from "@/server/plan/schema";
import {
  loadPlanWeek,
  upsertPlanTarget,
  deletePlanTarget,
  convertDaysToWeek,
  convertWeekToDays,
} from "@/server/plan/actions";
import { PlanInput } from "./PlanInput";

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function shortWeekday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return WEEKDAY_SHORT[(d.getUTCDay() + 6) % 7];
}
function dayMonth(dateStr: string): string {
  return dayMonthFmt.format(new Date(`${dateStr}T00:00:00Z`));
}
// Тонны с 3 знаками, лишние нули обрезаются: 9 → «9», 0.5 → «0,5».
function fmtTons(n: number): string {
  return n.toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
}

export function PlanView({
  seasonYear,
  isoYear,
  isoWeek,
}: {
  seasonYear: number;
  isoYear: number;
  isoWeek: number;
}) {
  const { data: session } = useSession();
  const canEdit = session?.user?.role === "admin";

  const [week, setWeek] = useState<PlanWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState<number | null>(null);
  // version — bump после каждой загрузки/конверсии: входит в key ячеек, заставляя
  // PlanInput ремоунтиться со свежим savedValue (без sync-эффекта внутри ячейки).
  const [version, setVersion] = useState(0);
  // Режим выводится из данных (есть строки → день/неделя). Но у пустой культуры
  // строк нет — нечего конвертировать. Тогда режим держим в клиенте до первого
  // ввода (при сохранении создастся строка нужной гранулярности).
  const [modeOverride, setModeOverride] = useState<Record<number, "day" | "week">>({});
  const reqRef = useRef(0);

  // Загрузка не делает синхронный setState (только в .then) — это синхронизация с
  // внешней системой (сервером), допустимая в эффекте.
  const fetchWeek = useCallback(async () => {
    const my = ++reqRef.current;
    const data = await loadPlanWeek({ seasonYear, isoYear, isoWeek });
    if (my !== reqRef.current) return;
    setWeek(data);
    setVersion((v) => v + 1);
    setLoading(false);
  }, [seasonYear, isoYear, isoWeek]);

  useEffect(() => {
    fetchWeek();
  }, [fetchWeek]);

  // --- Локальные апдейты после автосейва ячейки (без перезапроса) ---
  const setDayTarget = useCallback(
    (cultureId: number, date: string, value: number | null) => {
      setWeek((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((r) => {
            if (r.cultureId !== cultureId) return r;
            const dayTargets = { ...r.dayTargets };
            if (value == null) delete dayTargets[date];
            else dayTargets[date] = value;
            return { ...r, dayTargets };
          }),
        };
      });
    },
    [],
  );
  const setWeekTarget = useCallback(
    (cultureId: number, value: number | null) => {
      setWeek((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((r) =>
            r.cultureId === cultureId ? { ...r, weekTarget: value } : r,
          ),
        };
      });
    },
    [],
  );

  async function toWeekMode(cultureId: number) {
    setConverting(cultureId);
    const res = await convertDaysToWeek({ seasonYear, isoYear, isoWeek, cultureId });
    if (res.ok) await fetchWeek();
    setConverting(null);
  }
  async function toDayMode(cultureId: number) {
    setConverting(cultureId);
    const res = await convertWeekToDays({ seasonYear, isoYear, isoWeek, cultureId });
    if (res.ok) await fetchWeek();
    setConverting(null);
  }

  // Есть ли у строки сохранённые цели (определяет, нужна ли серверная конверсия).
  const rowHasData = (r: PlanWeek["rows"][number]) =>
    r.weekTarget != null || Object.keys(r.dayTargets).length > 0;
  // Эффективный режим: данные есть → из БД (BR-20, одна гранулярность); пусто → override.
  const effMode = (r: PlanWeek["rows"][number]): "day" | "week" =>
    rowHasData(r) ? r.mode : (modeOverride[r.cultureId] ?? "day");

  function switchGran(r: PlanWeek["rows"][number], target: "day" | "week") {
    if (target === effMode(r)) return;
    if (target === "week") {
      if (Object.keys(r.dayTargets).length > 0) toWeekMode(r.cultureId);
      else setModeOverride((m) => ({ ...m, [r.cultureId]: "week" }));
    } else {
      if (r.weekTarget != null) toDayMode(r.cultureId);
      else setModeOverride((m) => ({ ...m, [r.cultureId]: "day" }));
    }
  }

  if (loading && !week) {
    return <div className="feedzone" style={{ padding: 40, color: "var(--mute)" }}>Загрузка плана…</div>;
  }
  if (!week) {
    return (
      <div className="feedzone">
        <div className="empty">
          <h3>Не удалось загрузить план</h3>
          <p>Проверьте подключение и попробуйте сменить неделю.</p>
        </div>
      </div>
    );
  }

  const days = week.days;
  const rowWeekTotal = (r: PlanWeek["rows"][number]): number =>
    r.mode === "week"
      ? (r.weekTarget ?? 0)
      : Object.values(r.dayTargets).reduce((s, v) => s + v, 0);

  // Итоги по столбцам (суммы целей; прогресс — Часть B).
  const dayTotals = days.map((d) =>
    week.rows.reduce(
      (s, r) => s + (r.mode === "day" ? (r.dayTargets[d.date] ?? 0) : 0),
      0,
    ),
  );
  const weekGrandTotal = week.rows.reduce((s, r) => s + rowWeekTotal(r), 0);

  return (
    <div>
      <div className="ctx">
        <span className="week-num">W{week.isoWeek}</span>
        <span className="week-title">
          Неделя {week.isoWeek}{" "}
          <span className="wmeta">
            · {dayMonth(week.startDate)} – {dayMonth(week.endDate)}
          </span>
        </span>
        <span className="season">
          <span className="dot" />
          Сезон {week.seasonYear}
        </span>
        <span className="ag">
          Цель недели <b className="tnum">{fmtTons(weekGrandTotal)} т</b>
        </span>
      </div>

      {week.rows.length === 0 ? (
        <div className="feedzone">
          <div className="empty">
            <h3>Нет активных культур</h3>
            <p>Заведите культуры в справочнике, чтобы планировать цели.</p>
          </div>
        </div>
      ) : (
        <div className="matrixwrap">
          <table className="pmatrix">
            <colgroup>
              <col className="c-cult" />
              {days.map((d) => (
                <col key={d.date} className="c-day" />
              ))}
              <col className="c-week" />
            </colgroup>
            <thead>
              <tr>
                <th className="cult-col">Культура</th>
                {days.map((d) => (
                  <th key={d.date}>
                    <div className="dh">
                      <span className="dh-day">{shortWeekday(d.date)}</span>
                      <span className="dh-date">{dayMonth(d.date)}</span>
                    </div>
                  </th>
                ))}
                <th className="week-col">
                  <span className="wh">Неделя</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {week.rows.map((r) => {
                const isWeek = effMode(r) === "week";
                const busy = converting === r.cultureId;
                return (
                  <tr key={r.cultureId}>
                    <th className="cult-col">
                      <span className="cult-name">
                        <span className="chip" style={{ background: r.color }} />
                        {r.cultureName}
                      </span>
                      {isWeek && (
                        <div className="cult-meta">цель задана на неделю одним итогом</div>
                      )}
                      <div className="gran">
                        <span className="gran-tip">
                          <button
                            type="button"
                            className={!isWeek ? "on" : ""}
                            disabled={!canEdit || busy || !isWeek}
                            onClick={() => switchGran(r, "day")}
                          >
                            Дни
                          </button>
                          {isWeek && canEdit && (
                            <span className="gtip">распределится по рабочим дням</span>
                          )}
                        </span>
                        <span className="gran-tip">
                          <button
                            type="button"
                            className={isWeek ? "on" : ""}
                            disabled={!canEdit || busy || isWeek}
                            onClick={() => switchGran(r, "week")}
                          >
                            Неделя
                          </button>
                          {!isWeek && canEdit && (
                            <span className="gtip">суммируется в одну недельную цель</span>
                          )}
                        </span>
                      </div>
                    </th>

                    {days.map((d) =>
                      isWeek ? (
                        <td key={d.date} className="muted">
                          <div className="pcell muted">
                            <span className="dash">—</span>
                          </div>
                        </td>
                      ) : (
                        <td key={d.date}>
                          <div className="pcell">
                            <PlanInput
                              key={`${r.cultureId}-${d.date}-${version}`}
                              savedValue={r.dayTargets[d.date]}
                              ariaLabel={`${r.cultureName} · ${shortWeekday(d.date)}, цель т`}
                              disabled={!canEdit}
                              onSave={(num) =>
                                upsertPlanTarget({
                                  seasonYear,
                                  isoYear,
                                  isoWeek,
                                  cultureId: r.cultureId,
                                  date: d.date,
                                  targetTons: num,
                                })
                              }
                              onDelete={() =>
                                deletePlanTarget({
                                  seasonYear,
                                  isoYear,
                                  isoWeek,
                                  cultureId: r.cultureId,
                                  date: d.date,
                                })
                              }
                              onSaved={(v) => setDayTarget(r.cultureId, d.date, v)}
                            />
                          </div>
                        </td>
                      ),
                    )}

                    <td className="week-col">
                      <div className="pcell">
                        {isWeek ? (
                          <PlanInput
                            key={`${r.cultureId}-w-${version}`}
                            savedValue={r.weekTarget ?? undefined}
                            ariaLabel={`${r.cultureName} · цель недели т`}
                            weekCol
                            disabled={!canEdit}
                            onSave={(num) =>
                              upsertPlanTarget({
                                seasonYear,
                                isoYear,
                                isoWeek,
                                cultureId: r.cultureId,
                                date: null,
                                targetTons: num,
                              })
                            }
                            onDelete={() =>
                              deletePlanTarget({
                                seasonYear,
                                isoYear,
                                isoWeek,
                                cultureId: r.cultureId,
                                date: null,
                              })
                            }
                            onSaved={(v) => setWeekTarget(r.cultureId, v)}
                          />
                        ) : (
                          // День-режим: «Неделя» = Σ дней (read-only).
                          <span className="ptin ro">
                            <input
                              readOnly
                              tabIndex={-1}
                              value={fmtTons(rowWeekTotal(r))}
                              aria-label={`${r.cultureName} · сумма недели т`}
                            />
                            <span className="u">т</span>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th className="cult-col">Итого недели</th>
                {dayTotals.map((t, i) => (
                  <td key={days[i].date}>{fmtTons(t)}</td>
                ))}
                <td className="week-col">{fmtTons(weekGrandTotal)} т</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
