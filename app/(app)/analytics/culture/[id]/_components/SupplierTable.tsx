import { fmtPct1, fmtTons } from "@/lib/format";
import type { CategoryShare } from "@/server/analytics/culture-agg";

import { shade } from "./calibreColors";

type Row = {
  farmerId: number;
  farmerName: string;
  targetTons: number | null;
  acceptedTons: number;
  paidTons: number;
  execPct: number | null;
  categoryPct: CategoryShare[];
  sharePct: number;
};

// Брак от этого уровня выделяем тоном (по прототипу) — не алярм, а акцент.
const BRAK_HI_PCT = 6;
const BRAK_LABEL = "Брак";

// Ломоть тоньше этого в подписи не показываем — легенда перестаёт читаться. В полосе он есть.
const MIN_LEGEND_PCT = 1;

// Доля меньше процента, но ненулевая: «0%» читался бы как «поставок нет».
function sharePctText(pct: number): string {
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

// Мини-стек долей категорий поставщика: полоса 100% факт. веса + компактная легенда.
// База и порядок — из categoryShares (сервер), здесь только подача. Цвета — те же, что у
// большого стека «Калибр»: оттенки культуры на принятых, штриховка янтарём на «не в зачёт».
function CategoryMini({ cats, color }: { cats: CategoryShare[]; color: string }) {
  if (cats.length === 0) return <span className="an-dash">—</span>;

  const acceptedLabels = cats.filter((c) => c.isAccepted).map((c) => c.label);
  const withStyle = cats.map((c) => ({
    ...c,
    bg: c.isAccepted ? shade(color, acceptedLabels.indexOf(c.label)) : null,
    hi: c.label === BRAK_LABEL && c.pct >= BRAK_HI_PCT,
  }));

  return (
    <div className="catmini">
      <div className="bar">
        {withStyle.map((c) => (
          <span
            key={c.label}
            className={`seg${c.bg ? "" : " reject"}`}
            style={{ width: `${c.pct}%`, background: c.bg ?? undefined }}
            title={`${c.label} · ${fmtPct1(c.pct)}%`}
          />
        ))}
      </div>
      <div className="leg">
        {withStyle
          .filter((c) => c.pct >= MIN_LEGEND_PCT)
          .map((c) => (
            <span key={c.label} className={c.hi ? "hi" : undefined}>
              {c.label}&nbsp;{Math.round(c.pct)}%
            </span>
          ))}
      </div>
    </div>
  );
}

export function SupplierTable({
  rows,
  color,
  totalTargetTons,
  totalTons,
  totalPaidTons,
  totalCompletionPct,
  totalCategoryPct,
}: {
  rows: Row[];
  color: string;
  totalTargetTons: number;
  totalTons: number;
  totalPaidTons: number;
  totalCompletionPct: number | null;
  totalCategoryPct: CategoryShare[];
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
            <th className="num">Заявлено, т</th>
            <th className="num">Принято, т</th>
            <th className="num">К оплате, т</th>
            <th className="num">Выполнение</th>
            <th className="l cats">% категорий</th>
            <th className="l scol">Доля в культуре</th>
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
              <td className="num">
                {r.targetTons == null ? (
                  <span className="an-dash">—</span>
                ) : (
                  fmtTons(r.targetTons)
                )}
              </td>
              <td className="num">{fmtTons(r.acceptedTons)}</td>
              <td
                className="num"
                title={
                  r.paidTons > r.acceptedTons
                    ? "принятый вес + доплата по корректировке расчёта (BR-33)"
                    : undefined
                }
              >
                {fmtTons(r.paidTons)}
              </td>
              <td className="num">
                {r.execPct == null ? (
                  <span className="an-dash">—</span>
                ) : (
                  <b>{Math.round(r.execPct)}%</b>
                )}
              </td>
              <td className="l cats">
                <CategoryMini cats={r.categoryPct} color={color} />
              </td>
              <td className="l scol">
                <div className="an-share" title={`${fmtPct1(r.sharePct)}% принятого культуры`}>
                  <div className="trk">
                    <span
                      className="fl"
                      style={{
                        width: `${maxShare > 0 ? (r.sharePct / maxShare) * 100 : 0}%`,
                        background: color,
                      }}
                    />
                  </div>
                  <span className="pc">{sharePctText(r.sharePct)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="l">Итого по культуре</td>
            <td className="num">{fmtTons(totalTargetTons)}</td>
            <td className="num">{fmtTons(totalTons)}</td>
            <td className="num">{fmtTons(totalPaidTons)}</td>
            <td className="num">
              {totalCompletionPct == null ? (
                <span className="an-dash">—</span>
              ) : (
                `${Math.round(totalCompletionPct)}%`
              )}
            </td>
            <td className="l cats">
              <CategoryMini cats={totalCategoryPct} color={color} />
            </td>
            <td className="l scol">
              {/* пустая ячейка на месте полосы — «100%» встаёт под процентами строк */}
              <div className="an-share">
                <span />
                <span className="pc">100%</span>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="an-legend">
        <span style={{ color: "var(--mute)" }}>
          «Заявлено» и «Выполнение» — только у фермеров со строкой контракта по культуре;
          у остальных «—» (объём без плана). «К оплате» — оплачиваемый вес: принятый плюс
          доплата по корректировке расчёта. «% категорий» — доли фактического веса, брак
          от {BRAK_HI_PCT}% выделен тоном.
        </span>
      </div>
    </>
  );
}
