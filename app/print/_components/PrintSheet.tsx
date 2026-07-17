import type { ReactNode } from "react";
import { PrintButton } from "./PrintButton";

// Обёртка A4-листа: шапка (doc-head + опц. строка фильтров) + слот таблицы + подвал.
// Server-компонент; PrintButton (client-остров) виден только на экране.
export function PrintSheet({
  title,
  subtitle,
  season,
  period,
  periodLabel = "Период",
  filters,
  footTotal,
  footPage,
  landscape = false,
  children,
}: {
  title: string;
  subtitle: string;
  season: string; // «Сезон 2026»
  period: string; // «W24 · 8–13 июня 2026» / «сезон 2026 · текущее состояние»
  periodLabel?: string; // подпись перед периодом (дефолт «Период»; «Неделя» для план/сводки)
  filters?: ReactNode; // строка «Фильтры: …» (лист «Отгрузки»); опц.
  footTotal: ReactNode; // .sf-tot — итог листа
  footPage: string; // .sf-page — «вид · период · лист 1/1»
  landscape?: boolean; // A4 landscape (широкая матрица культура×день)
  children: ReactNode; // таблица
}) {
  const printDate = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="print-wrap">
      <div className={`print-toolbar screen-only${landscape ? " landscape" : ""}`}>
        <PrintButton />
      </div>

      <article className={`sheet${landscape ? " landscape" : ""}`}>
        <div className="doc-head">
          <div className="dh-l">
            <p className="dh-eyebrow">VSMS · Печатная форма</p>
            <h2 className="dh-title">{title}</h2>
            <div className="dh-sub">{subtitle}</div>
          </div>
          <div className="dh-r">
            <div className="season">
              <span className="dot" />
              {season}
            </div>
            <div>
              <span className="lbl">{periodLabel}</span> {period}
            </div>
            <div>
              <span className="lbl">Дата печати</span> {printDate}
            </div>
          </div>
        </div>

        {filters && <div className="dh-filters">{filters}</div>}

        {children}

        <div className="sheet-foot">
          <div className="sf-tot">{footTotal}</div>
          <div className="sf-page">{footPage}</div>
        </div>
      </article>
    </div>
  );
}
