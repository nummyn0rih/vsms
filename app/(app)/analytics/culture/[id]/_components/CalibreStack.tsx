import { fmtPct1, fmtTons } from "@/lib/format";

type Cat = { label: string; isAccepted: boolean; pct: number; tons: number };

// Сегмент уже слишком узкий для подписи внутри полосы — только легенда.
const MIN_LABEL_PCT = 12;

// Оттенок принятой категории: чем дальше по списку, тем светлее (структура партии читается
// одной полосой). Нестандарт — штриховка янтарём (класс .reject).
function shade(color: string, index: number): string {
  const mix = Math.max(30, 100 - index * 26);
  return `color-mix(in srgb, ${color} ${mix}%, #ffffff)`;
}

export function CalibreStack({ data, color }: { data: Cat[]; color: string }) {
  if (data.length === 0) {
    return (
      <div className="an-empty">
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="10" width="18" height="6" rx="2" />
          </svg>
        </div>
        <div className="t">Данных пока нет</div>
        <div className="d">Доли категорий появятся с первыми актами приёмки по калибру.</div>
      </div>
    );
  }

  // порядковый номер среди принятых категорий (задаёт оттенок); нестандарт — штриховка
  const acceptedLabels = data.filter((c) => c.isAccepted).map((c) => c.label);
  const withStyle = data.map((c) => ({
    ...c,
    bg: c.isAccepted ? shade(color, acceptedLabels.indexOf(c.label)) : null,
  }));

  return (
    <>
      <div className="an-calbar">
        {withStyle.map((c) => (
          <div
            key={c.label}
            className={`seg${c.bg ? "" : " reject"}`}
            style={{
              width: `${c.pct}%`,
              background: c.bg ?? undefined,
              color: c.bg ? "var(--ink)" : "#ffffff",
            }}
            title={`${c.label} · ${fmtPct1(c.pct)}%`}
          >
            {c.pct >= MIN_LABEL_PCT ? `${Math.round(c.pct)}%` : ""}
          </div>
        ))}
      </div>
      <div className="an-calleg">
        {withStyle.map((c) => (
          <div className="row" key={c.label}>
            <span
              className={`sw${c.bg ? "" : " reject"}`}
              style={c.bg ? { background: c.bg } : undefined}
            />
            <span className="nm">
              {c.label}
              {!c.isAccepted && " — не в зачёт"}
            </span>
            <span className="val">
              {fmtPct1(c.pct)}%&nbsp;<span className="sm">· {fmtTons(c.tons)} т</span>
            </span>
          </div>
        ))}
      </div>
      <div className="an-legend">
        <span style={{ color: "var(--mute)" }}>
          Категории и признак «в зачёт» — из схемы калибров культуры; доли взвешены по
          фактическому весу позиций.
        </span>
      </div>
    </>
  );
}
