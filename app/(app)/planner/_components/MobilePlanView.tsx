"use client";

import { useState } from "react";
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Clock, Lock } from "lucide-react";

import type { PlanRow, PlanWeek } from "@/server/plan/schema";
import {
  compareIsoWeek,
  currentSeasonWeek,
  formatWeekParam,
  isoWeek as isoWeekOf,
  isoWeekRange,
  seasonWeekBounds,
} from "@/server/shipments/workdays";
import { fmtTons } from "@/lib/format";
import { EPS, rowPlan, weekBarGeometry, weekHeadline } from "@/app/(app)/shipments/_components/summary-fill";
import { writeUrlParam } from "@/app/(app)/shipments/_components/week-format";
import { barGeometry, PlanBar } from "./plan-bar";
import { usePlanWeek } from "./usePlanWeek";

type Week = { seasonYear: number; isoYear: number; isoWeek: number };

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "UTC" });

function shortWeekday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return WEEKDAY_SHORT[(d.getUTCDay() + 6) % 7];
}
function isoWeekRangeLabel(isoYear: number, isoWeek: number): string {
  const { start, end } = isoWeekRange(isoYear, isoWeek);
  return `${dayFmt.format(start)}–${dayMonthFmt.format(end)}`;
}

// Мобильный «План» (md:hidden) — read-only карточки прогресса по культурам. Тот же
// getPlanWeek (usePlanWeek) и те же чистые формулы, что десктопный PlanView: per-строчный
// бар barGeometry (BR-22), итог недели weekHeadline/weekBarGeometry (summary-fill). Правка
// целей — только десктоп; здесь ни инпутов, ни мутаций. Неделя — в ?week (writeUrlParam).
export function MobilePlanView({ initialWeek }: { initialWeek: Week }) {
  const [week, setWeek] = useState<Week>(initialWeek);
  const { week: data, loading } = usePlanWeek({ ...week, enabled: true });

  function stepWeek(delta: number) {
    setWeek((p) => {
      const { start } = isoWeekRange(p.isoYear, p.isoWeek);
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + delta * 7);
      const w = isoWeekOf(d);
      const b = seasonWeekBounds(p.seasonYear);
      if (compareIsoWeek(w, b.first) < 0 || compareIsoWeek(w, b.last) > 0) return p;
      const next = { seasonYear: p.seasonYear, isoYear: w.isoYear, isoWeek: w.isoWeek };
      writeUrlParam("week", formatWeekParam(next));
      return next;
    });
  }
  function goToday() {
    const c = currentSeasonWeek();
    const next = { seasonYear: c.seasonYear, isoYear: c.isoYear, isoWeek: c.isoWeek };
    setWeek(next);
    writeUrlParam("week", formatWeekParam(next));
  }
  const bounds = seasonWeekBounds(week.seasonYear);
  const atFirst = compareIsoWeek(week, bounds.first) <= 0;
  const atLast = compareIsoWeek(week, bounds.last) >= 0;

  return (
    <>
      <div className="mweekbar">
        <div className="mweekbar-row">
          <div className="mweeknav">
            <button type="button" title="Предыдущая неделя" onClick={() => stepWeek(-1)} disabled={atFirst}>
              <ChevronLeft />
            </button>
            <div className="wlab">
              <span className="wm">W{week.isoWeek}</span> {isoWeekRangeLabel(week.isoYear, week.isoWeek)}
            </div>
            <button type="button" title="Следующая неделя" onClick={() => stepWeek(1)} disabled={atLast}>
              <ChevronRight />
            </button>
          </div>
          <button type="button" className="today-btn" onClick={goToday}>
            Сегодня
          </button>
        </div>
      </div>

      <div className="ro-hint">
        <Lock />
        Просмотр — <b>правка целей на десктопе</b>.
      </div>

      {loading && !data ? (
        <div className="feedzone" style={{ padding: 40, color: "var(--mute)" }}>
          Загрузка плана…
        </div>
      ) : !data ? (
        <div className="feedzone">
          <div className="empty">
            <h3>Не удалось загрузить план</h3>
            <p>Проверьте подключение и попробуйте сменить неделю.</p>
          </div>
        </div>
      ) : data.rows.length === 0 ? (
        <div className="m-empty">
          <div className="ec-ic">
            <CalendarRange />
          </div>
          <div className="et">План на неделю не задан</div>
          <div className="ed">
            На неделе {data.isoWeek} пока нет ни целей по культурам, ни отгрузок.
          </div>
          <div className="ea">
            Задать недельные цели можно на десктопе — прогресс начнёт заполняться по мере
            планирования и перевески.
          </div>
        </div>
      ) : (
        <PlanCards week={data} />
      )}
    </>
  );
}

function PlanCards({ week }: { week: PlanWeek }) {
  const { plan, fact, pct } = weekHeadline(week);
  const wbar = weekBarGeometry(week);

  return (
    <>
      <div className="pcards">
        {week.rows.map((r) => (
          <PlanCard key={r.cultureId} row={r} days={week.days} />
        ))}
      </div>

      <div className="wtotal">
        <div className="wtotal-row">
          <span className="wtotal-lab">Итог недели</span>
          <span className="wtotal-fig tnum">
            {fmtTons(fact)} т
            {wbar.hasPlan && <span className="goal">/ {fmtTons(plan)} т</span>}
            {pct != null && <span className="pctv">{pct}%</span>}
          </span>
        </div>
        <div className="pbar">
          {wbar.actualPct > 0 && (
            <div
              className={`bf actual${!wbar.hasPlan || wbar.planPct + wbar.overPct <= 0 ? " endcap" : ""}`}
              style={{ left: "0%", width: `${wbar.actualPct}%` }}
            />
          )}
          {wbar.planPct > 0 && (
            <div
              className={`bf plan${wbar.overPct <= 0 ? " endcap" : ""}`}
              style={{ left: `${wbar.actualPct}%`, width: `${wbar.planPct}%` }}
            />
          )}
          {wbar.overPct > 0 && (
            <div
              className="bf over endcap"
              style={{ left: `${wbar.actualPct + wbar.planPct}%`, width: `${wbar.overPct}%` }}
            />
          )}
          {wbar.tickLeft != null && <div className="btick" style={{ left: `${wbar.tickLeft}%` }} />}
        </div>
      </div>

      <div className="legend">
        <span>
          <span className="lg-sw actual" />
          перевешено
        </span>
        <span>
          <span className="lg-sw plan" />
          план
        </span>
        <span>
          <span className="lg-tick" />
          цель
        </span>
        <span>
          <span className="lg-sw over" />
          перелёт
        </span>
      </div>
    </>
  );
}

function PlanCard({ row: r, days }: { row: PlanRow; days: PlanWeek["days"] }) {
  const [open, setOpen] = useState(false);
  const isWeek = r.mode === "week";

  const rPlan = rowPlan(r);
  const rHasPlan = rPlan > EPS;
  const wp = r.weekProgress;
  const rFact = wp.effectiveTons;

  const geom = barGeometry({
    actualTons: wp.actualTons,
    planRemainingTons: wp.planRemainingTons,
    targetTons: rHasPlan ? rPlan : null,
    scaleOverride: wp.effectiveTons,
  });

  // % и Δ (BR-22): pct = факт(эффективный) / план; факт-0 подсвечиваем «планом».
  const pctNum = rHasPlan ? Math.round((rFact / rPlan) * 100) : null;
  const delta = rHasPlan ? rFact - rPlan : 0;
  const factZero = wp.actualTons <= EPS;

  // Пересказ дней для peek-строки свёрнутой разбивки (только непустые).
  const peek = !isWeek
    ? days
        .map((d) => ({ d, v: r.dayProgress[d.date]?.effectiveTons ?? 0 }))
        .filter((x) => x.v > EPS)
        .map((x) => `${shortWeekday(x.d.date)} ${fmtTons(x.v)}`)
        .join(" · ")
    : "";

  return (
    <div className={`pcard${open ? " open" : ""}`}>
      <div className="pcard-main">
        <div className="pcard-top">
          <span className="pcard-cult">
            <span className="chip" style={{ background: r.color }} />
            {r.cultureName}
            {isWeek && <span className="wk-badge">неделя</span>}
          </span>
          <span className="pcard-fig">
            <span className="val tnum">
              {fmtTons(rFact)} <span className="goal">/ {rHasPlan ? `${fmtTons(rPlan)} т` : "— т"}</span>
            </span>
          </span>
        </div>

        <PlanBar geom={geom} />

        <div className="pcard-cap">
          {rHasPlan ? (
            <span className="pcard-pct tnum">
              {pctNum}%{factZero ? " планом · факт 0" : " выполнено"}
            </span>
          ) : (
            <span className="pcard-pct zero tnum">цель не задана</span>
          )}
          {rHasPlan &&
            (delta > EPS ? (
              <span className="wdelta over tnum">+{fmtTons(delta)} т</span>
            ) : delta < -EPS ? (
              <span className="wdelta under tnum">−{fmtTons(Math.abs(delta))} т</span>
            ) : null)}
          {!rHasPlan && <span className="wdelta na tnum">факт {fmtTons(rFact)} т</span>}
        </div>
      </div>

      {isWeek ? (
        <div className="pcard-wknote">
          <Clock />
          Цель задана на неделю одним итогом — без дневной разбивки (BR-23).
        </div>
      ) : (
        <>
          <button type="button" className="pcard-days-toggle" onClick={() => setOpen((o) => !o)}>
            По дням
            <span className="peek">{peek || "нет перевески"}</span>
            <span className="chev">
              <ChevronDown />
            </span>
          </button>
          {open && (
            <div className="pcard-days">
              <DayStrip row={r} days={days} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DayStrip({ row: r, days }: { row: PlanRow; days: PlanWeek["days"] }) {
  // Общая шкала строки для no-target дней (сопоставимые высоты); для дней с целью
  // barGeometry сам берёт max(target, eff) — как в десктопных дневных ячейках.
  const scale = Math.max(EPS, ...days.map((d) => r.dayProgress[d.date]?.effectiveTons ?? 0));

  return (
    <div className="dstrip" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
      {days.map((d) => {
        const dp = r.dayProgress[d.date];
        const target = r.dayTargets[d.date] ?? null;
        const eff = dp?.effectiveTons ?? 0;
        const zero = eff <= EPS;
        const geom = barGeometry({
          actualTons: dp?.actualTons ?? 0,
          planRemainingTons: dp?.planRemainingTons ?? 0,
          targetTons: target,
          scaleOverride: scale,
        });
        return (
          <div key={d.date} className="dcol">
            <span className="dlbl">{shortWeekday(d.date)}</span>
            <div className={`dmini${geom.met ? " met" : ""}`}>
              {geom.tickLeft != null && (
                <div className="dtick" style={{ top: `${Math.max(0, 100 - geom.tickLeft)}%` }} />
              )}
              {geom.segs.map((s, i) => (
                <div key={i} className={`df ${s.kind}`} style={{ height: `${s.width}%` }} />
              ))}
            </div>
            <span className={`dval tnum${zero ? " zero" : ""}`}>{zero ? "0" : fmtTons(eff)}</span>
            {target != null && <span className="dgoal tnum">/ {fmtTons(target)}</span>}
          </div>
        );
      })}
    </div>
  );
}
