# PROMPTS — print-2: печать Сводка + План (A4 landscape)

> Второй срез печатных форм. Два листа — **Сводка** и **План недели** — в **A4 landscape** (матрица культура×день
> широкая, портрет её жмёт — «1,4/1,5» переносится). На каркасе print-1 (`PrintSheet`/print-CSS/print-роуты).
> Источник — тот же `getPlanWeek`. **Без миграции, read-only, без денег.** Прототип: `print-views-v1.html`
> (листы 02 Сводка, 03 План).

## Решения (зафиксированы)
| Развилка | Выбор |
|---|---|
| Ориентация | **A4 landscape** для обоих (named `@page landscape { size: A4 landscape }` + `page:` на этих листах). Каркас/шапка/подвал — из print-1. |
| Сводка | Таблица культура × рабочий день (эфф. вес, т) + Итог: План · Факт · % · Δ. Максимум дня по строке — **жирным** (без heatmap-заливки/штриховки). Подвал «Итого по дням» (day-mode) + недельный итог. |
| План | Таблица культура × день «факт / цель» (т) + Цель · Факт · % · Δ. Без прогресс-баров. week-mode — строкой «цель на неделю». |
| week-mode | Культуры с недельной целью (BR-23) — строка с бейджем «неделя», дневные ячейки объединены; подвал по дням — только day-mode, колонка «Факт» — все. |
| Данные | Тот же `getPlanWeek` + те же величины, что десктоп `SummaryView`/`PlanView`. Не дублировать агрегацию. |
| Контекст | Неделя из URL `?week`. Кнопки «Печать»: Сводка — на /shipments (вид «Сводка»), План — на /planner (вид «План»). |

---

## ПРОМПТ — print-2 (Claude Code)

```text
Задача print-2 (VSMS): печатные листы Сводка и План в A4 landscape, из getPlanWeek, на каркасе print-1.
Миграция: НЕТ. Read-only, без денег. Данные/величины — из существующих loaders, не дублировать.

Перед кодом прочитать:
- docs/prototypes/print-views-v1.html — листы 02 (Сводка) и 03 (План): вёрстка таблиц культура×день + итоги,
  жирный максимум, week-mode-строка, подвал.
- Каркас print-1: PrintSheet (шапка/подвал), print-CSS, bare print-роуты в app/print/* (см. app/print/shipments,
  app/print/acceptance) — переиспользовать. Кнопки «Печать» — как в print-1.
- server/plan/board.ts getPlanWeek → PlanWeek: days, rows[culture]{cultureName, color, mode, weekTarget,
  dayTargets, dayProgress: Record<date,{actualTons, planRemainingTons, effectiveTons}>, weekProgress},
  dayTotalsProgress, weekTotalProgress. Те же числа, что десктоп SummaryView/PlanView.
- app/(app)/shipments/_components/SummaryView.tsx, app/(app)/planner/_components/PlanView.tsx — десктоп-логика
  (интенсивность/итоги/эффективный вес BR-22, week-mode BR-23) — источник значений (на печати без графики).
- DESIGN-SYSTEM.md (печатная адаптация — ч/б, hairline-таблицы, Geist Mono для чисел).

UI
1) Landscape: добавить named print-page `@page landscape { size: A4 landscape; margin: 0 }`; на листах Сводка/План
   применить `page: landscape` (и ширину листа 297мм). Каркас PrintSheet — переиспользовать (шапка: название вида,
   сезон, неделя W##·даты, дата печати, фильтры; подвал: итог + «вид · W## · лист 1/1»).
2) Print-роуты (bare, без сайдбара, как print-1): app/print/summary (?week) и app/print/plan (?week). Server-рендер
   из getPlanWeek по неделе URL.
3) Лист «Сводка» (landscape): таблица культура × рабочие дни — ячейка = dayProgress[date].effectiveTons (т; «—»
   если 0); максимум дня в строке — жирным; колонки Итог: План (weekTarget ?? Σ dayTargets) · Факт
   (weekProgress.effectiveTons) · % · Δ. week-mode культура — строка «цель на неделю · факт X т» на ширину дней.
   Подвал: «Итого по дням» = dayTotalsProgress (day-mode); колонка «Факт» = weekTotalProgress; недельный итог.
4) Лист «План» (landscape): таблица культура × день — ячейка = «факт / цель» (dayProgress.effectiveTons /
   dayTargets[date]); колонки Цель (weekTarget ?? Σ dayTargets) · Факт · % · Δ. Без прогресс-баров. week-mode —
   строка «цель на неделю». Подвал: итоги по дням (day-mode) + недельный.
5) Кнопки «Печать»: на /shipments в виде «Сводка» → /print/summary?week=...; на /planner в виде «План» →
   /print/plan?week=... (текущая неделя из URL).

ОГРАНИЧЕНИЯ
- Без миграции/схемы. Read-only. Величины — из getPlanWeek (те же, что десктоп); НЕ дублировать агрегацию/формулы.
  Деньги не выводить. Без heatmap-заливки/прогресс-баров — только числа (максимум жирным).
- Landscape только для этих двух листов; portrait-листы print-1 не трогать. Неделя — из URL; localStorage нельзя.
- Печатная адаптация токенов (ч/б). Десктоп SummaryView/PlanView не менять по поведению. Доки/TASKS — PM.

БД ТЕСТОВАЯ: UI — визуал на экране + предпросмотр печати A4 landscape.

ПРОВЕРКА (показать)
- /shipments «Сводка» → «Печать» → /print/summary: таблица культура×день, максимум жирным, week-mode-строка,
  итоги; Ctrl+P — A4 LANDSCAPE, дневные ячейки в одну строку (не переносятся).
- /planner «План» → «Печать» → /print/plan: «факт/цель» по дням в одну строку (landscape), итоги Цель/Факт/%/Δ.
- Числа совпадают с десктоп-Сводкой/Планом (один источник getPlanWeek).
- Портретные листы print-1 (Отгрузки/Приёмка) не изменились.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью print-2
1. Сводка/План — A4 landscape (named `@page`), дневные ячейки в одну строку; каркас PrintSheet из print-1 переиспользован.
2. Данные из getPlanWeek (те же величины, что десктоп); агрегация не продублирована; эфф. вес/week-mode по BR-22/23.
3. Сводка — максимум дня жирным, без heatmap; План — «факт/цель», без баров; деньги не выводятся.
4. Print-роуты app/print/summary, app/print/plan (bare); кнопки «Печать» с контекстом недели.
5. Без миграции; portrait-листы print-1 и десктоп-виды не тронуты; localStorage не используется.

---

## После задачи — обновление памяти (зона PM, не Claude Code)
- TASKS.md: print-2 (Сводка+План landscape) → `[x]`; следующий — print-3 (Аналитика с графиками).
- CONTEXT-HANDOFF.md: CURRENT IMPLEMENTATION += печать Сводка/План (landscape); NEXT TASK → print-3.
