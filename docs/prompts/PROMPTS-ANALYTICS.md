# PROMPTS — analytics (F/V2): аналитический дашборд сезона

> Экран `/analytics` (сейчас плейсхолдер) — read-only дашборд текущего сезона: KPI-полоса + 4 графика.
> **Первое использование Recharts** (он в стеке, но ещё не применялся — сверься с доками через context7).
> **Без миграции.** Агрегаты — новый `server/analytics/`, на переиспользовании execution/acceptance/feed
> (НЕ дублировать формулы). Прототип утверждён: `docs/prototypes/analytics-v1.html`. Год-к-году НЕ входит
> (нет исторических данных — этап G).

## Решения (зафиксированы с пользователем)
| Развилка | Выбор |
|---|---|
| Экран/сезон | `/analytics`, текущий сезон по умолчанию; сезон в URL `?season=` (без localStorage). Опции селектора — из настроенных сезонов (SeasonConfig). |
| Выполнение по культурам | Горизонтальные бары: принято/план (т) + % справа. Агрегат `getContractExecution({season})` по культурам. |
| Динамика приёмки | Одна суммарная линия/area; база — **ПРИНЯТЫЙ** вес (Σ accepted по неделе прибытия), НЕ эффективный. Разрез по культурам — v2. |
| % брака | По культурам: `Σ(actual×brak%) / Σ actual` (база — фактический, DOMAIN §5). Нейтральный янтарь. Drill-down по фермерам — v2. |
| Рейсы ТК | Сгруппированные бары, овощные и материальные РАЗДЕЛЬНО (BR-14). Графитовая шкала, не статусные цвета. |
| «Осталось ~N машин» | Грубо: `(Σ target − Σ accepted) / плановый вес рейса (норма)`, подпись «≈». Факт. ср. вес рейса — не в этом срезе. |
| Доступ | Read-only, все роли (аналитика — R). |
| Chart tech (решено PM) | **Recharts** — динамика (Area), брак (Bar), рейсы ТК (grouped Bar) — там нужны оси/тултипы/responsive. **CSS-бары** — «Выполнение по культурам» (это прогресс-список, не график): переиспользовать существующий exec-bar паттерн (`ContractViewDialog`/вид «План»/карточка фермера). Свой SVG (вариант 3) — отклонён (реинвент Recharts, расхождение со стеком). |

---

## ПРОМПТ — analytics (Claude Code)

```text
Задача analytics (VSMS): дашборд сезона на /analytics — KPI + 4 графика (Recharts), read-only, агрегаты на
лету. Миграция: НЕТ. Новых формул НЕ дублировать — переиспользовать execution/acceptance/feed. Recharts —
первое использование, СВЕРИТЬСЯ С ДОКАМИ через context7 (API графиков).

Перед кодом прочитать:
- docs/prototypes/analytics-v1.html — УТВЕРЖДЁННЫЙ прототип (раскладка, KPI, 4 графика, состояния, селектор
  сезона, оси/цвета/подписи). Визуальный источник.
- server/contracts/execution.ts — getContractExecution({ season }) без farmerId → строки по ВСЕМ контрактам
  сезона (lines: cultureName, color, acceptedKg, targetKg, pct, cost). Источник «выполнения по культурам» и
  KPI выполнение/принято/стоимость (агрегировать по культуре — единый источник).
- server/acceptance/accepted.ts (computeAcceptedKg) и AcceptanceAct/ShipmentItem — брак: Σ(actual×brak%)/Σ actual.
- server/shipments/feed.ts + workdays.ts — ISO-недели для динамики приёмки (accepted по неделе arrival_date).
- prisma: Shipment (status arrived/accepted, driver→TransportCompany), MaterialShipment (доставленные),
  TransportCompany — для «рейсов ТК» (BR-14, овощные и материальные раздельно).
- server/seasons/* — список настроенных сезонов (SeasonConfig) для селектора.
- lib/nav.ts, app/(app)/analytics — плейсхолдер, куда встаёт дашборд.
- DOMAIN.md §5 (метрики: % брака, рейсы ТК BR-14, «осталось ~N машин»), DESIGN-SYSTEM.md (токены, янтарь брака).

SERVER
1) server/analytics/dashboard.ts → getSeasonAnalytics({ season }): один агрегатор, read-only, RBAC как аналитика (R).
   - kpi: acceptedTons (Σ accepted), completionPct (Σ accepted / Σ target по контрактам), avgBrakPct (взвешенный
     Σ actual×brak% / Σ actual), tripsTotal (+ разбивка veg/material), remainingMachines
     (≈ (Σ target − Σ accepted) / норма рейса; пометка оценки).
   - completionByCulture: агрегировать getContractExecution({season}).lines по культуре →
     { cultureId, cultureName, color, acceptedTons, targetTons, pct }.
   - acceptanceByWeek: Σ ПРИНЯТОГО веса по ISO-неделе (arrival_date) → [{ isoWeek, label 'W##', tons }].
     (accepted через computeAcceptedKg только для принятых позиций.)
   - brakByCulture: Σ(actual×brak%)/Σ actual по культуре → [{ cultureName, color, pct }].
   - tripsByTc: COUNT рейсов по ТК раздельно — овощные (Shipment в arrived/accepted) и материальные
     (MaterialShipment доставленные), BR-14 → [{ tcName, veg, material }].
   - seasons: список настроенных сезонов (для селектора), пометка текущего.
   Формулы принятого/выполнения — из существующих (execution/computeAcceptedKg), НЕ дублировать.

UI
2) app/(app)/analytics/page.tsx (server): грузит getSeasonAnalytics по ?season (дефолт текущий), рендерит по
   прототипу: шапка + селектор сезона + KPI-полоса (5 плиток) + сетка 2×2.
3) Графики — гибрид (решение PM, см. таблицу Chart tech):
   - **Выполнение по культурам — CSS-бары (НЕ Recharts):** прогресс-список принято/план + % справа;
     переиспользовать существующий exec-bar паттерн (`ContractViewDialog`/вид «План»/карточка фермера,
     вкладка Контракты). Цвет заливки = культура. Pixel-match прототипу.
   - **Recharts (сверить API context7):** Динамика приёмки — Area/Line (accepted по ISO-неделям);
     % брака по культурам — вертикальные Bar (янтарь); Рейсы ТК — grouped Bar (veg/material, графит).
   Оси/сетка — hairline, подписи Geist/Geist Mono tabular-nums; цвета культур из данных (Culture.color).
4) Селектор сезона пишет ?season= в URL (без localStorage), пересчитывает весь дашборд (server re-fetch).
5) Состояния: ранний/пустой сезон — KPI «—» где нет данных, графики держат оси / «данных пока нет» (без
   краха); одна культура/один ТК — бары не растягиваются. По прототипу.

ОГРАНИЧЕНИЯ
- Без миграции/схемы. Read-only — никаких мутаций/StockMovement/записи accepted/brak.
- Агрегаты — из существующих loaders (execution/computeAcceptedKg/feed); формулы НЕ дублировать.
- Recharts — первое использование, API сверить через context7. Сезон — в URL, не localStorage.
- Цвета культур из БД; брак — нейтральный янтарь (не алярм-красный); нейтральные метрики — графит.
- Доки/TASKS — PM.

БД ТЕСТОВАЯ: проверки seed/rolled-back (агрегаты — на чистых функциях + прогон на данных).

ПРОВЕРКА (показать)
- Полный сезон: все 4 графика + KPI наполнены; «выполнение по культурам» суммарно СХОДИТСЯ с KPI выполнение
  (единый источник getContractExecution).
- Ранний/пустой сезон: KPI «—» где нет данных, графики не падают (оси/«данных пока нет»).
- Одна культура / один ТК: бары нормальной ширины, не на всю область.
- Брак: значение = Σ(actual×brak%)/Σ actual по культуре (не по accepted).
- Рейсы ТК: овощные и материальные считаются РАЗДЕЛЬНО (BR-14).
- Смена сезона в селекторе → ?season меняется, дашборд перегружается.
- RBAC: доступ read (все роли); мутаций нет.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью analytics
1. `getSeasonAnalytics` — один агрегатор; выполнение/принято из `getContractExecution` (единый источник), брак из actual×brak%, рейсы ТК раздельно (BR-14). Формулы не продублированы.
2. Динамика — по ПРИНЯТОМУ весу по ISO-неделям; выполнение по культурам — горизонтальные бары.
3. Chart tech: «Выполнение» — CSS exec-бары (переиспользован паттерн, НЕ Recharts); динамика/брак/ТК — Recharts (context7). Оси/подписи/цвета — токены DESIGN-SYSTEM, культуры из БД, брак янтарь.
4. Сезон в URL `?season=` (не localStorage); состояния ранний/пустой/узкий — без краха (по прототипу).
5. Без миграции; read-only; ничего не хранится.

---

## После задачи — обновление памяти (зона PM, не Claude Code)
- TASKS.md: F/V2 · аналитический дашборд → `[x]`.
- CONTEXT-HANDOFF.md: PROJECT STATE / CURRENT IMPLEMENTATION += дашборд аналитики (Recharts введён);
  CURRENT OBJECTIVE/NEXT TASK → следующий F/V2 (факт. ср. вес рейса / печатные формы / сравнение сезонов).
- Отметить: Recharts теперь используется (первый экран) — эталон графиков для следующих.
