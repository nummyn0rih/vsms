# PROMPTS — materials-fix: повторный цикл отправки + сортировка по прибытию

> Две правки по ревью transfer-2. Без миграции.
> 1. [блокер] Плечо ОТПРАВКИ использует гард по существованию → после полного цикла (send→…→revertToPlanned)
>    повторная отправка не создаёт движение (находит старое) → рейс пропадает с дашборда на 2-м цикле.
>    Чиним: перевести гард плеча отправки на НЕТТО (как уже у прибытия `applyArrivedLegForItem` и у откатов).
> 2. Сортировка рейсов внутри недели на /materials — по дате ПРИБЫТИЯ (сейчас по created_at).

## Диагноз (баг 1)
`applyOutboundDeliveryLeg` (movements.ts): `existing = findFirst{source_doc_id, from:origin, to:transit};
if (existing) return 0;`. Откаты — нетто-сторно (append, не delete) → оригинал отправки остаётся в леджере
(нетто=0, но запись есть). 2-й send находит её → return 0 → плеча нет → нетто рейса 0 → не виден на дашборде.
Прибытие этим НЕ страдает (там уже нетто-гард). Дубли позиций запрещены (D3-2a-fix) → нетто-гард корректен.

---

## ПРОМПТ — materials-fix (Claude Code)

```text
Задача materials-fix (VSMS): 2 правки. Без миграции. Перед кодом — server/materials/movements.ts
(LegContext, applyOutboundDeliveryLeg, arrivedNetForItem, revertDeliveryLeg) и server/materials/feed-loader.ts.

1) server/materials/movements.ts — applyOutboundDeliveryLeg: заменить гард по СУЩЕСТВОВАНИЮ на НЕТТО
   (симметрично applyArrivedLegForItem и revertDeliveryLeg, которые уже нетто):
   - Завести helper outboundNetForTrip(tx, tripId, ctx): прочитать движения source_doc_id=tripId; нетто =
     Σ quantity где (from_location_id=ctx.origin AND to_location_id=ctx.transit)  −
     Σ quantity где (from_location_id=ctx.transit AND to_location_id=ctx.origin). Вернуть Prisma.Decimal.
     (Отправка атомарна на весь рейс: нетто>0 — плечо открыто, =0 — откачено/не было.)
   - В applyOutboundDeliveryLeg: вместо `existing = findFirst…; if (existing) return 0;` →
     `if ((await outboundNetForTrip(tx, tripId, ctx)).gt(0)) return 0;`. Остальное (создание движений
     origin→transit на каждую позицию, per-kind FK) НЕ менять.
   - Проверить, что revertDeliveryLeg по-прежнему корректно сторнирует и что повторный send ПОСЛЕ полного
     отката создаёт плечо заново.

2) server/materials/feed-loader.ts — сортировка рейсов ВНУТРИ недели по дате ПРИБЫТИЯ:
   - В каждой недельной группе сортировать trips по arrival_date ASC, nulls last (рейсы без даты прибытия —
     в конце), тай-брейк: departure_date ASC, затем id ASC. Группировка по ISO-неделе отправления —
     оставить как есть; меняется только порядок ВНУТРИ недели.

ОГРАНИЧЕНИЯ:
- Только эти 2 файла. Схему/миграции/прочие плечи/откаты/статус/RBAC — НЕ трогать.
- Доставка и перенос — оба через общий движок: фикс плеча отправки чинит ОБА (origin/transit из ctx).
- Доки/TASKS — не трогать.

БД ТЕСТОВАЯ (правило проекта): данные одноразовые; проверки seed/rolled-back.

ПРОВЕРКА (показать):
A. ПОВТОРНЫЙ ЦИКЛ — ДОСТАВКА (баг 1):
   - рейс с завода, смешанный груз; цикл-1: send → markAll → unmarkAll → revertToPlanned (дашборд пуст,
     status=planned); цикл-2: send СНОВА → транзит -2 = qty (рейс ВИДЕН на дашборде); markAll → у фермеров;
     повтор send внутри цикла → дублей нет (нетто-гард).
B. ПОВТОРНЫЙ ЦИКЛ — ПЕРЕНОС: то же для transfer (origin=A, транзит -3): цикл-2 send снова показывает -3=qty.
C. РЕГРЕСС одиночного цикла: send/markItem/markAll/unmark*/revertToPlanned — балансы и откаты как раньше.
D. СОРТИРОВКА: в неделе три рейса с разными arrival_date → порядок по прибытию ASC; рейс без arrival_date —
   в конце недели.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью materials-fix
1. `applyOutboundDeliveryLeg` — нетто-гард (`outboundNetForTrip().gt(0) → 0`), без findFirst-по-существованию.
2. Повторный send после полного отката создаёт плечо заново (доставка И перенос); рейс виден на дашборде на 2-м цикле.
3. Идемпотентность внутри цикла сохранена (двойной send → без дублей); revertDeliveryLeg не тронут по сути.
4. feed-loader: внутри недели сортировка по arrival_date ASC (nulls last; тай-брейк departure/id).
5. Только movements.ts + feed-loader; схема/прочие плечи/статус/RBAC не тронуты; регресс одиночного цикла зелёный.
