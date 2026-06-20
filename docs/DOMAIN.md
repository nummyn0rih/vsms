# DOMAIN.md — Доменное ядро VSMS

> Этот документ — единственный источник истины по модели данных и бизнес-правилам.
> Прикладывать к AI при КАЖДОЙ задаче, затрагивающей бизнес-логику.
> Меняется только при изменении требований (синхронно с PRD.md раздел 10).

---

## 1. Три базы расчёта веса (КРИТИЧНО — ядро всех расчётов)

Самая частая ошибка — перепутать базу. Каждый расчёт использует строго определённый вес:

| Что считаем | База веса | Почему |
|---|---|---|
| Тара (движение) | **Плановый** (planned_weight) | Отправили 1000 ящиков — пришла 1000, вне зависимости от приёмки |
| Ингредиенты (расход) | **Фактический** (actual_weight, перевеска) | Заложены в производство ДО браковки |
| Контракт + стоимость | **Принятый** (accepted_weight, после брака) | Платим только за принятое |
| Брак (статистика) | **Фактический** (actual_weight, знаменатель) | % брака = непринято / перевеска |

**Три веса позиции (ShipmentItem):**
- `planned_weight_kg` — приблизительный, при создании отгрузки.
- `actual_weight_kg` — после сплошной перевески на воротах.
- `accepted_weight_kg` — производное = actual × Σ(принятых %).

---

## 2. Сущности и связи

### Группы
```
СПРАВОЧНИКИ:  Farmer · Culture · TransportCompany · Driver · PackagingType · Ingredient
НАСТРОЙКИ:    PackagingNorm · TripWeightNorm · IngredientRecipe · CalibreScheme(+Range) ·
              SeasonConfig · AlertRule
КОНТРАКТЫ:    Contract · ContractLine
ОПЕРАЦИИ:     Shipment(+Item) · AcceptanceAct(+CalibreResult) · MaterialShipment(+Item) · WeeklyPlan · WeeklyPlanScope
СКЛАД-ДВИЖОК: StockMovement
ДОСТУП:       User · ChangeLog
```

### ERD (текстом)
```
Farmer 1───N Contract 1───N ContractLine
Farmer 1───N Shipment (через ShipmentItem)
Farmer 1───N PackagingNorm     (фермер × культура × тип тары → нетто ед.тары)
Farmer 1───N TripWeightNorm    (фермер × культура → плановый вес рейса)

Culture 1───N ContractLine
Culture 1───N ShipmentItem
Culture 1───1 CalibreScheme     (если acceptance_type = calibre)
Culture 1───N PackagingNorm
Culture 1───N TripWeightNorm
Culture N───N PackagingType   (через CulturePackagingType, один is_default)

TransportCompany 1───N Driver
Driver 1───N Shipment           (1 рейс = 1 водитель)
Driver 1───N MaterialShipment

Shipment 1───N ShipmentItem
ShipmentItem N───1 ContractLine (nullable до приёмки; NOT NULL при accepted)
ShipmentItem 1───1 AcceptanceAct
AcceptanceAct 1───N CalibreResult
CalibreScheme 1───N CalibreRange
CalibreRange 1───N CalibreResult
ContractLine 1───N CalibreResult (nullable; привязка категории к строке оплаты)

MaterialShipment 1───N MaterialShipmentItem
MaterialShipmentItem ──> PackagingType ИЛИ Ingredient (полиморфно, item_kind)

StockMovement ──> PackagingType ИЛИ Ingredient (kind)
StockMovement ──> source: Shipment | MaterialShipment | manual

IngredientRecipe: Culture N───N Ingredient (через связку, qty_per_kg_product)
```

### Таблицы

**Справочники**

| Сущность | Атрибуты |
|---|---|
| Farmer | id, name, contacts(json), notes, active |
| Culture | id, name, color (hex), acceptance_type {simple\|calibre}, active. Разрешённые типы тары — через CulturePackagingType (m2m, один дефолт); ноль связей = навал |
| TransportCompany | id, name, notes, active |
| Driver | id, full_name, phone, transport_company_id (FK), info (free text) |
| PackagingType | id, name, kind {box\|barrel}, capacity_kg (200/250; null для ящика; СПРАВОЧНОЕ брутто, в расчёте тары НЕ участвует), active |
| CulturePackagingType | culture_id, packaging_type_id, is_default; уникум (culture, packaging_type). Разрешённые типы тары культуры, ровно один is_default (server-валидация) |
| Ingredient | id, name, unit {kg\|l}, active |

**Настройки**

| Сущность | Атрибуты | Назначение |
|---|---|---|
| PackagingNorm | farmer_id, culture_id, packaging_type_id, avg_unit_weight_kg | нетто продукта на ед.тары ДАННОГО типа; уникум (farmer, culture, packaging_type) — норма по тройке |
| TripWeightNorm | farmer_id, culture_id, planned_trip_weight_kg | основа «осталось ~N машин» |
| IngredientRecipe | culture_id, ingredient_id, qty_per_kg_product | рецептура на кг продукции (M:N) |
| CalibreScheme | id, culture_id | привязана к калибруемой культуре |
| CalibreRange | id, scheme_id, label, min_cm (nullable), max_cm (nullable), is_accepted | **категория приёмки** (не обязательно размерная). min/max пусты = безразмерная категория («Брак»). Размерная: min задан, max пуст = открытый верх (>предел). |
| SeasonConfig | season_year, summer_start, summer_end, summer_workdays `Int[]`, winter_workdays `Int[]` (массивы дней недели, 0=Пн … 6=Вс; дефолт лето Пн–Сб, зима Пн–Пт) | источник рабочих дней |
| AlertRule | id, item_kind, item_id, location_scope, threshold | пороги дефицита |

**Контракты**

| Сущность | Атрибуты |
|---|---|
| Contract | id, farmer_id, season_year, created_at, notes |
| ContractLine | id, contract_id, culture_id, label (nullable), volume_tons, price_per_kg, created_at — label = имя строки («стандарт», «нестандарт >12», «доп. объём август») |

**Операции — ядро**

| Сущность | Атрибуты |
|---|---|
| Shipment | id, code, departure_date, arrival_date, status {planned\|sent\|arrived\|accepted}, driver_id (FK), created_by, timestamps |
| ShipmentItem | id, shipment_id (FK), farmer_id (FK), culture_id (FK), planned_weight_kg, actual_weight_kg, packaging_type_id (FK, nullable=навал; выбор из разрешённых типов культуры), contract_line_id (FK, nullable до accepted), accepted_weight_kg (производное) |
| AcceptanceAct | id, shipment_item_id (FK), brak_percent, accepted_percent (simple), comment, act_number, weighed_at |
| CalibreResult | id, acceptance_act_id (FK), calibre_range_id (FK), percent, contract_line_id (FK, nullable) — привязка категории к строке = оплата по этой строке (объём+цена строки); null = только статистика |

**Операции — логистика материалов**

| Сущность | Атрибуты |
|---|---|
| MaterialShipment | id, code, departure_date, arrival_date (+2), status, driver_id (FK) |
| MaterialShipmentItem | id, material_shipment_id (FK), farmer_id (FK), item_kind {packaging\|ingredient}, packaging_type_id ИЛИ ingredient_id, quantity |

**План / Доступ**

| Сущность | Атрибуты |
|---|---|
| WeeklyPlan | id, season_year, iso_year, iso_week, culture_id, date (Date, **nullable**), target_tons. **Гранулярность (BR-20):** `date` задан → цель на ДЕНЬ (ось date×culture); `date=null` → цель на ВСЮ неделю (ось iso_year×iso_week×culture). Для пары (неделя, культура) допустимо ЛИБО набор дневных строк, ЛИБО одна недельная — не одновременно. Partial-unique: `(date, culture_id) WHERE date IS NOT NULL` и `(iso_year, iso_week, culture_id) WHERE date IS NULL`. |
| WeeklyPlanScope | id, season_year, iso_year, iso_week, culture_id; уникум (iso_year, iso_week, culture_id). **Состав плана недели** — какие культуры показываются/планируются на этой неделе. Общий server-state (НЕ личный UI-фильтр). Управляет видимостью ПУСТЫХ культур (пред-выбор под план до ввода цели). См. BR-23. |
| User | id, login, role {admin\|operator\|user}, password_hash, active |
| ChangeLog | id, entity, entity_id, field, old_value, new_value, user_id, timestamp |

---

## 3. Единый складской движок (StockMovement)

Тара и ингредиенты — ОДИН движок, дискриминатор `kind`.

`StockMovement`: id, date, kind {packaging\|ingredient}, item_id, quantity, from_location_id, to_location_id, from_state, to_state, movement_type, source_doc_type, source_doc_id.

`movement_type`: return (фермер→завод, авто из Shipment) · delivery (завод→фермер, из MaterialShipment) · transfer (фермер→фермер) · scrap (годная→лом, same loc) · disposal (лом→out, утиль) · adjustment (ручная правка).

**Правила движка:**
1. **Локация** = завод (фикс. id=0) ∪ Farmer.id. Лом/утиль — НЕ локации.
2. **Лом — это состояние** (`state`), не место. «Списать в лом» = движение годная→лом на той же локации. «Утилизация» = disposal лома из системы. Баланс лома по фермеру виден (для сбора целой машиной).
3. **Авто-движение тары** при переходе Shipment `planned → sent` (НЕ при создании): тип тары берётся из ShipmentItem.packaging_type_id, quantity = ceil(planned_weight / PackagingNorm.avg_unit_weight по тройке фермер×культура×тип), тип return. Развилки box/barrel нет, capacity_kg не участвует. Навал (тип=null) → движения нет. Нет нормы по тройке → переход заблокирован. НЕ зависит от приёмки. Откат `sent → planned` (только Admin) сторнирует обратным движением (BR-3, BR-19).
4. **Авто-расход ингредиентов** на приёмке: actual_weight × IngredientRecipe, списание у фермера.
5. **Баланс**(location, item, state) = Σ in − Σ out. Может быть ОТРИЦАТЕЛЬНЫМ (разрешено).
6. Дефицит НЕ блокирует отгрузку — только информационные алерты (AlertRule.threshold).

---

## 4. Бизнес-правила (инварианты)

| # | Правило |
|---|---|
| BR-1 | Выполнение контракта и стоимость считаются ТОЛЬКО от принятого веса. Брак не уменьшает и не участвует. |
| BR-2 | Брак — чисто статистический параметр (% по фермеру/культуре/сезону), база — фактический вес. |
| BR-3 | Тара двигается по плановому весу при переходе отгрузки `planned → sent` (НЕ при создании), НЕ пересчитывается на приёмке. На статусе `planned` тара показывается информационно (плановая потребность), баланс НЕ меняется. Откат `sent → planned` (только Admin) сторнирует движение обратным `StockMovement`. |
| BR-4 | Ингредиенты расходуются по фактическому весу (перевеска), т.к. заложены до браковки. |
| BR-5 | Цена — это строки контракта (ContractLine). Одна культура может иметь несколько строк с разной ценой. |
| BR-6 | Стоимость/выполнение — ЖИВОЙ пересчёт: при изменении цены строки или перепривязки все привязанные позиции пересчитываются автоматически (цифры не хранятся). |
| BR-7 | Перепривязать ShipmentItem можно только к строке ТОЙ ЖЕ культуры и ТОГО ЖЕ фермера. Блокирующая валидация. То же для привязки категории приёмки (CalibreResult.contract_line_id) — только строка той же культуры и того же фермера. |
| BR-8 | contract_line_id обязателен (NOT NULL) при переходе позиции в accepted. Если строк культуры >1 — выбор обязателен; если 1 — авто. |
| BR-9 | act_number = номер партии, присваивается на заводе, уникален, обязателен при accepted. Каждая позиция машины = своя партия. |
| BR-10 | Калибры (acceptance_type=calibre): вся раскладка партии вносится категориями схемы, Σ % всех категорий = 100%. brak_percent акта НЕ используется (он только для simple). accepted = actual × Σ(% категорий где is_accepted=true). Дефолт привязки категорий к строке на приёмке: is_accepted=true → наследуют привязку позиции (ShipmentItem.contract_line_id); is_accepted=false → null. Админ может вручную привязать категорию к другой строке (напр. >12 → строка «нестандарт»). |
| BR-11 | Дата прибытия не должна падать на нерабочий день завода (валидация по SeasonConfig). |
| BR-12 | При создании отгрузки вводится дата прибытия ИЛИ отправления, вторая = ±2 дня. Обе правятся вручную потом. |
| BR-13 | Статусы: planned→sent→arrived→accepted. Откат — только Admin, с записью в ChangeLog. |
| BR-14 | Рейс ТК = факт прибытия/доставки машины. Овощные и материальные рейсы считаются раздельно. Фермер→фермер и лом/утиль рейсами не считаются. |
| BR-15 | Удаление справочников со связями — только soft delete (active=false). |
| BR-16 | Все правки цены/привязки/статусов/приёмки логируются в ChangeLog. |
| BR-17 | Номера недель — ISO-календарные. season_year = год начала сезона (июнь). |
| BR-18 | Рабочие дни: лето (июнь–сент) Пн–Сб (6), зима (окт–май) Пн–Пт (5). Берутся из SeasonConfig. |
| BR-19 | Отгрузка в статусе `planned` — черновик без движений, может быть удалена физически. Со статуса `sent` и далее удаление запрещено: сначала откат статуса Admin (со сторно движений по BR-3), затем удаление. |
| BR-20 | План недели (WeeklyPlan) задаётся для пары (неделя, культура) в ОДНОЙ гранулярности: либо дневные строки (`date` задан; можно не на все дни), либо одна недельная (`date=null`). Смешивать в рамках одной (неделя, культура) запрещено — иначе двойной учёт. Контроль: server-валидация при сохранении + partial-unique индексы. Прогресс при дневной гранулярности раскладывается по дате прибытия; при недельной — суммируется на неделю. |
| BR-21 | Конверсия гранулярности (атомарно, $transaction, в ChangeLog), итог сохраняется: **день→неделя** — дневные строки (неделя,культура) заменяются одной недельной, `target_tons = Σ дневных`. **неделя→дни** — недельная строка заменяется дневными по рабочим дням этой ISO-недели (SeasonConfig); target распределяется равномерно, остаток — на последний рабочий день (Σ точно сохраняется); далее правится вручную. |
| BR-22 | **Прогресс плана считается по ЭФФЕКТИВНОМУ весу** позиции: `effective = actual_weight_kg ?? planned_weight_kg` (есть перевеска → по ней, иначе по плановому). Это эвристика прогресса планирования, НЕ одна из трёх учётных баз (§1) и НЕ «принятый». В прогресс идут все неудалённые отгрузки (planned/sent/arrived/accepted). Дефицит/перелив информативны, не блокируют. **Headline «выполнение плана» (набрано/цель)** считается ТОЛЬКО по культурам, у которых есть цель: Σ effective(культуры с целью) / Σ целей. Факт культур без цели в headline НЕ идёт (остаётся в их строках). |
| BR-23 | Видимость строки культуры в виде «План» недели = (культура в `WeeklyPlanScope` этой недели) ИЛИ (есть цель `WeeklyPlan` на неделе) ИЛИ (есть неудалённые отгрузки культуры на неделе). `WeeklyPlanScope` управляет только ПУСТЫМИ культурами (заранее открыть под план). Удаление культуры из scope не трогает её цели/отгрузки; если они есть — строка остаётся видимой по другим условиям. **week-mode культура** (цель `date=null`): её цель и факт идут ТОЛЬКО в колонку «Неделя»; в дневных колонках и в дневных подытогах `tfoot` она НЕ участвует (дневной подвал = только day-mode культуры; колонка «Неделя» подвала = все культуры). Редактирование состава — admin; видят все. |

---

## 5. Производные величины (вычислять, НЕ хранить)

| Что | Формула | База |
|---|---|---|
| accepted_weight | actual × Σ(принятых %) | — |
| % выполнения строки | Σ accepted (farmer×culture×line) / volume_tons | принятый |
| стоимость | Σ (accepted × price_per_kg строки) | принятый |
| % брака | Σ (actual × brak%) / Σ actual | фактический |
| распределение калибров | Σ (actual × калибр%) / Σ accepted | фактический→принятый |
| баланс тары/ингр. | Σ движений (по location, item, state) | — |
| рейсы ТК (овощи) | COUNT Shipment по ТК в arrived/accepted | — |
| рейсы ТК (материалы) | COUNT MaterialShipment доставленных | — |
| осталось ~N машин | (volume − accepted) / TripWeightNorm | принятый |
| прогресс плана (день/неделя) | Σ effective веса позиций / WeeklyPlan.target_tons (по оси date×culture или iso_week×culture; кг→т) | **эффективный = actual ?? planned** (BR-22) |
| недельные/дневные итоги | агрегаты ShipmentItem по arrival_date | — |

**Для calibre-культур** (раскладка по категориям, каждая со своей привязкой к строке):

| Что | Формула | База |
|---|---|---|
| выполнение строки | Σ (actual × % категорий, привязанных к ЭТОЙ строке) / volume_tons | принятый |
| стоимость | Σ по категориям (actual × % × price_per_kg ИХ строки) | принятый |
| accepted_weight позиции | actual × Σ (% привязанных категорий) | принятый |
| нестандарт | Σ (actual × % категорий is_accepted=false с размерами) | фактический |

- **Нестандарт** (категории `is_accepted=false` с размерами, напр. >12) — отдельная статистика, **НЕ брак** (брак = только simple-культуры).
- **Объёмы стандарта и нестандарта не смешиваются.** Даже если нестандарт оплачивается по цене стандарта — это ОТДЕЛЬНАЯ строка контракта (та же цена, свой объём). Категории привязаны к разным строкам → их accepted идёт в выполнение разных строк.

---

## 6. Справочные константы домена

- Типы тары: ящик овощной (томаты, черри); бочка металл 200 кг (патиссоны маринованные); бочка пластик 250 кг (патиссоны, перец сладкий, халапеньо — маринованные).
- Ингредиенты: соль, уксус, аскорбиновая кислота, пиросульфит (для маринованных).
- Калибруемая культура (пример): огурцы — категории 6–9 см (принято), 9–12 см (принято), >12 см (открытый верх, не принято), Брак (безразмерная, не принято).
- Сезон: июнь→май. season_year = год июня.
