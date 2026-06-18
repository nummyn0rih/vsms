"use client";

import { type FeedDay, daySummary } from "@/server/shipments/feed";
import type { ShipmentOptions } from "@/server/shipments/schema";
import { MachineRow } from "./MachineRow";
import { CultureChip } from "./FeedChips";

const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function DayBlock({
  day,
  options,
}: {
  day: FeedDay;
  options: ShipmentOptions;
}) {
  const summary = daySummary(day);
  const dateLabel = dayMonthFmt.format(new Date(`${day.date}T00:00:00Z`));
  // weekdayName() — lowercase (для текста ошибок BR-11); в шапке дня с заглавной.
  const weekday =
    day.weekdayName.charAt(0).toUpperCase() + day.weekdayName.slice(1);

  // Шапка дня: день недели приглушённо (400), дата акцентом (600 ink).
  const dayHeader = (
    <span className="text-[13px] tracking-tight whitespace-nowrap">
      <span className="font-normal text-muted-foreground">{weekday}, </span>
      <span className="font-semibold text-foreground">{dateLabel}</span>
    </span>
  );

  if (day.shipments.length === 0) {
    // Пустой рабочий день: нерабочие пустые дни в ленту не попадают (feed.ts).
    return (
      <div className="flex items-center gap-2 border-t border-[#ebebeb] py-2 pr-3 pl-[30px] text-[13px] text-muted-foreground">
        {dayHeader}
        <span>— нет отгрузок</span>
      </div>
    );
  }

  const hasTare = summary.tare.length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-t border-[#ebebeb] py-2 pr-3 pl-[30px]">
        {dayHeader}
        <div className="flex flex-wrap items-center gap-1.5">
          {summary.cultures.map((c) => (
            <CultureChip key={c.cultureId} culture={c} />
          ))}
        </div>
        {(hasTare || summary.hasUnpricedTare) && (
          <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
            тара:{" "}
            {hasTare
              ? summary.tare.map((t, i) => (
                  <span key={t.packagingTypeName}>
                    {i > 0 && " · "}
                    <b className="font-medium tabular-nums text-[#4d4d4d]">{t.units}</b>{" "}
                    {t.packagingTypeName}
                  </span>
                ))
              : "—"}
            {summary.hasUnpricedTare && (
              <span title="Есть позиции без нормы тары"> · ?</span>
            )}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5 py-2 pl-[30px]">
        {day.shipments.map((s) => (
          <MachineRow key={s.id} shipment={s} options={options} />
        ))}
      </div>
    </div>
  );
}
