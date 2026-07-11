"use client";

import {
  useCallback,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useSession } from "next-auth/react";

import type { CellProgress, PlanWeek } from "@/server/plan/schema";
import {
  upsertPlanTarget,
  deletePlanTarget,
  convertDaysToWeek,
  convertWeekToDays,
} from "@/server/plan/actions";
import { fmtTons } from "@/lib/format";
import { PlanInput } from "./PlanInput";
import { barGeometry, PlanBar } from "./plan-bar";

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

const EMPTY_PROGRESS: CellProgress = {
  actualTons: 0,
  planRemainingTons: 0,
  effectiveTons: 0,
};

// Геометрия бара и PlanBar — общий модуль ./plan-bar (переиспользует MobilePlanView).
// Сравнения tons — с допуском EPS (3 знака).
const EPS = 0.0005;

// Подпись дневной ячейки: «{эффективный} / {цель}» или «{эффективный} нет цели».
function DayCaption({ progress, target }: { progress: CellProgress; target: number | null }) {
  const eff = progress.effectiveTons;
  if (target == null) {
    return eff > EPS ? (
      <span className="pcap tnum">
        {fmtTons(eff)} <span className="nt-hint">нет цели</span>
      </span>
    ) : (
      <span className="pcap zero tnum">
        — <span className="nt-hint">нет</span>
      </span>
    );
  }
  return (
    <span className={`pcap tnum${eff <= EPS ? " zero" : ""}`}>
      {fmtTons(eff)} <span className="t-goal">/ {fmtTons(target)}</span>
    </span>
  );
}

// Подпись недельной ячейки/итога: «{эффективный} / {цель}» + бейдж дельты.
function WeekCaption({ progress, target }: { progress: CellProgress; target: number | null }) {
  const eff = progress.effectiveTons;
  if (target == null || target <= EPS) {
    return (
      <div className="wcap">
        <span className="wval tnum">{fmtTons(eff)} т</span>
        <span className="nt-hint">цель не задана</span>
      </div>
    );
  }
  const delta = eff - target;
  let badge: ReactNode = null;
  if (delta > EPS) {
    badge = <span className="wdelta over tnum">+{fmtTons(delta)}</span>;
  } else if (delta < -EPS && progress.actualTons > EPS) {
    // Недобор по факту. В B4a перевески нет (actual=0) → бейдж не показываем
    // («факт 0» убран до B4b, чтобы план не читался как факт).
    badge = <span className="wdelta under tnum">−{fmtTons(Math.abs(delta))}</span>;
  }
  // Бейдж факта (B4b): где есть перевеска (actual > 0) — показываем набранный факт
  // отдельным нейтральным чипом, рядом с ±delta. Где факта нет — не шумим.
  const factBadge =
    progress.actualTons > EPS ? (
      <span className="wdelta fact tnum">факт {fmtTons(progress.actualTons)}</span>
    ) : null;
  return (
    <div className="wcap">
      <span className="wval tnum">
        {fmtTons(eff)} <span className="t-goal">/ {fmtTons(target)}</span>
      </span>
      {badge}
      {factBadge}
    </div>
  );
}

export function PlanView({
  seasonYear,
  isoYear,
  isoWeek,
  week,
  setWeek,
  loading,
  version,
  reload,
  onOpenScope,
}: {
  seasonYear: number;
  isoYear: number;
  isoWeek: number;
  week: PlanWeek | null;
  setWeek: Dispatch<SetStateAction<PlanWeek | null>>;
  loading: boolean;
  version: number;
  reload: () => Promise<void>;
  onOpenScope: () => void;
}) {
  const { data: session } = useSession();
  const canEdit = session?.user?.role === "admin";

  const [converting, setConverting] = useState<number | null>(null);
  // Режим выводится из данных (есть строки → день/неделя). Но у пустой культуры
  // строк нет — нечего конвертировать. Тогда режим держим в клиенте до первого
  // ввода (при сохранении создастся строка нужной гранулярности).
  const [modeOverride, setModeOverride] = useState<Record<number, "day" | "week">>({});

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
    [setWeek],
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
    [setWeek],
  );

  async function toWeekMode(cultureId: number) {
    setConverting(cultureId);
    const res = await convertDaysToWeek({ seasonYear, isoYear, isoWeek, cultureId });
    if (res.ok) await reload();
    setConverting(null);
  }
  async function toDayMode(cultureId: number) {
    setConverting(cultureId);
    const res = await convertWeekToDays({ seasonYear, isoYear, isoWeek, cultureId });
    if (res.ok) await reload();
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

  // Итоги по столбцам (суммы целей).
  const dayTotals = days.map((d) =>
    week.rows.reduce(
      (s, r) => s + (r.mode === "day" ? (r.dayTargets[d.date] ?? 0) : 0),
      0,
    ),
  );
  const weekGrandTotal = week.rows.reduce((s, r) => s + rowWeekTotal(r), 0);
  const weekEffectiveTotal = week.weekTotalProgress.effectiveTons;

  // Цель недели по строке для бара: week-режим → r.weekTarget; day-режим → Σ дней
  // (null, если целей нет → бар без риски).
  const rowWeekTarget = (r: PlanWeek["rows"][number]): number | null => {
    const t = rowWeekTotal(r);
    return t > 0 ? t : null;
  };
  // Headline «набрано» (BR-22): только культуры, у которых есть цель. Факт неплановых
  // культур в выполнение плана не идёт (остаётся в их строках).
  const headlineEffective = week.rows.reduce(
    (s, r) => s + (rowWeekTarget(r) != null ? r.weekProgress.effectiveTons : 0),
    0,
  );
  // No-target дневные ячейки масштабируются к max эффективного по строке (построчно).
  const rowMaxEffective = (r: PlanWeek["rows"][number]): number =>
    days.reduce((m, d) => Math.max(m, r.dayProgress[d.date]?.effectiveTons ?? 0), 0);

  // Совсем пусто: ни целей, ни отгрузок на неделе — показываем хинт над сеткой.
  const fullyEmpty = weekGrandTotal <= 0 && weekEffectiveTotal <= 0;

  return (
    <div className="plan-view">
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
        <span className="plan-headline">
          {weekGrandTotal > 0 ? (
            <>
              План недели:{" "}
              <b className="tnum">
                {fmtTons(headlineEffective)} / {fmtTons(weekGrandTotal)} т
              </b>
            </>
          ) : (
            <>
              План недели: <b>не задан</b>
            </>
          )}
        </span>
      </div>

      {week.scopePicker.length === 0 ? (
        <div className="feedzone">
          <div className="empty">
            <h3>Нет активных культур</h3>
            <p>Заведите культуры в справочнике, чтобы планировать цели.</p>
          </div>
        </div>
      ) : week.rows.length === 0 ? (
        // Пустая неделя (BR-23): нет состава и нет активности. Не вываливаем все
        // культуры — даём точку входа в combobox состава.
        <div className="feedzone">
          <div className="empty">
            <h3>Состав недели пуст</h3>
            <p>Выберите культуры, которые планируются на этой неделе.</p>
            {canEdit ? (
              <button type="button" className="scope-add-btn" onClick={onOpenScope}>
                <svg
                  width={15}
                  height={15}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Добавить культуры в план недели
              </button>
            ) : (
              <p className="ro-note">Состав задаёт администратор.</p>
            )}
          </div>
        </div>
      ) : (
        <>
          {fullyEmpty && (
            <div className="plan-hint">
              План на неделю не задан — задайте недельные цели по культурам, прогресс
              начнёт заполняться по мере планирования и перевески.
            </div>
          )}
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
                      <div className="cult-head">
                      <span className="cult-name">
                        <span className="chip" style={{ background: r.color }} />
                        {r.cultureName}
                      </span>
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
                            <PlanBar
                              geom={barGeometry({
                                actualTons: (r.dayProgress[d.date] ?? EMPTY_PROGRESS).actualTons,
                                planRemainingTons: (r.dayProgress[d.date] ?? EMPTY_PROGRESS).planRemainingTons,
                                targetTons: r.dayTargets[d.date] ?? null,
                                scaleOverride: rowMaxEffective(r),
                              })}
                            />
                            <DayCaption
                              progress={r.dayProgress[d.date] ?? EMPTY_PROGRESS}
                              target={r.dayTargets[d.date] ?? null}
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
                        <PlanBar
                          geom={barGeometry({
                            actualTons: r.weekProgress.actualTons,
                            planRemainingTons: r.weekProgress.planRemainingTons,
                            targetTons: rowWeekTarget(r),
                            scaleOverride: r.weekProgress.effectiveTons,
                          })}
                        />
                        <WeekCaption progress={r.weekProgress} target={rowWeekTarget(r)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th className="cult-col">Итого</th>
                {dayTotals.map((t, i) => {
                  const eff = week.dayTotalsProgress[i]?.effectiveTons ?? 0;
                  return (
                    <td key={days[i].date}>
                      {t > 0 ? (
                        <>
                          {fmtTons(eff)}{" "}
                          <span className="t-goal">/ {fmtTons(t)}</span>
                        </>
                      ) : eff > 0 ? (
                        fmtTons(eff)
                      ) : (
                        "—"
                      )}
                    </td>
                  );
                })}
                <td className="week-col">
                  <div className="foot-total">
                    Итого по неделе:{" "}
                    <b className="tnum">{fmtTons(weekEffectiveTotal)} т</b>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
