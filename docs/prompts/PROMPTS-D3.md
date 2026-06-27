# PROMPTS — D3: доставка тары завод→фермер (MaterialShipment)

Третий срез этапа D. Замыкает вторую сторону баланса фермера: тара приходит к фермеру отдельным рейсом.
Зеркало отгрузки продукции, но в обратную сторону и через транзит `-2`.

## Модель (в DOMAIN §3)
- Сущность — `MaterialShipment` (уже в схеме): code, departure_date, arrival_date, status
  (planned/sent/arrived), driver_id, items[]. `MaterialShipmentItem`: farmer_id, item_kind, packaging_type_id,
  quantity. **D3 — только тара** (`item_kind=packaging`); доставка ингредиентов — этап E.
- Кол-во задаётся вручную (`quantity`), НЕ из веса.
- Движения (kind=packaging, movement_type=`delivery`, source=`material_shipment`, source_doc_id=рейс):
  - `planned→sent` → завод(0) → `-2` (в пути с завода);
  - `sent→arrived` → `-2` → фермер (per item).
- **Откат в обе стороны** (отличие от отгрузки продукции — у доставки нет приёмки вниз, тупик недопустим):
  - `sent→planned` → сторно плеча отправки (`-2`→завод), нетто-паттерн;
  - `arrived→sent` → сторно плеча прибытия (фермер→`-2`), нетто-паттерн.
  Оба — Admin, идемпотентно.
- Водитель обязателен (схема: `driver_id Int` non-null) — задаётся при создании.

## Срезы
- **D3a** — дизайн экрана «Логистика материалов» (Claude Design) → `docs/prototypes/material-delivery-d3.html`.
- **D3b** — код: `server/materials/` (CRUD + статус-флоу + движения + сторно) + экран `materials/page.tsx`.

---

## ПРОМПТ — D3a: дизайн экрана «Логистика материалов» (Claude Design)

```text
Спроектируй экран «Логистика материалов» приложения VSMS (внутренняя система поставок овощного сырья на
консервный завод). Здесь снабженец отправляет рейсы с ТАРОЙ (пустые ящики/бочки) со склада завода фермерам.
Один статичный HTML-прототип, app-масштаб. Визуальные правила — docs/DESIGN-SYSTEM.md (токены Vercel).
Это ЗЕРКАЛО отгрузки продукции — держи тот же визуальный язык, что лента отгрузок (docs/prototypes/
lenta-b0.html) и диалог «Отгрузка»; но проще: нет приёмки, актов, калибров, веса.

ЧТО ЭТО. Рейс тары завод→фермер: водитель, даты отправления/прибытия, статус (Плановый/Отправлен/Прибыл),
и позиции — какому фермеру сколько какой тары. Кол-во — в штуках, задаётся вручную (не из веса).

СТРУКТУРА:
- Шапка: «Логистика материалов» + подзаголовок-контекст. Кнопка «+ Рейс тары» (primary, чёрная) → диалог.
- Список рейсов, сгруппированы по неделе отправления (ISO, как лента) ИЛИ просто по статусу — выбери
  читаемее; прошлые свёрнуты, текущие развёрнуты.
- Карточка рейса (как машина в ленте, но проще): левая зона с фоном статуса — бейдж статуса · даты
  «отправление → прибытие» (акцент на прибытии) · водитель «Фамилия И.О. · ТК» (клик → модалка водителя,
  как DriverModal). Правая зона — строка на позицию: «{фермер} · {тип тары} · {N} шт».
- Действия по статусу/роли (как у отгрузки): planned → «Отправить» (admin) + правка/удаление; sent →
  «Прибыл» (admin/operator) и «Откатить в план» (admin); arrived → «Откатить в путь» (admin). Кнопки
  отката — обычные вторичные (обратимо, НЕ красные).

ДИАЛОГ «Рейс тары» (создание = редактирование):
- Даты «Отправление»/«Прибытие» рядом (хинт: введи одну — вторая ±2 дня, обе правятся).
- Водитель — combobox с поиском, ОБЯЗАТЕЛЕН.
- Позиции (1..N): фермер (select) · тип тары (select) · кол-во шт (число). «+ позиция», крестик удаления.
- Футер: Отмена / Сохранить.

ТОКЕНЫ СТАТУСОВ (status-fills; accepted НЕ используется — у тары его нет): planned zone #f5f5f5/badge
#ededed/dot #b3b3b3/fg #888888 · sent zone #eaf2ff/badge #d3e5ff/dot #0070f3/fg #0761d1 · arrived zone
#fff6e3/badge #ffefcf/dot #f5a623/fg #ab570a. radius 6/8, hairline #ebebeb, Geist, tabular-nums, № рейса
Geist Mono. ЗАПРЕЩЕНО: mesh, pill-100px, hero/dark, эмодзи-иконки (иконки — lucide). Тара без цвета
культуры — палитра нейтральная.

ВНЕ СКОУПА: ингредиенты в рейсе (этап E), вес, приёмка/акты, аналитика, мобильная версия.

Выдай один HTML-файл — сохраню как docs/prototypes/material-delivery-d3.html. Покажи 2–3 рейса в разных
статусах + открытый диалог создания.
```

### Чеклист ревью D3a
1. Зеркало ленты/диалога отгрузки, но без приёмки/веса/калибров; язык совпадает.
2. Статусы planned/sent/arrived по status-fills (без accepted); откаты — вторичные, не красные.
3. Диалог: даты + обязательный водитель + позиции (фермер·тип·кол-во шт).
4. Нейтральная палитра (тара без цвета культуры); № рейса mono; tabular-nums.

---

## ПРОМПТ — D3b: код доставки тары (Claude Code)

Делать ПОСЛЕ утверждения `docs/prototypes/material-delivery-d3.html`.

```text
Задача D3b (этап D, VSMS): рейс доставки тары завод→фермер (MaterialShipment) — CRUD + статус-флоу +
движения склада + сторно. ОДИН срез, только тара (item_kind=packaging). Перед кодом — docs/DOMAIN.md §3
(модель тары, транзит -2, movement_type=delivery), CLAUDE.md (логика в server/, баланс не хранить,
ChangeLog в транзакции, эталон CRUD/Server Actions). ЭТАЛОН ДЛЯ МИРРОРИНГА — server/shipments/actions.ts
(createShipment/updateShipment/deleteShipment/sendShipment/revertShipmentToPlanned, getNextCode) и
server/shipments/packaging.ts (двухфазные плечи, нетто-сторно). UI-эталон — app/(app)/shipments/_components
(ShipmentFormDialog, DriverModal, shipment-actions, shipment-status). Прототип (УТВЕРЖДЁН) —
docs/prototypes/material-delivery-d3.html. Prisma/Next API — context7.

КОНТЕКСТ СХЕМЫ (НЕ менять):
- MaterialShipment(code, departure_date, arrival_date, status: ShipmentStatus, driver_id: Int NON-NULL, items)
  + MaterialShipmentItem(material_shipment_id, farmer_id, item_kind, packaging_type_id?, ingredient_id?,
  quantity). Полиморфизм по item_kind — в D3 всегда packaging (packaging_type_id заполнен, ingredient_id null).
- Константы: FACTORY_LOCATION_ID=0, TRANSIT_TO_FARMER=-2 (server/shipments/packaging.ts).
- SourceDocType содержит `material_shipment`.

1) server/materials/ — новый домен по эталону Farmer/Shipment:
   - schema.ts — zod (даты, driver_id обязателен, items: 1..N, у каждой farmer_id+packaging_type_id+
     quantity>0 целое).
   - actions.ts — Server Actions (ActionResult, requireRole, $transaction, logChange):
     • createMaterialShipment / updateMaterialShipment / deleteMaterialShipment (только planned;
       код через свой getNextMaterialCode — отдельная нумерация, не пересекается с отгрузками).
     • sendMaterialShipment (planned→sent, admin): плечо ОТПРАВКИ — на каждую позицию движение
       {kind:"packaging", packaging_type_id, quantity, from_location_id:FACTORY_LOCATION_ID,
       to_location_id:TRANSIT_TO_FARMER, from_state/to_state:"good", movement_type:"delivery",
       source_doc_type:"material_shipment", source_doc_id:рейс}. Идемпотентно.
     • arriveMaterialShipment (sent→arrived, admin/operator): плечо ПРИБЫТИЯ — на каждую позицию
       {from:TRANSIT_TO_FARMER, to:farmer_id, ... movement_type:"delivery", source=material_shipment}.
       Идемпотентно (проверка существующих движений -2→farmer этого рейса).
     • revertMaterialToSent (arrived→sent, admin): сторно плеча прибытия нетто-паттерном по
       (packaging_type × farmer): оригинал to=farmer (из -2) плюс; сторно to=-2 минус; для нетто>0 —
       обратное {from:farmer, to:-2}. Идемпотентно.
     • revertMaterialToPlanned (sent→planned, admin): сторно плеча отправки нетто по packaging_type:
       оригинал to=-2 (из завода) плюс; сторно to=завод минус; для нетто>0 — обратное {from:-2, to:завод}.
       Идемпотентно.
   Нетто-сторно и идемпотентность — копировать механику revertShipmentToPlanned/applyInboundArrivedTareLeg.

2) UI — заменить заглушку app/(app)/materials/page.tsx («этап E») на экран «Логистика материалов» по
   прототипу: server-загрузчик getMaterialShipments, **группировка по неделе ISO отправления** (как лента
   отгрузок); карточки со статусом/датами (компактный формат «19→22 июня» как lenta-b0)/водителем
   (DriverModal-паттерн)/позициями, действия по статусу+роли (RoleGate + серверные requireRole). Диалог
   «Рейс тары» (создание=редактирование) по образцу ShipmentFormDialog: даты, водитель (обязателен),
   позиции фермер·тип·кол-во. Статусы — status-fills (без accepted).
   - **Иконка типа тары — по `PackagingType.kind`** (`box`→иконка ящика, `barrel`→иконка бочки) + нейтральный
     fallback. НЕ хардкодить по id/имени.
   - **Итоги по типам — динамически** (Σ quantity по каждому встреченному типу рейса), не зашивать
     «ящики/бочки» в разметку.

ОГРАНИЧЕНИЯ:
- Только packaging-позиции (ингредиенты — этап E; в форме типа груза нет, всегда тара).
- Схему НЕ менять; баланс не хранить; логика в server/; компоненты отображают/зовут actions.
- Движения — kind=packaging, source=material_shipment; не путать с источником shipment (это другой рейс).
- **Прибытие в D3 — машинное (весь рейс разом), статус sent→arrived бинарный.** НО плечо прибытия писать
  ПО ПОЗИЦИЯМ (итерировать items), а статус-логику держать изолированно — чтобы поза-позиционная отметка
  (D3-2) добавлялась без переписывания.
- Перенос фермер→фермер (transfer) — НЕ в D3 (нужен источник-фермер, которого в MaterialShipment нет;
  откладывается в E). Баланс/дашборд это переживут (Σ движений по любым from/to).
- Доки/TASKS.md не трогать (обновит ассистент после ревью).

ПРОВЕРКА (rolled-back tx / тест-данные, покажи):
- создать рейс (фермер X: 4000 ящиков), отправить: завод −4000 · транзит -2 +4000 · фермер 0;
- прибытие: -2 → 0 · фермер +4000; повтор прибытия → дублей нет;
- revert arrived→sent: фермер −4000 · -2 +4000 (вернулось в путь); revert sent→planned: -2 → 0 · завод +4000;
- многопозиционный рейс (2 фермера) разносит прибытие по фермерам корректно;
- non-admin: send/revert отклоняются; operator может «Прибыл».
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью D3b
1. Движения: `delivery`, source=`material_shipment`; отправка завод→`-2`, прибытие `-2`→фермер.
2. Оба отката (sent→planned и arrived→sent) — нетто-паттерн, идемпотентны, Admin.
3. Идемпотентность плеч (повтор send/arrive не дублирует).
4. Только packaging-позиции; код рейса — отдельная нумерация; схема не тронута.
5. UI зеркалит отгрузку (форма/статусы/откаты), но без приёмки; RBAC на сервере и клиенте.
6. Полный цикл: завод −N · фермер +N · транзит 0.

---

## D3-2 (опц., после D3) — позиционная отметка прибытия рейса
Машина развозит тару/специи по фермерам в разные дни → отметка «прибыл» на КАЖДОЙ позиции. Паттерн —
копия позиционной приёмки продукции (BR-13, производный статус машины). Состав: миграция
`MaterialShipmentItem += arrived_at DateTime?`; per-position action arriveMaterialItem (плечо `-2→фермер`
этой позиции) + откат; статус машины производный (отправлен/частично прибыл/прибыл); UI — кнопка «прибыл»
на строке + общая «прибыл всё». Прямо переиспользуется в E (доставка специй). Детализирую по запросу.

---

## После D3 — остаётся D4 (дашборд)
Матрица локация×тип (Завод + фермеры + «в пути на завод/с завода») с РЕАЛЬНЫМИ остатками — к этому моменту
все плечи (D2 входящая, D3 доставка) и начальные остатки (D1) есть, баланс честный. Доработка прототипа
`inventory-tare-d0.html` (транзит-колонки/строки, легенда «реальный остаток»). Опц.: транзит по фермеру
(join к Shipment/MaterialShipment). Детализирую после D3.
