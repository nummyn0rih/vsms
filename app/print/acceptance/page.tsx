import { getAcceptanceBoard } from "@/server/acceptance/board";
import { computeWeightedBrak } from "@/server/acceptance/accepted";
import type {
  AcceptanceMachine,
  AcceptedMachine,
} from "@/server/acceptance/schema";
import { currentSeasonWeek } from "@/server/shipments/workdays";
import { fmtInt, fmtTons, fmtPct1 } from "@/lib/format";
import { PrintSheet } from "../_components/PrintSheet";

function machineHead(m: { code: string; driverName: string | null; transportCompanyName: string | null }) {
  const drv = [m.driverName, m.transportCompanyName].filter(Boolean).join(" · ") || "—";
  return (
    <>
      <span className="mno">{m.code}</span>
      <div className="mdrv">{drv}</div>
    </>
  );
}

// Зоны «ожидают/на приёмке»: факт/брак/принято ещё не в форме AcceptedPosition —
// показываем факт (если взвешено) и словесный статус, без выдумывания кг.
function PendingZone({
  title,
  hint,
  machines,
}: {
  title: string;
  hint: string;
  machines: AcceptanceMachine[];
}) {
  if (machines.length === 0) return null;
  return (
    <>
      <tr className="grp">
        <td colSpan={6}>
          <span className="g-title">
            {title} <span className="gd">· {hint}</span>
          </span>
        </td>
        <td className="g-meta">требуют акта</td>
      </tr>
      {machines.map((m) =>
        m.items.map((it, idx) => (
          <tr key={`${m.id}-${it.id}`}>
            {idx === 0 && <td rowSpan={m.items.length}>{machineHead(m)}</td>}
            <td>
              <span className="cultname">
                <span className="chip" style={{ background: it.color }} />
                {it.cultureName}
              </span>
            </td>
            <td>{it.farmerName}</td>
            <td className="r num">
              {it.actualKg == null ? <span className="dim">—</span> : fmtInt(it.actualKg)}
            </td>
            <td className="r num dim">—</td>
            <td className="r dim">{it.accepted ? "принято" : "ожидает"}</td>
            <td className={it.actNumber ? "mono" : "dim"}>{it.actNumber ?? "ожидает"}</td>
          </tr>
        )),
      )}
    </>
  );
}

export default async function PrintAcceptancePage() {
  const board = await getAcceptanceBoard();
  const seasonYear = currentSeasonWeek().seasonYear;

  const acceptedPositions = board.zone3.flatMap((m: AcceptedMachine) => m.positions);
  const totalAccepted = acceptedPositions.reduce((a, p) => a + p.acceptedKg, 0);
  const totalActual = acceptedPositions.reduce((a, p) => a + p.actualKg, 0);
  // Средний брак — взвешенный по фактическому весу (Σ брак·факт / Σ факт).
  const weightedBrak = computeWeightedBrak(acceptedPositions);
  const actCount = new Set(
    acceptedPositions.map((p) => p.actNumber).filter((n): n is string => Boolean(n)),
  ).size;

  return (
    <PrintSheet
      title="Приёмка"
      subtitle="Перевеска и приёмка прибывших машин"
      season={`Сезон ${seasonYear}`}
      period={`сезон ${seasonYear} · текущее состояние`}
      footTotal={
        <>
          <b>Итого:</b> принято <span className="num">{fmtInt(totalAccepted)} кг</span> (≈{" "}
          <span className="num">{fmtTons(totalAccepted / 1000)} т</span>) · средний брак{" "}
          <span className="num">{fmtPct1(weightedBrak)}%</span> (взвеш. по факту) · актов{" "}
          <span className="num">{actCount}</span>
        </>
      }
      footPage={`Приёмка · сезон ${seasonYear} · лист 1/1`}
    >
      <table className="dt">
        <colgroup>
          <col style={{ width: "19%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "14%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>№ машины · перевозчик</th>
            <th>Культура</th>
            <th>Поставщик</th>
            <th className="r">Факт, кг</th>
            <th className="r">Брак %</th>
            <th className="r">Принято, кг</th>
            <th>№ акта</th>
          </tr>
        </thead>
        <tbody>
          {board.zone1.length === 0 &&
            board.zone2.length === 0 &&
            board.zone3.length === 0 && (
              <tr className="empty">
                <td colSpan={7}>нет машин в приёмке</td>
              </tr>
            )}

          <PendingZone title="Ожидают перевески" hint="прибыли, факт не введён" machines={board.zone1} />
          <PendingZone title="На приёмке" hint="часть позиций принята" machines={board.zone2} />

          {board.zone3.length > 0 && (
            <>
              <tr className="grp">
                <td colSpan={6}>
                  <span className="g-title">
                    Принято <span className="gd">· акт оформлен</span>
                  </span>
                </td>
                <td className="g-meta">{actCount} актов</td>
              </tr>
              {board.zone3.map((m) =>
                m.positions.map((p, idx) => (
                  <tr key={`${m.id}-${p.id}`}>
                    {idx === 0 && <td rowSpan={m.positions.length}>{machineHead(m)}</td>}
                    <td>
                      <span className="cultname">
                        <span className="chip" style={{ background: p.color }} />
                        {p.cultureName}
                      </span>
                    </td>
                    <td>{p.farmerName}</td>
                    <td className="r num">{fmtInt(p.actualKg)}</td>
                    <td className="r num">{fmtPct1(p.brakPercent)}</td>
                    <td className="r num">{fmtInt(p.acceptedKg)}</td>
                    <td className={p.actNumber ? "mono" : "dim"}>{p.actNumber ?? "—"}</td>
                  </tr>
                )),
              )}
            </>
          )}
        </tbody>
        {board.zone3.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={3} className="lead">
                Итого принято · {actCount} актов
              </td>
              <td className="r num">{fmtInt(totalActual)}</td>
              <td className="r num">{fmtPct1(weightedBrak)}</td>
              <td className="r num">{fmtInt(totalAccepted)}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </PrintSheet>
  );
}
