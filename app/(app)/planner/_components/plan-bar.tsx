// Общий per-строчный бар прогресса Плана (BR-22) — десктопный PlanView и мобильный
// MobilePlanView. Чистая геометрия + presentational-компонент, без данных/агрегации.

// Полка цели: риска-цель и 100%-эффективный садятся на 95,2%, оставляя ~4,8% запаса
// под перелёт (как в макете plan-view-b4). Сравнения tons — с допуском EPS (3 знака).
export const BAR_FILL_PCT = 95.2;
export const BAR_EPS = 0.0005;

export type BarSeg = {
  kind: "actual" | "plan" | "over";
  left: number;
  width: number;
  endcap: boolean;
};
export type BarGeom = { segs: BarSeg[]; tickLeft: number | null; met: boolean };

// Чистая геометрия бара (BR-22). targetTons=null → нет цели: относительная шкала
// scaleOverride (max эффективного по строке), без риски и перелёта. Эффективный вес
// раскладывается на actual (сплошной) + planRemaining (штрих); хвост за целью — over (ink).
export function barGeometry({
  actualTons,
  planRemainingTons,
  targetTons,
  scaleOverride,
}: {
  actualTons: number;
  planRemainingTons: number;
  targetTons: number | null;
  scaleOverride: number;
}): BarGeom {
  const effective = actualTons + planRemainingTons;

  if (targetTons == null) {
    const scaleMax = scaleOverride;
    const pct = (t: number) => (scaleMax > 0 ? (t / scaleMax) * BAR_FILL_PCT : 0);
    const segs: BarSeg[] = [];
    const aw = pct(actualTons);
    const pw = pct(planRemainingTons);
    if (aw > 0) segs.push({ kind: "actual", left: 0, width: aw, endcap: pw === 0 });
    if (pw > 0) segs.push({ kind: "plan", left: aw, width: pw, endcap: true });
    return { segs, tickLeft: null, met: false };
  }

  const scaleMax = Math.max(targetTons, effective);
  const pct = (t: number) => (scaleMax > 0 ? (t / scaleMax) * BAR_FILL_PCT : 0);
  const over = Math.max(0, effective - targetTons);
  const belowTotal = effective - over; // = min(effective, target)
  const actualBelow = Math.min(actualTons, belowTotal);
  const planBelow = belowTotal - actualBelow;

  const segs: BarSeg[] = [];
  const aw = pct(actualBelow);
  const pw = pct(planBelow);
  const ow = pct(over);
  if (aw > 0) segs.push({ kind: "actual", left: 0, width: aw, endcap: false });
  if (pw > 0) segs.push({ kind: "plan", left: aw, width: pw, endcap: false });
  if (ow > 0) segs.push({ kind: "over", left: aw + pw, width: ow, endcap: false });
  if (segs.length) segs[segs.length - 1].endcap = true; // скругление правого края

  return { segs, tickLeft: pct(targetTons), met: effective >= targetTons - BAR_EPS };
}

export function PlanBar({ geom }: { geom: BarGeom }) {
  // Пустая ячейка (ни цели, ни факта): трек всё равно рендерим (класс empty —
  // прозрачный фон), чтобы зарезервировать 6px-слот шкалы и выровнять высоту всех
  // ячеек независимо от заполнения (err-plan).
  const empty = geom.segs.length === 0 && geom.tickLeft == null;
  const cls = [
    "pbar",
    empty ? "blank" : "", // НЕ "empty": совпало бы с глобальным .empty (empty-state)
    geom.tickLeft == null ? "notarget" : "",
    geom.met ? "met" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      {geom.segs.map((s, i) => (
        <div
          key={i}
          className={`bf ${s.kind}${s.endcap ? " endcap" : ""}`}
          style={{ left: `${s.left}%`, width: `${s.width}%` }}
        />
      ))}
      {geom.tickLeft != null && (
        <div className="btick" style={{ left: `${geom.tickLeft}%` }} />
      )}
    </div>
  );
}
