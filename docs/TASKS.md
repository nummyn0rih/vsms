# TASKS.md — Чеклист разработки VSMS

> Живой документ. Обновляется постоянно. Статусы: `[ ]` todo · `[~]` в работе · `[x]` готово.
> Детализируй следующий этап ПЕРЕД его началом, не раньше (избегаем преждевременной детализации).
> При работе с AI прикладывай: DOMAIN.md (всегда для логики) + нужный раздел PRD.md + этот файл.

**Текущий фокус:** Этапы A, B, C, D, E — закрыты. **D2-ops — ЗАКРЫТ** (лом+утиль+корректировка, без миграции). **Следующий: D3-2** (позиционное прибытие рейса — требует миграции `MaterialShipmentItem += arrived_at`, обсуждается перед кодом). Далее в очереди: farmer→farmer transfer · B5 · широкий V1.1. Промпты — `docs/PROMPTS-D2OPS-*.md`.

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
- [x] **B2 — статусы + тара:** переходы `planned → sent` (BR-13); авто-движение тары на `sent` + сторно при откате `sent → planned` (BR-3, BR-19, StockMovement). Чистый расчёт `server/shipments/packaging.ts` (`calcPackagingUnits`: ящик по `PackagingNorm`, бочка по `capacity_kg`, навал → none, нет нормы → ошибка; ceil, Decimal). Server-actions `sendShipment`/`revertShipmentToPlanned`/`previewShipmentTare` (admin, `$transaction` + ChangeLog). Откат — сторно НЕТТО по группам (тип тары × фермер), идемпотентно при повторном цикле. UI: кнопки «Отправить» (предпросмотр списания, блок при нет водителя/нет нормы) и «Откатить»; Edit/Delete скрыты для не-`planned`. _(Прим.: формула `calcPackagingUnits` ниже по тексту B2 — историческая; в B2.5 заменена на единую `ceil(planned_weight / нетто-норма)` по тройке фермер×культура×тип, развилка box/barrel и `capacity_kg`-расчёт сняты. Актуальное — в B2.5 и DOMAIN §3.)_
- [x] **B2.5 — тип тары на уровне позиции (норма по тройке):** схема — `CulturePackagingType` (разрешённые типы культуры + один дефолт), `PackagingNorm` по тройке фермер×культура×тип, `ShipmentItem.packaging_type_id`, дроп `Culture.packaging_type_id`. Ручная миграция с переносом данных + guard. Расчёт тары — единая формула `ceil(planned/нетто-норма)` без развилки box/barrel (`capacity_kg` справочное). Справочник культур: multi-select типов + дефолт. Редактор норм: матрица только однотиповые культуры, новый `MultiTypeNormEditor` для многотиповых. Форма отгрузки: выбор типа тары (дефолт авто) + инфо-строка нормы. Серверная валидация членства типа в культуре. DOMAIN.md актуализирован.
- [x] **B3 — Лента:** ISO-недельная группировка, сворачивание, центрирование на текущей неделе, шапка недели, дневные подытоги. _(срез 1/3: server-агрегации `server/shipments/feed.ts` — дерево сезон→неделя→день→машина→позиция, чистые `weekSummary`/`daySummary`, ISO-хелперы в `workdays.ts`; рефактор каскада формы позиции в `useShipmentItemField` — сделано. **Срез 2/3 (сделано):** вёрстка ленты-леджера (`ShipmentsFeed`→`WeekBlock`→`DayBlock`→`MachineRow`), двухзонная машина, чипы культур/подытоги тары, сворачивание недель (React state) + авто-скролл к текущей; модалка водителя `DriverModal` (tel:, копирование, +3 passthrough-поля в `feed.ts`); подключены существующие диалоги (форма/отправка/откат/удаление, вынос в `shipment-actions.tsx`), read-only форма для sent+; loading/error/пустое состояние. Старая таблица B1 удалена. **Фикс 17b (сделано):** подключён self-hosted Geist/Geist Mono (`next/font/local`, variable woff2 в `app/fonts/`, кириллица, без CDN), починена CSS-переменная `--font-sans` в `globals.css`; убран дубль пункта меню «Отгрузки (B1)» — «Лента отгрузок» → `/shipments`, корень `/` и логин редиректят на `/shipments`. **Визуал ленты приведён к прототипу `lenta-b0.html`:** бейджи статусов (soft-фон + точка, словарь «Плановая/Отправлена/Прибыла/Принята», убран «Черновик»); иерархия весов в шапках недели/дня; левая зона машины — фикс. 2 строки, группа иконок-действий по статусу (planned ✏🗑✈ · sent ✏↩ · arrived/accepted ✏); подложки позиций `color-mix 9%`. **fix-3 (сделано):** строка позиции и шапки приведены к прототипу — двухуровневые токены статусов (`zone`/`badge`, исправлен accepted), чипы итогов (квадратная метка 2px, вес 600), даты рейса (отправление muted · стрелка `#a1a1a1` · прибытие 600), водитель/ТК-muted + значок (i), grid строки позиции, RU-склонение тары (`pluralRu` в `format.ts`, итоги дня свёрнуты по `kind`). **Срез 3/3 — тулбар (17c, сделано):** sticky-тулбар (2 ряда; переключатель недели скроллом + «Сегодня» + scrollspy; Heatmap/План/Excel — disabled-заглушки), sticky-шапки недель (`top: var(--toolbar-h)` через ResizeObserver, непрозрачный фон), клиентские фильтры Поставщик/Сырьё/Статус (combobox, мультивыбор, нейтральная заливка + счётчик) + поиск + «Скрыть плановые» + «Сбросить»; фильтрация на уровне машины; пересчёт подытогов из видимого набора теми же чистыми хелперами; состояния загрузка / пустой сезон / пусто-после-фильтра. **fix sticky-gap (сделано):** убран прозрачный зазор над приклеенным тулбаром (`.toolbar{top:0;margin-top:0}` + воздух перенесён на уезжающую шапку страницы). **Диалоги статусов (сделано):** временный AlertDialog заменён на свёрстанные shadcn Dialog (Отправить A/B + Откатить) по `status-dialogs-*.html`; данные — синхронно из `FeedItem` через чистый `buildSendPreview` (группировка/сумма уже посчитанных `tareUnits`, НЕ пересчёт тары); блокеры отправки (нет нормы / нет водителя) — disabled + тултип, сервер всё равно валидирует; `previewShipmentTare`/`ShipmentTarePreview` осиротели → удаляются отдельным chore-коммитом. **B3 закрыт — лента ведётся вместо Google Sheets.**)_
- [x] **B4 — План недели + перевеска (ЗАКРЫТ):** _(**B4a (сделано):** миграция `WeeklyPlan` += `season_year`, `date Date?` (null=недельная цель) + partial-unique индексы; `server/plan/` — upsert цели (пустая=удалить), конверсия день↔неделя (BR-21, равномерно, Σ сохраняется, ChangeLog), валидация BR-20; загрузчик `getPlanWeek`; вид «План» (снят disabled, матрица культура×день + «Неделя» по `plan-view-b4.html`, sticky шапка/первый столбец, автосейв по blur, тумблер гранулярности → конверсии, RBAC admin); прогресс-бары — раздельно `actualKg`(сплошное)/`planRemainingKg`(штрих) + риска-цель + перелёт, эффективный вес BR-22. **fix-1/fix-2 (сделано):** ширина/раскладка влево, узкие→полные инпуты, один скролл + sticky thead/первый столбец (убран лишний overflow), тумблер Дни/Неделя вправо-стеком, убрана лишняя строка week-mode, `—` без «т», формат 0,1 т (целые целыми, полная точность в БД), headline «План недели: X/Y т» в контекст-полосе (только по плановым культурам), подвал «Итого по неделе» (по всем; week-mode только в «Неделя»), убран бейдж `факт 0` (вернётся в B4b), бар не рисуется у пустых (0/0), week-mode зона помечена. **B4c — состав недели (сделано):** миграция `WeeklyPlanScope` (уникум iso_year+iso_week+culture); `add/removeCultureFromScope` (идемпотентно, ChangeLog); `getPlanWeek` → видимые `rows` по BR-23 (состав ИЛИ цель ИЛИ отгрузки) + `scopePicker` (состояния locked/inScope); combobox «Культуры · N» по `plan-scope-b4c.html` (locked-пункты с причиной, пустая неделя, read-only для operator/user). **B4b — перевеска (сделано):** вкладка «Приёмка» — зона 1 «Ожидают перевески» (`sent`) + зона 2 «На приёмке» (`arrived`) + заглушка зоны 3; `server/acceptance/` — `setActualWeight` (autosave, авто `sent→arrived` в одной транзакции, BR-24а) + `markArrived` («Отметить прибытие», BR-24б); `getAcceptanceBoard`; инлайн-поле веса (рамка/фон/формат «13 945 кг»); «Акт» — disabled-заглушка **на позиции** `arrived+` (приёмка позиционная, BR-13/26); бейдж «N/M взвешено»; в ленте «факт {вес} кг» на `arrived+`; RBAC operator/admin, user read-only; вернён бейдж факта в «План». **DOMAIN:** BR-13 (приёмка позиционная, статус машины производный), BR-24/25/26, модели WeeklyPlan(расширен)/WeeklyPlanScope/AcceptanceAct(per-item). _(Открытый вопрос в C: пользователь добавил «Акт» и на `sent`-партии зоны 1 — определить в C0, делает ли он `sent→arrived` шорткатом или акт-сохранение тянет переход.)_ )_
- [ ] **B5 — Доска-планировщик:** drag-drop (@dnd-kit), пересчёт дат при перетаскивании, прогресс к WeeklyPlan.

**Критерий:** можно вести ленту отгрузок вместо Google Sheets.

---

## Этап C — Приёмка и контракты (MVP, часть 3)

**Прогресс:** C0 (дизайн формы акта, `acceptance-act-c0.html`) — принят. **C1 — ЗАКРЫТ:**
- [x] **C1 — форма акта приёмки позиции (simple + calibre):** `server/acceptance/` — `getActContext`, `saveAct`, `revertAct` (откат внутри акта, admin); приёмка позиции ⇔ существует `AcceptanceAct` (1:1); авто-`accepted` машины при приёмке последней позиции (BR-13); № акта в рамках сезона, хранится `{season_year}-{n}` (BR-9). **simple:** вес + brak% → `accepted = факт×(1−брак%)`. **calibre — ОДНОСТУПЕНЧАТО (BR-10):** категории схемы + брак (поле, последней строкой таблицы) делят факт, Σ=100% от факта, `accepted = факт×Σ(принятых %)`; нестандарт `is_accepted=false` → «— не в зачёт» (опц. ручная привязка). Привязка строки контракта (BR-7/8). UI: фикс шортката из зоны 1, read-only веса у принятой позиции, реактивность после saveAct, лента по ПОЗИЦИИ («факт {вес} · к оплате {принятый}», независимо от машины, DESIGN §2), бейджи машины «взвешено · N/M»/«принято · N/M», «🗎 Акт принят». Принятый/«к оплате» — производные, из точных %. БЕЗ движений склада (C2) и стоимости/выполнения (C3).

Осталось в C:
- [x] **C2 — движение ингредиента на приёмке позиции (ЗАКРЫТ).** Чистая `server/acceptance/ingredients.ts` (`calcIngredientConsumption`: факт×`qty_per_kg_product`, ROUND_HALF_UP 6 знаков, фильтр >0). Врезка в `saveAct` (создание `StockMovement kind=ingredient`, `from=farmer · to=null`, `movement_type=consumption`, `source=acceptance_act/act.id`; идемпотентно — при существующих движениях акта пропуск) и в `revertAct` (сторно нетто-паттерном по `(ingredient, farmer)`, обратное `null→farmer`, идемпотентно). База = ФАКТ (BR-4), не accepted. Культура без рецептуры → 0 движений. Миграция `c2_ingredient_consumption` (enum += `consumption`/`acceptance_act`; `quantity → Decimal(15,6)` ради аскорбинки ~0,00005). _Проверка (rolled-back tx, реальные данные): патиссоны 17500 → расход 6 знаков ✓; идемпотентность saveAct (count 3, дублей нет) ✓; откат → нетто 0 ✓; повторный revert → 0 групп ✓; огурцы без рецептуры → 0 движений, акт сохранён ✓; тара B2 после Decimal(15,6) — юниты целые ✓._
- [ ] **C3 — деньги (живой пересчёт, БР-1/6; принятый × цена строки) — ЗАКРЫТ (C3a–C3d):**
  - [x] **C3a** — расчёт стоимости + выполнения строк: `server/contracts/execution.ts` (`itemCost`, `attributeAcceptedToLines`, `lineExecution`) + загрузчик `getContractExecution`; разнесение по привязкам категорий калибра. Чистые функции, БЕЗ UI, ничего не хранится. _Проверка: 18/18 + живой прогон._ Отклонение (согласовано): принятый вес считается на лету (`computeAcceptedKg`), колонка `accepted_weight_kg` мёртвая → помечена deprecated в DOMAIN.
  - [x] **C3b** — дизайн зоны 3 «Принято» (`docs/prototypes/acceptance-zone3-c3.html`). _Правка: убрана отвергнутая двухступенчатость (калибр одноступенчато от факта); первопричина — формулировка «100% годного» в DOMAIN — исправлена._
  - [x] **C3c** — зона 3 «Принято» код: `getAcceptanceBoard` отдаёт zone3 (`AcceptedMachine[]`), новый `AcceptedMachine.tsx` (просмотр: факт · к оплате · калибр-чипы · стоимость · № акта · строка) + откат акта (admin, переиспользует `revertAct` со сторно C2). Нестандарт — без ₽ (line=null). Принятый/стоимость — на лету.
  - [x] **C3d** — выполнение/стоимость по строкам в `ContractViewDialog` на `getContractExecution` (принято/выполнение%/стоимость, живой пересчёт). Прогресс в списке и ручная привязка нестандарта вынесены (C3d-2/C3d-3, опц.).

## Этап D — жизненный цикл тары (ЗАКРЫТ)
Баланс тары = Σ движений по тройке локация×тип×состояние. Локации: 0=завод · Farmer.id · -1=в пути на завод · -2=в пути с завода · null=вне системы. Движение тары двухфазное (дебет при отправке, кредит при прибытии).
- [x] **D1** — модель + начальные остатки: миграция `MovementType += opening`; константы транзита `-1/-2` (`server/shipments/packaging.ts`); сброс старых tare-движений (скрипт); экран Настройки→«Начальные остатки тары» (`server/inventory/opening.ts`, матрица завод+фермеры×типы → `opening`-движения, замена при правке). _Проверено._
- [x] **D2** — входящая тара двухфазно (переписан B2): `sendShipment` фермер→`-1`; `applyInboundArrivedTareLeg` (`-1`→завод) в обеих точках `sent→arrived` (`acceptance/actions.ts`: авто-вес + markArrived; `act.ts` не тронут); `revert` на `TRANSIT_TO_FACTORY`. Идемпотентно; плечо прибытия не сторнируется (переход односторонний). _6/6 сценариев ✓._
- [x] **D3** — доставка тары завод→фермер: `server/materials/` (CRUD + статус-флоу + плечи `завод→-2→фермер` + оба отката нетто, обратимо) + экран «Логистика материалов» (`materials/page.tsx`, недели ISO, иконки по `kind`). Только packaging; ингредиенты — E. _Принято._
- [x] **D4** — дашборд «Тара»: `server/inventory/balances.ts` (`getTareBalances`) + `packaging/page.tsx` (матрица локация×тип + строки транзита, сегмент good/scrap, drill-down, «Итого в системе»). Реальные остатки. _Принято._
- [x] **D2-ops** — ручные операции тары: лом (`scrap`), корректировка (`adjustment`), утиль (`disposal`). Без миграции (enum есть). _Закрыт._
- [ ] **D3-2** (опц.) — позиционное прибытие рейса (`MaterialShipmentItem += arrived_at`, производный статус машины). Требует миграции; обсуждается.

Блоки (исходный план):
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

## D2-ops — ручные операции тары (ЗАКРЫТ)
Без миграции (enum scrap/disposal/adjustment есть). Tare-only. admin. source=manual, причина в ChangeLog.
- [x] **D2-ops-1** — лом (scrap: loc/good→loc/scrap) + утиль (disposal: loc/scrap→null) из drill-down; `server/inventory/operations.ts`. _Принято._
- [x] **D2-ops-1-fix** — scrap-вид матрицы сделан кликабельным (был D4b-заглушкой) → disposal достижим; футер scrap-вида «Лом в системе». _Принято._
- [x] **D2-ops-2** — корректировка как инвентаризация (ввод факта → движение adjustment на разницу), оба состояния. _Принято._

---

## Этап E — ингредиенты/специи (паритет с тарой) (ЗАКРЫТ)
Без миграции (схема полиморфна). Доставка ингредиента — тот же `MaterialShipment`, параметризованный по `item_kind`; смешанный груз штатно; транзит ингредиента только `-2`; состояние всегда good.
- [x] **E1** — движок доставки (параметризация, вариант A): обобщены 4 плеч-хелпера `server/materials/movements.ts` под `item_kind` (kind/FK построчно); сняты `kind:"packaging"` из гвардов идемпотентности; нетто-сторно ключуется с `kind`. `actions.ts` пишет реальный item_kind+FK, деталь += ingredient; `schema.ts` — discriminated union. _Регресс тары 6/6 + ингредиент + смешанный рейс ✓._
- [x] **E2** — UI смешанного рейса: `listMaterialOptions` += ингредиенты (unit); `feed-loader` итоги раздельно (тара шт · ингредиент Σ кг/Σ л); `MaterialFormDialog` тоггл Тара|Ингредиент + своп пикера + сброс FK; FK-Select сохраняет неактивный; `MaterialsFeed` рендер ингредиентов. _Принято._
- [x] **E3** — начальные остатки ингредиентов: `server/inventory/opening.ts` параметризован по kind (тара целое · ингредиент Decimal); `/settings/opening-stock` += вкладки Тара|Ингредиенты (unit в шапке). Замена + ChangeLog в транзакции. _Регресс тары + дробный ввод ✓._
- [x] **E4** — дашборд балансов ингредиентов: `server/inventory/balances.ts` += `getIngredientBalances`/`getIngredientMovements` (зеркало tare, общая агрегация — хелпер); экран `/ingredients` (заменил заглушку). Без scrap, один транзит `-2`, колонки с unit, «Итог» учитывает consumption (≠ opening — норма), drill-down с чипом «расход в производство». _Принято._
- [ ] **transfer фермер→фермер** (отложен) — нужен источник-фермер у `MaterialShipment` (правка схемы).

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

## V1.1 — остаток (после этапа E)

Блоки: Ингредиенты: потребность сезона + AlertRule-алерты (доставка/балансы/расход — сделаны в E) · Heatmap · AlertRule-алерты · Карточка поставщика (все вкладки) · Фильтры везде.

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
