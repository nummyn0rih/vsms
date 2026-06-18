# TASKS.md — Чеклист разработки VSMS

> Живой документ. Обновляется постоянно. Статусы: `[ ]` todo · `[~]` в работе · `[x]` готово.
> Детализируй следующий этап ПЕРЕД его началом, не раньше (избегаем преждевременной детализации).
> При работе с AI прикладывай: DOMAIN.md (всегда для логики) + нужный раздел PRD.md + этот файл.

**Текущий фокус:** Этап B (Ядро отгрузок). B-контракты-мини, B1, B2, B2.5 закрыты. Следующий — B0 (дизайн-сессия) / B3 (Лента).

---

## Этап 0 — Окружение (разовая настройка, перед A)

- [x] Создать Next.js проект (App Router + TypeScript): `npx create-next-app@latest`
- [x] Установить Tailwind (идёт с create-next-app) и инициализировать shadcn/ui: `npx shadcn@latest init`
- [x] Поднять PostgreSQL (выбрать Neon или Supabase) — получить connection string
- [x] Установить Prisma: `npm i -D prisma` + `npm i @prisma/client`, `npx prisma init`
- [x] Прописать DATABASE_URL в `.env`, проверить подключение
- [x] Установить Auth.js (NextAuth)
- [x] Создать структуру папок: `app/`, `server/`, `prisma/`, `components/ui/`
- [x] Инициализировать git, первый коммит
- [x] Завести `.env.example` (без секретов) для памяти о нужных переменных

**Критерий готовности:** `npm run dev` поднимает пустое приложение, Prisma видит БД.

---

## Этап A — Фундамент (MVP, часть 1)

> Цель: завести все справочные данные сезона. Освоить связку Next.js + Prisma на простом CRUD до сложной логики.

### A1. Схема данных (Prisma)
> Источник: DOMAIN.md раздел 2. Закладываем СРАЗУ все таблицы (схема заморожена), даже если UI к ним появится позже — это избавит от миграций в середине проекта.

- [x] Описать в `schema.prisma` справочники: Farmer, Culture, TransportCompany, Driver, PackagingType, Ingredient
- [x] Описать настройки: PackagingNorm, TripWeightNorm, IngredientRecipe, CalibreScheme, CalibreRange, SeasonConfig, AlertRule
- [x] Описать контракты: Contract, ContractLine
- [x] Описать операции: Shipment, ShipmentItem, AcceptanceAct, CalibreResult, MaterialShipment, MaterialShipmentItem, WeeklyPlan
- [x] Описать StockMovement (единый движок)
- [x] Описать доступ: User, ChangeLog (с этапа A2)
- [x] Проставить enums: ShipmentStatus, Role, ItemKind, MovementType, AcceptanceType, IngredientUnit, PackagingKind, StockState, SourceDocType
- [x] Проставить связи (FK), уникальные индексы (PackagingNorm/TripWeightNorm уникум farmer+culture; IngredientRecipe уникум culture+ingredient; CalibreScheme.culture_id; act_number; WeeklyPlan уникум year+week+culture)
- [x] CHECK-констрейнты полиморфизма (StockMovement, MaterialShipmentItem) — raw SQL в миграции
- [x] `npx prisma migrate dev --name full_schema` — миграция применена
- [x] Проверка: CHECK срабатывает (smoke-insert отклонён), таблицы созданы

**Критерий:** вся модель из DOMAIN.md существует в БД, миграция прошла.

### A2. Аутентификация и роли
- [x] Настроить Auth.js: вход по логину/паролю (Auth.js v5, Credentials)
- [x] Хранить роль (admin/operator/user) в сессии (jwt/session callbacks)
- [x] Хеширование паролей (bcrypt/argon2) — bcryptjs
- [x] Серверный guard: helper для проверки роли в server-функциях (`server/auth/session.ts` requireRole)
- [x] Клиентский helper: скрытие элементов по роли (`components/auth/RoleGate.tsx`)
- [x] Создать первого admin-пользователя — сид `prisma/seed.ts` (создан admin, role=admin)
- [x] Страница логина, редирект неавторизованных (`/login`, `proxy.ts`)

**Критерий:** вход работает, роль определяется, RBAC проверяется на сервере (не только пряча кнопки).

### A3. Базовый каркас приложения
- [x] Layout с навигацией (меню из PRD раздел 17), пункты скрываются по роли — левый сайдбар (`app/(app)/layout.tsx`, `components/layout/Sidebar.tsx`, `lib/nav.ts`)
- [x] Пустые страницы-заглушки для всех разделов меню (`components/layout/Placeholder.tsx`)
- [x] Подключить базовые shadcn-компоненты: Table, Form, Dialog, Input, Select, Button (+ Switch, Badge, AlertDialog, Sonner)
- [x] Общий паттерн server-функции (эталон на Farmer, дальше копировать)

**Критерий:** есть навигация, можно ходить по разделам, паттерн CRUD отработан на одном примере.

### A4. CRUD справочников
> Каждый справочник по одному паттерну. Soft delete (active=false), не физическое удаление (BR-15).

- [x] Фермеры (Farmer): список с фильтром, создание, правка, деактивация — ЭТАЛОН паттерна (`server/farmers/`, `app/(app)/reference/farmers/`)
  - Эталон зафиксирован. Паттерны для копирования на остальные справочники:
    1. `lib/validators.ts` — общий `phoneSchema` + `normalizePhone` (для tel:).
    2. contacts — структурированный объект `{phone*, contactPerson?, messenger?, email?}` в Json-колонке (не плоская строка); раздельные поля формы через RHF dot-notation `contacts.phone`.
    3. Soft-delete двусторонний: `setFarmerActive(id, active)` (одна server-action туда-обратно) + кнопка по статусу строки (Деактивировать с AlertDialog / Активировать). ChangeLog по полю active.
- [x] Культуры (Culture): цветовая метка (color picker + hex), acceptance_type (simple/calibre), привязка PackagingType (nullable, неактивный тип не теряется в edit) (`server/cultures/`, `app/(app)/reference/cultures/`). Калибры (CalibreScheme) — отдельно в A5.
- [x] Транспортные компании (TransportCompany): name/notes, soft delete (`server/transport-companies/`, `app/(app)/reference/transport-companies/`)
- [x] Водители (Driver): сплошной список, фильтр по компании и фамилии (оба в URL, комбинируются), кликабельный телефон (`tel:` через normalizePhone), поле info, FK-Select ТК (неактивная не теряется в edit) (`server/drivers/`, `app/(app)/reference/drivers/`)
- [x] Типы тары (PackagingType): ящик/бочка, capacity_kg — условная валидация zod (barrel→capacity обязателен, box→null), поле ёмкости условно по kind (`server/packaging-types/`, `app/(app)/reference/packaging-types/`)
- [x] Ингредиенты (Ingredient): name, unit (kg/l, Select с подписями кг/л), soft delete (`server/ingredients/`, `app/(app)/reference/ingredients/`)

**Критерий:** все справочники заполняемы, фильтры работают, телефон кликабелен. — ВЫПОЛНЕН, A4 закрыт.

### A5. CRUD настроек (нормы и схемы)
- [x] SeasonConfig: настройка сезона, рабочие дни лето/зима — `summer_workdays/winter_workdays` мигрированы `Int → Int[]` (наборы дней недели 0=Пн…6=Вс, BR-18), CRUD списком, уникум season_year, дефолты лето 01.06–30.09 Пн–Сб / зима Пн–Пт (`server/seasons/`, `app/(app)/settings/seasons/`)
- [x] PackagingNorm + TripWeightNorm: единая редактируемая сетка фермер×культура (один `MatrixGrid`, два режима через shadcn Tabs — «Вес тары»/«Вес рейса»). Автосохранение ячейки по blur/Enter (upsert/delete только этой пары), пусто=нормы нет (delete), счётчик версий против гонок, индикаторы idle/saving/saved/error, sticky первая колонка + горизонтальный скролл, счётчик заполненности. В режиме тары ячейка культуры без `packaging_type` заблокирована (disabled + tooltip) + двойная серверная валидация. logChange на upsert/delete (`server/norms/`, `app/(app)/settings/norms/`)
- [x] CalibreScheme + CalibreRange: схема **категорий приёмки** на культуру — редактор внутри формы Culture (блок виден при acceptance_type=calibre), useFieldArray + zod superRefine. Категория не обязательно размерная: min/max nullable, оба пусты = безразмерная («Брак»). Правила: размерная min>0, нет пересечений (только между размерными), открытый верх только у последней размерной, ≥1 принятая, уникальные label; дыры — warning. Сохранение атомарно с культурой ($transaction), `server/cultures/calibre.ts`. Модалка скроллится (header/footer закреплены). Привязка категорий к строкам контракта (CalibreResult.contract_line_id, ContractLine.label — миграция calibre_categories) — на приёмке, этап C.
- [x] IngredientRecipe: рецептура культура×ингредиент → кол-во на кг — группировка по культуре (Select→строки), добавление/правка qty inline/удаление, уникум пары, подсказка ед. (кг/л) (`server/recipes/`, `app/(app)/settings/recipes/`)
- [x] AlertRule: пороги дефицита — CRUD порогов (item_kind условный Select тара/ингредиент, location_scope «любой фермер»/фермер, threshold>0). Сами алерты (сравнение с балансом) — V1.1 (`server/alert-rules/`, `app/(app)/settings/alert-rules/`)

**Критерий:** все нормы для сезона можно задать; калибровка огурцов настроена.

### A6. ChangeLog (инфраструктура)
- [x] Helper записи в ChangeLog (entity, field, old/new, user, timestamp) — `server/changelog.ts` `logChange()` (заведён попутно с Farmer)
- [~] Подключить к правкам справочников — сделано для Farmer; остальные по мере добавления

**Критерий:** правки пишутся в лог, Admin может его посмотреть.

**ИТОГ ЭТАПА A (ЗАКРЫТ):** можно завести все справочные и настроечные данные сезона с чистого листа. Готов к вводу операций.

---

## Этап B — Ядро отгрузок (MVP, часть 2)

> Здесь подключается Claude Design (лента и доска — нестандартный UX).

- [ ] **B0 — Дизайн-сессия (Claude Design):** прототипы ленты / доски-планировщика / карточки отгрузки → завести `docs/DESIGN.md`.
- [x] **B-контракты-мини:** минимальный CRUD контрактов (Contract + ContractLine: создание/правка/просмотр/удаление, useFieldArray, фильтры фермер/сезон, дубли культур разрешены BR-5). БЕЗ выполнения и стоимости (это Этап C). Вытащен вперёд как зависимость B1 (привязка `ShipmentItem.contract_line_id`). `server/contracts/`, `app/(app)/contracts/`.
- [x] **B1 — server-ядро отгрузок:** Shipment + ShipmentItem (CRUD только `planned`, 1–4 позиции, водитель опционален), даты: ввод одной → вторая ±2 (BR-12), валидация рабочего дня по SeasonConfig + дефолты (BR-11/17/18, чистая `isFactoryWorkday`), привязка `contract_line_id` с серверной проверкой BR-7, сквозной `code`, ChangeLog, физ. удаление только `planned` (BR-19). `server/shipments/`, временный список `app/(app)/shipments/`. Combobox (поиск водителя/строки). Миграция: `Shipment.driver_id` → nullable + `comment`. Переходы статусов/тара — B2.
- [x] **B2 — статусы + тара:** переходы `planned → sent` (BR-13); авто-движение тары на `sent` + сторно при откате `sent → planned` (BR-3, BR-19, StockMovement). Чистый расчёт `server/shipments/packaging.ts` (`calcPackagingUnits`: ящик по `PackagingNorm`, бочка по `capacity_kg`, навал → none, нет нормы → ошибка; ceil, Decimal). Server-actions `sendShipment`/`revertShipmentToPlanned`/`previewShipmentTare` (admin, `$transaction` + ChangeLog). Откат — сторно НЕТТО по группам (тип тары × фермер), идемпотентно при повторном цикле. UI: кнопки «Отправить» (предпросмотр списания, блок при нет водителя/нет нормы) и «Откатить»; Edit/Delete скрыты для не-`planned`.
- [x] **B2.5 — тип тары на уровне позиции (норма по тройке):** схема — `CulturePackagingType` (разрешённые типы культуры + один дефолт), `PackagingNorm` по тройке фермер×культура×тип, `ShipmentItem.packaging_type_id`, дроп `Culture.packaging_type_id`. Ручная миграция с переносом данных + guard. Расчёт тары — единая формула `ceil(planned/нетто-норма)` без развилки box/barrel (`capacity_kg` справочное). Справочник культур: multi-select типов + дефолт. Редактор норм: матрица только однотиповые культуры, новый `MultiTypeNormEditor` для многотиповых. Форма отгрузки: выбор типа тары (дефолт авто) + инфо-строка нормы. Серверная валидация членства типа в культуре. DOMAIN.md актуализирован.
- [~] **B3 — Лента:** ISO-недельная группировка, сворачивание, центрирование на текущей неделе, шапка недели, дневные подытоги. _(срез 1/3: server-агрегации `server/shipments/feed.ts` — дерево сезон→неделя→день→машина→позиция, чистые `weekSummary`/`daySummary`, ISO-хелперы в `workdays.ts`; рефактор каскада формы позиции в `useShipmentItemField` — сделано. **Срез 2/3 (сделано):** вёрстка ленты-леджера (`ShipmentsFeed`→`WeekBlock`→`DayBlock`→`MachineRow`), двухзонная машина, чипы культур/подытоги тары, сворачивание недель (React state) + авто-скролл к текущей; модалка водителя `DriverModal` (tel:, копирование, +3 passthrough-поля в `feed.ts`); подключены существующие диалоги (форма/отправка/откат/удаление, вынос в `shipment-actions.tsx`), read-only форма для sent+; loading/error/пустое состояние. Старая таблица B1 удалена. **Фикс 17b (сделано):** подключён self-hosted Geist/Geist Mono (`next/font/local`, variable woff2 в `app/fonts/`, кириллица, без CDN), починена CSS-переменная `--font-sans` в `globals.css`; убран дубль пункта меню «Отгрузки (B1)» — «Лента отгрузок» → `/shipments`, корень `/` и логин редиректят на `/shipments`. **Визуал ленты приведён к прототипу `lenta-b0.html`:** бейджи статусов (soft-фон + точка, словарь «Плановая/Отправлена/Прибыла/Принята», убран «Черновик»); иерархия весов в шапках недели/дня; левая зона машины — фикс. 2 строки, группа иконок-действий по статусу (planned ✏🗑✈ · sent ✏↩ · arrived/accepted ✏); подложки позиций `color-mix 9%`. Срез 3/3: тулбар (фильтры/поиск/переключатель недели), Excel.)_
- [ ] **B4 — WeeklyPlan + прогресс:** ввод недельного плана от завода, прогресс к плану недели.
- [ ] **B5 — Доска-планировщик:** drag-drop (@dnd-kit), пересчёт дат при перетаскивании, прогресс к WeeklyPlan.

**Критерий:** можно вести ленту отгрузок вместо Google Sheets.

---

## Этап C — Приёмка и контракты (MVP, часть 3)

Блоки:
- Статусы arrived, accepted; приёмка оператором
- Перевеска: actual_weight по позициям
- AcceptanceAct: простой (% принято/брак) и калибры (BR-10, сумма=100%)
- act_number = номер партии (BR-9)
- accepted_weight (производное), статистика брака (BR-1, BR-2)
- Contract + ContractLine: строки, несколько строк/культуру (BR-5)
- Привязка позиции к строке: авто/выбор (BR-8), валидация той же культуры+фермера (BR-7)
- Живой расчёт % выполнения и стоимости (BR-6)

**Критерий:** считается % выполнения и стоимость по принятому весу.

---

## Этап D — Тара и MVP-аналитика (MVP, часть 4)

Блоки:
- StockMovement: все типы движений, балансы (Σ, могут быть отрицательными)
- Лом как состояние, баланс лома по фермеру; утиль (disposal)
- Ручная корректировка остатков (adjustment)
- Аналитика-минимум: % выполнения, % брака, стоимость, осталось ~N машин, рейсы ТК
- Экспорт таблицы отгрузок в Excel (SheetJS)

**Критерий:** MVP замещает Excel. ПРИНЯТЬ РЕШЕНИЕ О ПЕРЕХОДЕ на систему.

---

## Этап E — V1.1

Блоки: Ингредиенты (полный модуль + потребность + алерты) · Логистика материалов (MaterialShipment) · Heatmap · AlertRule-алерты · Карточка поставщика (все вкладки) · Фильтры везде.

---

## Этап F — V2

Блоки: Сравнение сезонов год-к-году · Графики/дашборды (Recharts) · Печатные формы · Фактический средний вес рейса.

---

## Этап G — Поздние задачи

Блоки: Импорт исторических данных · Резервное копирование БД (автоматическое).

---

## Сквозные правила работы (держать в голове весь проект)

- Бизнес-логика — в `server/`, НЕ в компонентах.
- Не вставлять код, который не можешь объяснить (BR — риск техдолга).
- Балансы и стоимость — вычислять, не хранить.
- Каждый модуль доводить до рабочего состояния перед следующим (вертикальные срезы).
- При задаче по логике AI получает DOMAIN.md + раздел PRD + этот файл.
- Коммит после каждой завершённой задачи.
