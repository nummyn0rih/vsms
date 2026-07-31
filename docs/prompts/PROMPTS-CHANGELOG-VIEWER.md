# PROMPTS — changelog-viewer: экран «Журнал изменений»

> Фича №1 из Этапа 9 аудита. ChangeLog пишется с этапа A6 и уже содержит всю историю правок — но **невидим**.
> Разбор «кто и когда поменял цену/процент/статус» сейчас возможен только запросом в БД.
> **Миграции НЕТ** — индекс `@@index([entity, entity_id])` добавлен в w4a, читаем как есть.

## Что в данных (проверено)

`model ChangeLog`: `entity` (строка), `entity_id`, `field`, `old_value`, `new_value`, `user_id` (nullable),
`timestamp`. Пишется из ~76 мест. Фактические значения `entity` (18 шт.):

`Farmer` · `Culture` · `Driver` · `TransportCompany` · `PackagingType` · `Ingredient` · `SeasonConfig` ·
`AlertRule` · `IngredientRecipe` · `PackagingNorm` · `TripWeightNorm` · `Contract` · `Shipment` ·
`ShipmentItem` · `AcceptanceAct` · `MaterialShipment` · `WeeklyPlan` · `StockMovement`.

**Главная проблема экрана — читаемость.** Сырая строка вида
`AcceptanceAct · 412 · settlement_percent · null → 97.00` бесполезна без словаря. Значит нужен перевод
`entity` и `field` в человеческие подписи, иначе журнал останется тем же SQL, только в браузере.

## Решения (зафиксированы)

| Развилка | Выбор |
|---|---|
| Доступ | **admin-only.** Журнал показывает цены, проценты к оплате и суммы — это не операторский экран |
| Точка входа | Пункт меню в разделе настроек/админ-зоне (`lib/nav.ts`, `roles: ["admin"]`) |
| Пагинация | **Обязательна.** Таблица append-only и растёт быстро; грузить всё нельзя. Страницами по 50, сортировка `timestamp DESC` |
| Словарь подписей | Один модуль-словарь `entity` → название, `entity.field` → подпись. Неизвестный ключ → показываем技 raw-значение, НЕ падаем и не прячем строку |
| Ссылка на объект | Где есть страница сущности (фермер, культура, контракт, отгрузка…) — ссылка по `entity_id`. Где нет (`StockMovement`, нормы) — просто текст |
| История одного объекта | Данные готовим (фильтр по `entity`+`entity_id`), **кнопку «История» на карточках в этот срез НЕ добавляем** |

---

## ПРОМПТ — changelog-viewer (Claude Code)

```text
Задача changelog-viewer (VSMS): экран «Журнал изменений» поверх таблицы ChangeLog — читаемый, с фильтрами и
пагинацией, admin-only. Миграция: НЕТ. Логику записи логов НЕ трогать.

Перед кодом прочитать:
- prisma/schema.prisma → model ChangeLog (индекс [entity, entity_id] уже есть).
- server/changelog.ts — как пишутся записи (logChange, ChangeEntry).
- Значения entity: см. константы ENTITY/SHIPMENT/ITEM/ACT в server/*/actions.ts и server/acceptance/act.ts.
- lib/nav.ts — пункты меню и фильтрация по ролям (navForRole/isHrefAllowedForRole).
- app/(app)/reference/farmers/ — эталон списка с фильтрами в URL (ReferenceToolbar, ?q=).
- components/filters/FilterCombo.tsx — общий фильтр-комбобокс.
- CLAUDE.md (RBAC сервер+клиент; состояние — в URL, не localStorage), DESIGN-SYSTEM.md (токены, tabular-nums,
  Geist Mono для технических меток).

СЕРВЕР
1) server/changelog/query.ts (новый; НЕ трогать server/changelog.ts, который пишет):
   getChangeLog({ entity?, entityId?, userId?, from?, to?, q?, page, pageSize=50 }) →
   { rows, total, page, pageSize }.
   - сортировка timestamp DESC, id DESC (стабильный порядок при равных отметках времени);
   - пагинация skip/take; total — отдельным count;
   - q — поиск по old_value/new_value/field (регистронезависимо);
   - джойн пользователя для отображения логина; user_id = null → «система»;
   - ⚠ await requireRole("admin") первой строкой (RBAC на сервере, не только скрытый пункт меню).
2) server/changelog/labels.ts (новый, ЧИСТЫЙ модуль, без prisma — тестируемый):
   - ENTITY_LABELS: словарь всех 18 значений entity → русское название
     (Farmer «Поставщик», AcceptanceAct «Акт приёмки», ShipmentItem «Позиция отгрузки», StockMovement
      «Движение склада», WeeklyPlan «План недели», TripWeightNorm «Норма веса рейса» и т.д.);
   - FIELD_LABELS: подписи полей, ключ `"<Entity>.<field>"` с fallback на `<field>`
     (напр. AcceptanceAct.settlement_percent → «Процент к оплате», ContractLine.price_per_kg → «Цена, ₽/кг»,
      Shipment.status → «Статус»);
   - функции entityLabel(entity), fieldLabel(entity, field), formatValue(entity, field, value):
     значения статусов переводить в подписи (planned/sent/arrived/accepted → Плановая/Отправлена/Прибыла/Принята),
     null → «—», булевы active → «активен/архив».
   - ⚠ Неизвестный entity/field: вернуть исходную строку, НЕ бросать и НЕ скрывать запись —
     журнал обязан показывать ВСЁ, что записано, даже если словарь отстал от кода.
   - Юнит-тесты: известный ключ → подпись; неизвестный → raw; статусы и null форматируются.
3) entityHref(entity, entityId): ссылка на страницу объекта там, где она есть (Farmer, Culture, Contract,
   Shipment, Driver, TransportCompany, PackagingType, Ingredient…); иначе null.

UI
4) app/(app)/settings/changelog/page.tsx (или иной admin-раздел — согласовать с lib/nav.ts):
   - пункт меню с roles: ["admin"];
   - тулбар: FilterCombo «Сущность» + FilterCombo «Пользователь» + период (с/по) + поиск; всё состояние в URL;
   - таблица: Дата/время · Пользователь · Сущность (ссылка, если есть) · Поле · Было → Стало;
     техничные метки (id, № акта) — Geist Mono; время — по FACTORY_TZ (todayLocalISO/Intl с той же зоной);
   - «Было → Стало» показывать компактно; длинные значения обрезать с тултипом;
   - пагинация внизу (страница N из M, вперёд/назад) — состояние в URL (?page=);
   - пустое состояние: «Изменений за выбранный период нет».
5) RoleGate на клиенте + серверный requireRole("admin") — оба.

ОГРАНИЧЕНИЯ
- Не менять server/changelog.ts и места вызова logChange — читаем то, что уже пишется.
- Не грузить журнал целиком: только страница (pageSize).
- Кнопку «История» на карточках сущностей в этот срез НЕ добавлять (данные под неё готовы фильтром).
- localStorage нельзя; состояние — в URL.
- Не менять схему; экспорт/печать журнала — вне среза.

ПРОВЕРКА (показать)
- Экран открывается только под admin; под operator/user пункт меню скрыт И прямой вызов server-функции
  отклоняется (проверить серверный отказ, не только UI).
- Фильтры (сущность, пользователь, период, поиск) работают по отдельности и вместе; состояние переживает
  перезагрузку; пагинация листается.
- Реальные записи читаемы: показать строки правки цены строки контракта, изменения settlement_percent и
  смены статуса отгрузки — с человеческими подписями и переведёнными значениями.
- Запись с неизвестным словарю entity/field отображается (raw), а не пропадает.
- Ссылка на объект ведёт на его страницу; для StockMovement/норм ссылки нет и вёрстка не ломается.
- npm run test зелёный (+ тесты labels.ts); lint/tsc/build зелёные.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью
1. `requireRole("admin")` на сервере + `RoleGate` на клиенте + `roles: ["admin"]` в меню — все три.
2. Пагинация реальная (грузится страница, не вся таблица); сортировка стабильная.
3. Словарь подписей — чистый модуль с тестами; неизвестный ключ показывается raw, запись не теряется.
4. Значения переведены (статусы, null, булевы); техничные метки — Geist Mono; время в `FACTORY_TZ`.
5. `server/changelog.ts` и вызовы `logChange` не тронуты.
6. Состояние фильтров и страницы — в URL; localStorage нет.
7. Тесты/lint/tsc/build зелёные.

---

## После задачи — PM
`PRD.md`/`DESIGN.md`: экран журнала (состав, доступ). `TASKS.md`: фича закрыта.
Дальше по договорённости — **список мелких фич от пользователя**, затем экспорты расчётного листа
(PDF/Excel/печать) и календарь.
