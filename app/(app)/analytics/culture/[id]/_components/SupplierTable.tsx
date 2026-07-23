import { fmtPct1, fmtTons } from "@/lib/format";

type Row = {
  farmerId: number;
  farmerName: string;
  acceptedTons: number;
  execPct: number | null;
  brakPct: number | null;
  sharePct: number;
};

// Брак от этого уровня выделяем тоном (по прототипу) — не алярм, а акцент.
const BRAK_HI_PCT = 6;

export function SupplierTable({
  rows,
  color,
  totalTons,
  totalCompletionPct,
  totalBrakPct,
}: {
  rows: Row[];
  color: string;
  totalTons: number;
  totalCompletionPct: number | null;
  totalBrakPct: number | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="an-empty">
        <div className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
          </svg>
        </div>
        <div className="t">Поставок пока нет</div>
        <div className="d">По этой культуре в сезоне ещё нет принятых позиций.</div>
      </div>
    );
  }

  const maxShare = Math.max(...rows.map((r) => r.sharePct), 0);

  return (
    <>
      <table className="an-stbl">
        <thead>
          <tr>
            <th className="l">Фермер</th>
            <th className="num">Принято, т</th>
            <th className="num">Выполнение</th>
            <th className="num">Брак</th>
            <th className="l" style={{ width: 200 }}>
              Доля в культуре
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.farmerId}>
              <td className="l">
                <div className="farmer">
                  <span
                    className="an-cchip"
                    style={{ width: 8, height: 8, borderRadius: 2, background: color }}
                  />
                  <span className="nm">{r.farmerName}</span>
                </div>
              </td>
              <td className="num">{fmtTons(r.acceptedTons)}</td>
              <td className="num">
                {r.execPct == null ? (
                  <span className="an-dash">—</span>
                ) : (
                  <b>{Math.round(r.execPct)}%</b>
                )}
              </td>
              <td
                className={`num brak-v${r.brakPct != null && r.brakPct >= BRAK_HI_PCT ? " hi" : ""}`}
              >
                {r.brakPct == null ? (
                  <span className="an-dash">—</span>
                ) : (
                  `${fmtPct1(r.brakPct)}%`
                )}
              </td>
              <td className="l">
                <div className="sharebar">
                  <div className="trk">
                    <span
                      className="fl"
                      style={{
                        width: `${maxShare > 0 ? (r.sharePct / maxShare) * 100 : 0}%`,
                        background: color,
                      }}
                    />
                  </div>
                  <span className="pc">{Math.round(r.sharePct)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="l">Итого по культуре</td>
            <td className="num">{fmtTons(totalTons)}</td>
            <td className="num">
              {totalCompletionPct == null ? (
                <span className="an-dash">—</span>
              ) : (
                `${Math.round(totalCompletionPct)}%`
              )}
            </td>
            <td className="num">
              {totalBrakPct == null ? (
                <span className="an-dash">—</span>
              ) : (
                `${fmtPct1(totalBrakPct)}%`
              )}
            </td>
            <td
              className="l"
              style={{
                color: "var(--mute)",
                fontFamily: "var(--font-mono), monospace",
                fontSize: 11,
              }}
            >
              100%
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="an-legend">
        <span style={{ color: "var(--mute)" }}>
          «Выполнение» — только у фермеров со строкой контракта по культуре; у остальных «—»
          (объём без плана). Брак от {BRAK_HI_PCT}% выделен тоном.
        </span>
      </div>
    </>
  );
}
