"use client";

import { useState } from "react";
import { ChevronDown, Info, TriangleAlert } from "lucide-react";

import { INGREDIENT_UNIT_LABELS } from "@/server/ingredients/schema";
import { farmersWord } from "@/server/shipments/format";
import type { Alert } from "@/server/alert-rules/alerts";

// Порог, начиная с которого панель уходит в компактный скролл + "Показать все"
// (PROMPTS-ALERTS.md: "более ~6 строк").
const OVERFLOW_THRESHOLD = 6;

const tareFmt = new Intl.NumberFormat("ru-RU");
const ingFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

// Панель "Дефицит тары"/"Дефицит ингредиентов" — над матрицей /packaging и
// /ingredients (docs/prototypes/alerts-v1.html, .dpanel). Пусто → null (панель не
// показывается вообще, без "quiet row" запасного варианта). Read-only.
export function DeficitPanel({
  title,
  rows,
  footerNote,
}: {
  title: string;
  rows: Alert[];
  footerNote: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const overflow = rows.length > OVERFLOW_THRESHOLD;
  const farmerCount = new Set(rows.map((r) => r.farmerId)).size;

  return (
    <div className="dpanel">
      <div className="dpanel-head">
        <span className="dp-dot" />
        <span className="dp-title">{title}</span>
        <span className="dp-count tnum">{rows.length}</span>
        <span className="dp-note">
          <TriangleAlert />
          ниже порога у {farmerCount} {farmersWord(farmerCount)}
        </span>
      </div>

      <div className={overflow && !expanded ? "dp-rows scroll" : "dp-rows"}>
        {rows.map((r) => {
          const unit =
            r.itemKind === "packaging" ? "шт" : r.unit ? INGREDIENT_UNIT_LABELS[r.unit] : "";
          const fmt = r.itemKind === "packaging" ? tareFmt : ingFmt;
          return (
            <div className="drow" key={`${r.ruleId}:${r.farmerId}`}>
              <div className="drow-l">
                <span className="d-item" title={r.itemName}>
                  {r.itemName}
                </span>
                <span className="d-sep">·</span>
                <span className="d-farmer" title={r.farmerName}>
                  {r.farmerName}
                </span>
              </div>
              <div className="drow-r">
                <span className="d-bal tnum">
                  {fmt.format(r.balance)} <span className="thr">/ {fmt.format(r.threshold)}</span>{" "}
                  <span className="u">{unit}</span>
                </span>
                <span className="d-def tnum">−{fmt.format(r.deficit)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {overflow && (
        <button type="button" className="dp-showall" onClick={() => setExpanded((v) => !v)}>
          <ChevronDown />
          {expanded ? "Свернуть" : `Показать все · ${rows.length}`}
        </button>
      )}

      <div className="dp-foot">
        <Info />
        {footerNote}
      </div>
    </div>
  );
}
