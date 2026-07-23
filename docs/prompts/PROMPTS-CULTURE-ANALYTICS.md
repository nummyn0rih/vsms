# PROMPTS — culture-analytics: аналитика по отдельной культуре

> Drill-down из дашборда: экран `/analytics/culture/[id]?season=` — профиль одной культуры за сезон (KPI +
> динамика приёмки по неделям + % брака по неделям + по поставщикам + калибр для calibre-культур). **Без миграции,
> read-only,** агрегаты на лету, переиспользуя execution/acceptance/feed. Прототип утверждён:
> `docs/prototypes/culture-analytics-v1.html`. Recharts уже введён (дашборд).

## Решения (зафиксированы)
| Развилка | Выбор |
|---|---|
| Размещение | Отдельный экран `/analytics/culture/[id]?season=`; клик по культуре в графике «Выполнение по культурам» дашборда → сюда. Селектор культуры + «← к дашборду». peek-панель — v2. |
| KPI по культуре | Принято/План т · Выполнение % · Средний брак % · Поставок (позиций)/рейсов/фермеров · **Доля в сезоне** (принято культуры / всего принятого). |
| Динамика | Area (эфф. вес по ISO-неделям, серия = цвет культуры) + **план пунктиром** (плановый темп); если ровного плана нет — плановую линию скрыть. |
| % брака | График **по неделям** (bar, нейтральный янтарь) = `Σ(actual×brak%)/Σactual` по неделе прибытия. Среднее — в KPI. |
| По поставщикам | Таблица: Фермер · Принято т · Выполнение % (или «—» если нет строки контракта) · Брак % · Доля (мини-бар). Сорт по объёму. |
| Калибр | Только `acceptance_type=calibre`: стек 100% долей категорий (из категорий акта, BR-10) + «не в зачёт»/брак. У simple скрыт. |
| Деньги/год-к-году | Вне среза (натуральные единицы). |

---

## ПРОМПТ — culture-analytics (Claude Code)

```text
Задача culture-analytics (VSMS): экран профиля культуры /analytics/culture/[id] + агрегатор getCultureAnalytics.
Read-only, агрегаты на лету, переиспользуя существующие. Миграция: НЕТ. Recharts (как дашборд). Не дублировать формулы.

Перед кодом прочитать:
- docs/prototypes/culture-analytics-v1.html — вёрстка (шапка+селектор · KPI · динамика · % брака по неделям ·
  по поставщикам · калибр), состояния simple/calibre/скудно. Источник UI.
- server/analytics/dashboard.ts — getSeasonAnalytics (эталон агрегатора; acceptanceByWeek/brakByCulture/
  completionByCulture — переиспользовать подход, отфильтровав по культуре) + computeWeightedBrak (общая, из
  server/acceptance/board.ts).
- server/contracts/execution.ts getContractExecution({ farmerId?, cultureId?, season }) — выполнение по культуре
  и по фермеру×культуре (проверить сигнатуру; если нет фильтра по культуре — отфильтровать строки результата).
- server/acceptance/* — акты/категории калибра (CalibreResult), computeAcceptedKg.
- app/(app)/analytics/page.tsx + _components (дашборд, график «Выполнение по культурам») — откуда клик на культуру.
- DESIGN-SYSTEM.md, CULTURE_PALETTE / Culture.color (серия культуры = её цвет).

SERVER
1) server/analytics/culture.ts → getCultureAnalytics({ season, cultureId }): read-only. Возвращает:
   - culture: { id, name, color, acceptanceType }.
   - kpi: acceptedTons, targetTons, completionPct|null, avgBrakPct|null (computeWeightedBrak по позициям культуры),
     positionsCount, tripsCount, farmersCount, seasonSharePct (acceptedTons культуры / Σ accepted всех культур).
   - acceptanceByWeek: [{ isoYear, isoWeek, label, tons }] — Σ эфф. принятого по неделе прибытия (эта культура).
   - planRatePerWeekT|null — плановый темп (для пунктира; null если ровного плана нет).
   - brakByWeek: [{ label, pct }] — Σ(actual×brak%)/Σactual по неделе (culture). Пусто → скудное состояние.
   - bySupplier: [{ farmerId, farmerName, acceptedTons, execPct|null, brakPct, sharePct }] — сорт по acceptedTons;
     execPct из getContractExecution (строка фермер×культура), иначе null. brakPct — computeWeightedBrak по фермеру.
   - calibre: null для simple; для calibre — [{ label, isAccepted, pct, tons }] (доли категорий, из категорий акта).
   Переиспользовать computeWeightedBrak / getContractExecution / computeAcceptedKg — НЕ дублировать формулы.
   Список культур сезона (для селектора) — отдать заодно или из существующего loader.

UI
2) app/(app)/analytics/culture/[id]/page.tsx (server): грузит getCultureAnalytics по [id] и ?season (дефолт
   текущий). Рендер по прототипу: шапка (чип+имя, сезон, тип приёмки, селектор культуры → /analytics/culture/<id>,
   «← к дашборду» /analytics) + KPI-полоса + графики.
3) Графики (Recharts, серия = Culture.color):
   - Динамика — Area (acceptanceByWeek) + план пунктиром (planRatePerWeekT; скрыть если null).
   - % брака по неделям — Bar (brakByWeek, янтарь); пусто → «данных пока нет».
   - По поставщикам — таблица (bySupplier) с мини-баром доли; «—» у execPct=null; брак тоном при высоком.
   - Калибр — стек 100% (calibre != null), только calibre; у simple блок не рендерится.
   Скудная культура — KPI «—», графики держат оси/пустое состояние (по прототипу).
4) Дашборд: клик по культуре в графике «Выполнение по культурам» → /analytics/culture/<id>?season=<текущий>.

ОГРАНИЧЕНИЯ
- Без миграции/схемы. Read-only. Агрегаты — переиспользуют execution/computeWeightedBrak/computeAcceptedKg/feed;
  формулы НЕ дублировать. Деньги/год-к-году не выводить. Сезон — в URL; localStorage нельзя.
- Recharts на печать/тултипы здесь не про печать — обычный экранный дашборд. Десктоп-дашборд /analytics не менять
  по поведению, кроме добавленного клика-ссылки. Токены/цвета — из системы/БД. Доки/TASKS — PM.

БД ТЕСТОВАЯ: проверки seed/rolled-back + чистые агрегаты на кейсах.

ПРОВЕРКА (показать)
- Клик по культуре в дашборде → /analytics/culture/<id>; KPI/динамика/брак/поставщики наполнены; серия = цвет культуры.
- calibre-культура: блок «Калибр» (стек 100%); simple: блока нет.
- Скудная культура: KPI «—», графики пустые состояния, таблица — принятое; без сломанных нулей.
- % брака по неделям = Σ(actual×brak%)/Σactual (computeWeightedBrak); выполнение по фермеру — из execution, «—» без контракта.
- Доля в сезоне = принято культуры / Σ принятого всех; сумма долей поставщиков = 100%.
- Смена культуры в селекторе и сезона (?season) перегружают профиль; дашборд не сломан.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью culture-analytics
1. `getCultureAnalytics` — один агрегатор; execution/computeWeightedBrak/computeAcceptedKg переиспользованы (без дублей формул).
2. Экран `/analytics/culture/[id]?season`; клик из дашборда; селектор культуры + «← к дашборду».
3. Динамика (area + план пунктиром/скрыт), % брака по неделям (bar), по поставщикам (таблица, «—» без контракта), калибр (стек, только calibre).
4. Скудное состояние без сломанных нулей; серия = Culture.color; брак янтарь.
5. Без миграции; read-only; сезон в URL; дашборд /analytics не тронут по поведению; localStorage не используется.

---

## После задачи — обновление памяти (зона PM, не Claude Code)
- TASKS.md: «Аналитика по отдельным культурам» → `[x]`; следующий пункт бэклога — календарь (в последнюю очередь) / фильтры в мобильной приёмке.
- CONTEXT-HANDOFF.md: CURRENT IMPLEMENTATION += аналитика по культуре (drill-down); NEXT TASK → календарь / мобильная приёмка-фильтры / прочий бэклог.
