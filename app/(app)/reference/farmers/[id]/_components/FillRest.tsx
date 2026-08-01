"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Ближайший скроллящийся предок — контейнер <main> app-оболочки (тот же приём, что в
// ShipmentsFeed: window не скроллится, страница живёт внутри main).
function getScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return el;
    el = el.parentElement;
  }
  return null;
}

// Блок со своим скроллом, тянущийся до низа окна: max-height = «сколько осталось от
// моего верха до дна скроллера». Считаем замером, а не calc(100vh − N): шапка карточки
// поставщика плавающей высоты (контакты опциональны, KPI переносятся на узком экране),
// и любая константа промахивается. Нижний отступ берём у самого скроллера — там уже
// зашиты и десктопные 24px, и мобильные 56px таб-бара с safe-area.
//
// Именно max-height, а не height: на коротком списке блок остаётся по содержимому.
//
// На мобильной ширине (< md, где включается нижний таб-бар) высоту НЕ ограничиваем
// вовсе: шапка карточки с KPI съедает там почти весь вьюпорт, и вложенный скролл в
// оставшейся щели читался бы хуже обычной прокрутки страницы.
const MD_PX = 768; // тот же брейкпоинт, что у Tailwind md: в оболочке (app)

export function FillRest({
  className,
  minPx = 200,
  children,
}: {
  className?: string;
  minPx?: number; // пол на случай очень низкого окна
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = getScrollParent(el);

    const measure = () => {
      if (window.innerWidth < MD_PX) {
        setMaxHeight(null);
        return;
      }
      const top = el.getBoundingClientRect().top;
      const bottom = scroller
        ? scroller.getBoundingClientRect().bottom -
          parseFloat(getComputedStyle(scroller).paddingBottom || "0")
        : window.innerHeight;
      setMaxHeight(Math.max(minPx, Math.round(bottom - top)));
    };

    measure();
    window.addEventListener("resize", measure);
    // Шапка над блоком может менять высоту без ресайза окна (переносы, подгрузка данных).
    const ro = new ResizeObserver(measure);
    if (scroller) ro.observe(scroller);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [minPx]);

  return (
    <div
      ref={ref}
      className={className}
      style={
        maxHeight != null
          ? { maxHeight: `${maxHeight}px` }
          : // Без ограничения свой скролл не нужен — отдаём прокрутку странице.
            { overflowY: "visible" }
      }
    >
      {children}
    </div>
  );
}
