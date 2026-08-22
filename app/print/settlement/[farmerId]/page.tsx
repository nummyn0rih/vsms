import { notFound } from "next/navigation";

import { fmtInt, fmtPct1, fmtPercent, fmtPrice, fmtTons } from "@/lib/format";
import { getFarmerSettlement } from "@/server/farmers/settlement";
import type { SettlementLine } from "@/server/farmers/settlement-agg";
import { PENDING_STATUS, UNPAID_REASON } from "@/server/farmers/settlement-labels";
import { periodColumnSuffix } from "@/server/farmers/settlement-period";
import { currentSeasonWeek } from "@/server/shipments/workdays";
import { PrintSheet } from "../../_components/PrintSheet";

// Печатный лист «Расчёт с поставщиком» (A4 portrait) — печатная копия вкладки «Расчёты»
// карточки фермера. Read-only, источник — ТОТ ЖЕ getFarmerSettlement, что у экрана:
// второй выборки и второй агрегации нет, поэтому числа сходятся с экраном и с вкладкой
// «Контракты» тождественно. Формул в этом файле нет — только форматирование.
//
// Фермер — в пути, сезон — в ?season= (дефолт текущий), период — в ?period=&from=&to=
// (разбирает resolveSettlementPeriod внутри загрузчика, своего разбора здесь НЕТ).
// ?detail=0 — свод без партий (лист у фермера с десятком строк иначе уходит на несколько
// страниц); любое другое значение и его отсутствие — детализация по партиям.
//
// ⚠ Лист показывает НАЧИСЛЕНО. Платежей и авансов в системе нет, поэтому колонок
// «оплачено»/«долг»/«остаток» здесь быть не может. № машины не печатается — его нет ни на
// экране, ни во входных данных листа.
// PDF — браузерное «Сохранить как PDF» с этого листа; PDF-библиотек в проекте нет.

// Даты в БД — UTC-полночь; локальная зона сдвинула бы день. На бумаге — с годом
// (в отличие от экранного «21 авг.»): лист уходит наружу и подшивается.
const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function fmtDate(d: string | null): string {
  return d ? dateFmt.format(new Date(`${d}T00:00:00Z`)) : "—";
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function Culture({ color, name }: { color: string; name: string }) {
  return (
    <span className="cultname">
      <span className="chip" style={{ background: color }} />
      {name}
    </span>
  );
}

// Партии одной строки контракта (режим detail). Отдельная подтаблица, а не колонки
// основной: у партии свой набор величин, в свод они не встают.
function BatchTable({
  line,
  showSurcharge,
  showAdjust,
}: {
  line: SettlementLine;
  showSurcharge: boolean;
  showAdjust: boolean;
}) {
  const cols = 8 + (showAdjust ? 1 : 0) + (showSurcharge ? 1 : 0);

  return (
    <table className="st-batches">
      <thead>
        <tr>
          <th>Дата</th>
          <th>№ акта</th>
          <th>Культура</th>
          <th className="r">Факт, кг</th>
          <th className="r">Принято, кг</th>
          {showAdjust && <th className="r">Корр., %</th>}
          <th className="r">Зачтено, кг</th>
          {showSurcharge && <th className="r">Доплата, кг</th>}
          <th className="r">К оплате, кг</th>
          <th className="r">Сумма, ₽</th>
        </tr>
      </thead>

      {line.batches.map((b) => {
        const p = b.position;
        // Пояснения к ПАРТИИ ЦЕЛИКОМ — отдельной строкой под числами.
        const note =
          p.nonStandardPercent > 0 || (p.brakPercent ?? 0) > 0 || p.linesCount > 1;

        return (
          <tbody key={b.itemId} className="st-bgrp">
            <tr>
              <td className="num">{fmtDate(b.date)}</td>
              <td className="num">{b.actNumber ?? "—"}</td>
              <td>
                <Culture color={b.color} name={b.cultureName} />
              </td>
              {/* ⚠ факт и «принято по акту» — величины ПОЗИЦИИ ЦЕЛИКОМ: при
                  linesCount > 1 они повторяются в каждой строке контракта, куда
                  попала партия, и по колонкам НЕ суммируются. */}
              <td className="r num dim">
                {p.actualKg != null ? fmtInt(p.actualKg) : "—"}
              </td>
              <td className="r num dim">
                {p.acceptedKg != null ? fmtInt(p.acceptedKg) : "—"}
                {p.acceptedKg != null && (
                  <span className="st-sub"> ({fmtPct1(p.acceptedPercent)} %)</span>
                )}
              </td>
              {showAdjust && (
                <td className="r num">
                  {b.settlementPercent != null ? fmtPercent(b.settlementPercent) : "—"}
                </td>
              )}
              <td className="r num">{fmtInt(b.countedKg)}</td>
              {showSurcharge && (
                <td className="r num">
                  {b.surchargeKg > 0 ? `+${fmtInt(b.surchargeKg)}` : "—"}
                </td>
              )}
              <td className="r num st-paid">{fmtInt(b.paidKg)}</td>
              <td className="r num st-paid">{fmtInt(b.costRub)}</td>
            </tr>
            {note && (
              <tr className="st-bnote">
                <td colSpan={cols}>
                  {p.nonStandardPercent > 0 && (
                    <span>нестандарт {fmtPct1(p.nonStandardPercent)} %</span>
                  )}
                  {p.brakPercent != null && p.brakPercent > 0 && (
                    <span>
                      {p.nonStandardPercent > 0 ? " · " : ""}брак{" "}
                      {fmtPct1(p.brakPercent)} %
                    </span>
                  )}
                  {p.linesCount > 1 && (
                    <span>
                      {p.nonStandardPercent > 0 ||
                      (p.brakPercent != null && p.brakPercent > 0)
                        ? " · "
                        : ""}
                      партия делится на {p.linesCount} строки контракта
                    </span>
                  )}
                </td>
              </tr>
            )}
        </tbody>
        );
      })}
    </table>
  );
}

export default async function PrintSettlementPage({
  params,
  searchParams,
}: {
  params: Promise<{ farmerId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { farmerId } = await params;
  const id = Number(farmerId);
  if (!Number.isInteger(id)) notFound();

  const sp = await searchParams;
  const raw = one(sp.season);
  const parsed = raw ? Number(raw) : NaN;
  const season = Number.isInteger(parsed) ? parsed : currentSeasonWeek().seasonYear;

  // ?detail=0 → свод; отсутствие параметра и любое другое значение → детализация.
  const detail = one(sp.detail) !== "0";

  // period/from/to уходят в загрузчик как есть: нормализацию (включая падение битых
  // значений в «сезон») делает resolveSettlementPeriod, дублировать её здесь нельзя.
  const data = await getFarmerSettlement({
    farmerId: id,
    season,
    period: one(sp.period),
    from: one(sp.from),
    to: one(sp.to),
  });
  if (!data) notFound();

  const { farmer, lines, totals, unpaid, unpaidTotals, pending, notes, period } = data;
  const showSurcharge = notes.hasSurcharge;
  const columns = showSurcharge ? 8 : 7;
  const suffix = periodColumnSuffix(period);
  // Колонка корректировки — по факту наличия значения на листе (проверка присутствия,
  // не расчёт): settlement_percent может быть задан и при нулевой доплате.
  const showAdjust = lines.some((l) => l.batches.some((b) => b.settlementPercent != null));

  const nothing = lines.length === 0 && unpaid.length === 0 && pending.length === 0;
  // Ожидающие приёмки в расчёт не входят, поэтому на «пустоту периода» не влияют.
  const nothingInPeriod = totals.countedKg === 0 && unpaid.length === 0;

  // Та же Σ, что делает PendingBlock на экране: подпись секции, не доменная величина.
  const pendingPlannedKg = pending.reduce((s, p) => s + p.plannedKg, 0);

  const filters = (
    <>
      {detail ? "детализация по партиям" : "свод без партий"}
      {notes.undatedCount > 0 && (
        <>
          {" · позиций без даты: "}
          <b>{notes.undatedCount}</b> (входят только в сезон)
        </>
      )}
      {notes.splitBatchCount > 0 && (
        <>
          {" · партий, разложенных на несколько строк: "}
          <b>{notes.splitBatchCount}</b>
        </>
      )}
    </>
  );

  // Итог подвала объясняет пустоту, а не печатает нули: «зачтено 0 т · сумма 0 ₽ ·
  // выполнение 0%» у поставщика без единой строки контракта читается как сбой расчёта.
  const footTotal = nothing ? (
    <>
      Расчёта нет: в сезоне <b>{data.season}</b> у поставщика нет ни строк контракта, ни
      поставок
    </>
  ) : lines.length === 0 ? (
    <>
      Начислять нечего: строк контракта в сезоне <b>{data.season}</b> нет
      {unpaid.length > 0 && (
        <>
          {" · без привязки "}
          <span className="num">{unpaidTotals.positions} поз.</span>
        </>
      )}
      {pending.length > 0 && (
        <>
          {" · ожидают приёмки "}
          <span className="num">{pending.length} поз.</span>
        </>
      )}
    </>
  ) : (
    <>
      <b>Итого:</b> зачтено <span className="num">{fmtTons(totals.countedKg / 1000)} т</span>
      {showSurcharge && (
        <>
          {" · доплата "}
          <span className="num">{fmtInt(totals.surchargeKg)} кг</span>
        </>
      )}{" "}
      · к оплате <span className="num">{fmtTons(totals.paidKg / 1000)} т</span> · сумма{" "}
      <span className="num">{fmtInt(totals.costRub)} ₽</span> · выполнение за сезон{" "}
      <span className="num">{Math.round(totals.season.pct)}%</span>
    </>
  );

  // Без «лист 1/1»: число строк переменное, у фермера с десятком строк и партиями лист
  // законно уходит на вторую страницу (прецедент — лист профиля культуры).
  const footPage = `Расчётный лист · ${farmer.name} · ${period.label} · строк: ${lines.length}`;

  return (
    <PrintSheet
      title={`Расчётный лист · ${farmer.name}`}
      subtitle="Начислено по актам приёмки · платежи и авансы в системе не ведутся"
      season={`Сезон ${data.season}`}
      period={period.label}
      periodLabel="Период"
      filters={filters}
      footTotal={footTotal}
      footPage={footPage}
    >
      <div className="st-print">
        {/* Пустой лист без объяснения читается как сбой расчёта — печать уходит наружу. */}
        {nothing && (
          <div className="st-empty">
            <div className="st-empty-title">Нечего рассчитывать</div>
            <div className="st-empty-sub">
              У поставщика нет строк контракта в сезоне {data.season}. Контракты заводятся
              в разделе «Контракты».
            </div>
          </div>
        )}

        {!nothing && nothingInPeriod && (
          <div className="st-note">
            За выбранный период принятых поставок нет
            {pending.length > 0 && ` (${pending.length} поз. ещё ждут приёмки)`}. Ниже —
            заявленные объёмы и выполнение за сезон.
          </div>
        )}

        {lines.length > 0 && (
          <table className="dt st-lines">
            <thead>
              <tr>
                <th>Культура · строка</th>
                <th className="r">Цена, ₽/кг</th>
                <th className="r">
                  Заявлено, т<span className="sub">за сезон</span>
                </th>
                <th className="r">
                  Зачтено, т{suffix && <span className="sub">{suffix}</span>}
                </th>
                {showSurcharge && (
                  <th className="r">
                    Доплата, кг{suffix && <span className="sub">{suffix}</span>}
                  </th>
                )}
                <th className="r">
                  К оплате, т{suffix && <span className="sub">{suffix}</span>}
                </th>
                <th className="r">
                  Сумма, ₽{suffix && <span className="sub">{suffix}</span>}
                </th>
                <th className="r">
                  Выполнение<span className="sub">за сезон</span>
                </th>
              </tr>
            </thead>

            {lines.map((l) => {
              const idle = l.countedKg === 0;
              const over = l.season.pct > 100;
              return (
                // Строка контракта и её партии — в одном tbody: break-inside по tbody
                // работает, по группе одиночных <tr> — нет (приём листа «Отгрузки»).
                <tbody key={l.lineId} className="st-lgrp">
                  <tr>
                    <td>
                      <Culture color={l.color} name={l.cultureName} />
                      {l.label && <span className="st-lbl">{l.label}</span>}
                      {l.pricePerKg === 0 && <span className="st-flag">цена не задана</span>}
                      {l.batches.length > 0 && (
                        <span className="st-sub"> · {l.batches.length}</span>
                      )}
                    </td>
                    <td className="r num">{fmtPrice(l.pricePerKg)}</td>
                    <td className="r num dim">{fmtTons(l.season.targetKg / 1000)}</td>
                    <td className={`r num${idle ? " dim" : ""}`}>
                      {fmtTons(l.countedKg / 1000)}
                    </td>
                    {showSurcharge && (
                      <td className="r num">
                        {l.surchargeKg > 0 ? fmtInt(l.surchargeKg) : "—"}
                      </td>
                    )}
                    <td className={`r num${idle ? " dim" : ""}`}>
                      {fmtTons(l.paidKg / 1000)}
                    </td>
                    <td className={`r num${idle ? " dim" : ""}`}>{fmtInt(l.costRub)}</td>
                    {/* Прогресс-бар экрана на печать не идёт; значение не обрезается. */}
                    <td className={`r pct${over ? " st-over" : ""}`}>
                      {Math.round(l.season.pct)}%
                    </td>
                  </tr>

                  {detail && l.batches.length > 0 && (
                    <tr className="st-bwrap">
                      <td colSpan={columns}>
                        <BatchTable
                          line={l}
                          showSurcharge={showSurcharge}
                          showAdjust={showAdjust}
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}

            <tfoot>
              <tr>
                <td className="lead">Итого</td>
                <td />
                <td className="r num">{fmtTons(totals.season.targetKg / 1000)}</td>
                <td className="r num">{fmtTons(totals.countedKg / 1000)}</td>
                {showSurcharge && (
                  <td className="r num">
                    {totals.surchargeKg > 0 ? fmtInt(totals.surchargeKg) : "—"}
                  </td>
                )}
                <td className="r num">{fmtTons(totals.paidKg / 1000)}</td>
                <td className="r num">{fmtInt(totals.costRub)}</td>
                <td className={`r pct${totals.season.pct > 100 ? " st-over" : ""}`}>
                  {Math.round(totals.season.pct)}%
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* Печатается в ОБОИХ режимах detail: это предмет разговора с фермером,
            в компактном виде прятать его нельзя. */}
        {unpaid.length > 0 && (
          <>
            <div className="st-sec">
              Без привязки к контракту
              <span className="st-sec-meta">
                {unpaidTotals.positions} поз. · {fmtInt(unpaidTotals.unpaidKg)} кг не
                оплачивается — нет строки, по которой считать цену
              </span>
            </div>
            <table className="dt st-unpaid">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>№ акта</th>
                  <th>Культура</th>
                  <th>Причина</th>
                  <th className="r">Факт, кг</th>
                  <th className="r">Принято по акту, кг</th>
                  <th className="r">Не оплачивается, кг</th>
                </tr>
              </thead>
              <tbody>
                {unpaid.map((u) => (
                  <tr key={`${u.itemId}-${u.reason}-${u.foreignLineId ?? 0}`}>
                    <td className="num">{fmtDate(u.date)}</td>
                    <td className="num">{u.actNumber ?? "—"}</td>
                    <td>
                      <Culture color={u.color} name={u.cultureName} />
                    </td>
                    <td className="dim">
                      {UNPAID_REASON[u.reason]}
                      {u.foreignLineId != null && ` (#${u.foreignLineId})`}
                      {u.partial && " · часть партии оплачена выше"}
                    </td>
                    <td className="r num dim">
                      {u.actualKg != null ? fmtInt(u.actualKg) : "—"}
                    </td>
                    <td className="r num dim">
                      {u.acceptedKg != null ? fmtInt(u.acceptedKg) : "—"}
                    </td>
                    <td className="r num">{fmtInt(u.unpaidKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Только в детализации: свёрнутых состояний на бумаге нет, а список ожидающих
            бывает во весь будущий план сезона. */}
        {detail && pending.length > 0 && (
          <>
            <div className="st-sec">
              Ожидают приёмки
              <span className="st-sec-meta">
                {pending.length} поз. · план {fmtTons(pendingPlannedKg / 1000)} т — акта
                приёмки ещё нет, в расчёт не входят
              </span>
            </div>
            <table className="dt st-pending">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Культура</th>
                  <th>Статус</th>
                  <th className="r">План, кг</th>
                  <th className="r">Факт, кг</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.itemId}>
                    <td className="num">{fmtDate(p.date)}</td>
                    <td>
                      <Culture color={p.color} name={p.cultureName} />
                    </td>
                    <td className="dim">{PENDING_STATUS[p.status]}</td>
                    <td className="r num dim">{fmtInt(p.plannedKg)}</td>
                    {/* Перевеска позиционная: у части ожидающих факта ещё нет («—»).
                        Построчная справка — в мету секции и в итоги листа НЕ суммируется. */}
                    <td className="r num dim">
                      {p.actualKg != null ? fmtInt(p.actualKg) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Сноски экрана целиком: без них расхождение «зачтено ≠ факт» читается
            фермером как ошибка расчёта. */}
        {!nothing && (
          <ul className="st-notes">
            {lines.length > 0 && (
              <li>
                «Зачтено» — вес, засчитанный в объём строки контракта; это то же число,
                что «Принято» на вкладке «Контракты». «Заявлено» и «Выполнение» — всегда
                за сезон, объём строки контракта задан на сезон.
              </li>
            )}
            {showSurcharge && (
              <li>
                Доплата по корректировке расчёта (договорённость «платим N % от факта»)
                идёт только в деньги: в тонны выполнения контракта она не входит.
              </li>
            )}
            {notes.splitBatchCount > 0 && (
              <li>
                {notes.splitBatchCount} парт. разложены по нескольким строкам контракта —
                факт и «принято по акту» в разборе относятся ко всей партии и по строкам
                не складываются.
              </li>
            )}
            {notes.undatedCount > 0 && !period.isSeason && (
              <li>
                {notes.undatedCount} поз. без даты прибытия и отправления — в сезон они
                входят, но ни в один узкий период не попадают.
              </li>
            )}
            {notes.hasZeroPrice && (
              <li>У части строк не задана цена — вес зачтён, сумма по ним нулевая.</li>
            )}
            <li>
              Лист показывает начислено. Платежей и авансов в системе нет, поэтому
              «оплачено» и «остаток долга» здесь не считаются. Итоги берутся от точных
              значений, а не от округлённых строк.
            </li>
          </ul>
        )}
      </div>
    </PrintSheet>
  );
}
