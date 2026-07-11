# PROMPTS — mobile-4: мобильная Сводка

> Первый срез мобильной v2. На узком экране (<md) — вид «Сводка» на `/shipments` как **сегмент** рядом с
> «Лентой» (мобильная Лента уже есть из mobile-1) + **карточный heatmap по культурам** вместо матрицы.
> Источник — тот же `getPlanWeek`. Read-only. **Без миграции.** Прототип: `mobile-v2.html` (экран 2 Сводка + сегмент 0A).

## Решения (зафиксированы)
| Развилка | Выбор |
|---|---|
| Доступ | Сегмент «Лента \| Сводка» на мобильном `/shipments` (вид в URL `?view=`, как десктоп). НЕ объединять с Планом. |
| Раскладка | Карточка культуры = чип+название + **heatmap-лента по дням** (6 клеток, число+интенсивность) + итог культуры (факт т + %). week-mode культура → плашка «цель на неделю», без дней (BR-23). |
| Интенсивность | По СТРОКЕ культуры: opacity ∝ effectiveTons / max ячейки культуры; цвет = Culture.color (как десктоп-Сводка). |
| Данные | Тот же `getPlanWeek` + та же чистая логика (rowMax/итоги), что десктоп `SummaryView`. Не дублировать. |
| Десктоп | `SummaryView` (md+) без изменений. Read-only. |

---

## ПРОМПТ — mobile-4 (Claude Code)

```text
Задача mobile-4 (VSMS): мобильная Сводка на узком экране (<md) — сегмент на /shipments + карточный heatmap по
культурам. Responsive, тот же getPlanWeek. Десктоп по поведению НЕ менять. Миграция: НЕТ. Read-only.

Перед кодом прочитать:
- docs/prototypes/mobile-v2.html — экран 2 (Сводка: карточки-heatmap, week-mode, итог недели) и сегмент 0A. Источник вёрстки.
- app/(app)/shipments/page.tsx — грузит getFeed + getPlanWeek (для Сводки), ?view (lenta|summary), ?week.
- app/(app)/shipments/_components/ — MobileShipmentsFeed (мобильная Лента из mobile-1), SummaryView (десктоп-Сводка),
  ShipmentsFeed (переключатель вида Лента|Сводка на десктопе).
- server/plan/board.ts — getPlanWeek → PlanWeek: days (рабочие дни), rows[culture]{cultureName, color, mode,
  weekTarget, dayProgress: Record<date,{effectiveTons}>, weekProgress}, weekTotalProgress. Та же чистая логика,
  что десктоп-Сводка (интенсивность по строке, итоги).
- DESIGN-SYSTEM.md (токены, цвета культур из БД); mobile-1 шелл/сегмент-паттерны.

UI (мобиле, <md)
1) На мобильном /shipments — сегмент «Лента | Сводка» в шапке недели (как десктоп; вид в URL ?view). При
   view=summary и <md рендерить MobileSummaryView (client, `md:hidden`); десктоп SummaryView — `hidden md:block`.
   Данные — тот же getPlanWeek (уже грузится в page для Сводки).
2) MobileSummaryView: карточки по культурам (rows), по прототипу:
   - шапка: чип(color)+название + итог культуры (weekProgress.effectiveTons т + % к плану); week-mode — бейдж «неделя».
   - heatmap-лента: 6 клеток по рабочим дням (days), значение = dayProgress[date].effectiveTons; интенсивность
     ПО СТРОКЕ: opacity = value>0 ? round(18 + 82·value/rowMax) : 0, фон = color-mix(color, opacity%); нулевая → «·».
   - week-mode культура (mode==="week"): вместо ленты — плашка «цель на неделю · факт X т» (BR-23, без дней).
   - Итог недели снизу (weekTotalProgress: набрано/цель т + %). Пустая неделя — пустое состояние (по прототипу).
   Числа — tabular-nums; токены/цвета — как десктоп-Сводка.
3) Переключение сегмента Лента↔Сводка пишет ?view (без localStorage); неделя ?week — общая, не трогать.

ОГРАНИЧЕНИЯ
- Без миграции/схемы. Read-only. Данные/логика — из getPlanWeek и той же чистой функции интенсивности/итогов,
  что десктоп SummaryView; НЕ дублировать. Десктоп SummaryView/ShipmentsFeed не менять по поведению.
- Вид/неделя — в URL; localStorage нельзя. Токены/цвета культур — из системы/БД. Доки/TASKS — PM.

БД ТЕСТОВАЯ: UI — визуал на узком/широком вьюпорте.

ПРОВЕРКА (показать)
- Узкий экран: сегмент Лента|Сводка; «Сводка» → карточки-heatmap по культурам; интенсивность по строке;
  week-mode культура → плашка без дней; итог недели; пустая неделя.
- Переключение вида пишет ?view; неделя ?week общая.
- Широкий экран (md+): десктоп-Сводка (SummaryView) БЕЗ изменений (регресс).
- Read-only: нет инпутов/действий.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью mobile-4
1. <md — MobileSummaryView (карточки-heatmap, week-mode, итог); md+ — десктоп SummaryView без регресса.
2. Данные из getPlanWeek; интенсивность по строке и итоги — та же чистая логика, что десктоп (без дублей).
3. Сегмент Лента|Сводка, вид в URL ?view; неделя ?week общая; localStorage не используется.
4. Токены/цвета культур из системы/БД; read-only; без миграции; десктоп не тронут.

---

## После задачи — обновление памяти (зона PM, не Claude Code)
- TASKS.md: mobile-4 (Сводка) → `[x]`; следующий — mobile-5 мобильный План (`PROMPTS-MOBILE-5-PLAN.md`).
- CONTEXT-HANDOFF.md: CURRENT IMPLEMENTATION += мобильная Сводка; NEXT TASK → мобильный План.
