import type { FeedWeek } from "@/server/shipments/feed";

// Ключ недели для React state / refs.
export function weekKey(w: { isoYear: number; isoWeek: number }): string {
  return `${w.isoYear}-${w.isoWeek}`;
}

const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "UTC" });
const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

// 0=Пн … 6=Вс, как в workdays.ts.
const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

// Диапазон рабочих дней недели: «8–13 июня» (range) и «Пн–Сб» (span).
export function formatWeekRange(week: FeedWeek): { range: string; span: string } {
  const workdays = week.days.filter((d) => d.isWorkday);
  if (workdays.length === 0) return { range: "", span: "" };
  const first = new Date(`${workdays[0].date}T00:00:00Z`);
  const last = new Date(`${workdays[workdays.length - 1].date}T00:00:00Z`);
  return {
    range: `${dayFmt.format(first)}–${dayMonthFmt.format(last)}`,
    span: `${WEEKDAY_SHORT[(first.getUTCDay() + 6) % 7]}–${WEEKDAY_SHORT[(last.getUTCDay() + 6) % 7]}`,
  };
}
