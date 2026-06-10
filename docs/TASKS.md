# TASKS.md — Чеклист разработки VSMS

> Живой документ. Обновляется постоянно. Статусы: `[ ]` todo · `[~]` в работе · `[x]` готово.
> Детализируй следующий этап ПЕРЕД его началом, не раньше (избегаем преждевременной детализации).
> При работе с AI прикладывай: DOMAIN.md (всегда для логики) + нужный раздел PRD.md + этот файл.

**Текущий фокус:** Этап A — Фундамент.

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
- [ ] Транспортные компании (TransportCompany)
- [ ] Водители (Driver): сплошной список, фильтр по компании и фамилии, кликабельный телефон (`tel:`), поле info
- [x] Типы тары (PackagingType): ящик/бочка, capacity_kg — условная валидация zod (barrel→capacity обязателен, box→null), поле ёмкости условно по kind (`server/packaging-types/`, `app/(app)/reference/packaging-types/`)
- [ ] Ингредиенты (Ingredient)

**Критерий:** все справочники заполняемы, фильтры работают, телефон кликабелен.

### A5. CRUD настроек (нормы и схемы)
- [ ] SeasonConfig: настройка сезона, рабочие дни лето/зима
- [ ] PackagingNorm: матрица фермер×культура → средний вес ед.тары
- [ ] TripWeightNorm: матрица фермер×культура → плановый вес рейса
- [x] CalibreScheme + CalibreRange: схема **категорий приёмки** на культуру — редактор внутри формы Culture (блок виден при acceptance_type=calibre), useFieldArray + zod superRefine. Категория не обязательно размерная: min/max nullable, оба пусты = безразмерная («Брак»). Правила: размерная min>0, нет пересечений (только между размерными), открытый верх только у последней размерной, ≥1 принятая, уникальные label; дыры — warning. Сохранение атомарно с культурой ($transaction), `server/cultures/calibre.ts`. Модалка скроллится (header/footer закреплены). Привязка категорий к строкам контракта (CalibreResult.contract_line_id, ContractLine.label — миграция calibre_categories) — на приёмке, этап C.
- [ ] IngredientRecipe: рецептура культура×ингредиент → кол-во на кг
- [ ] AlertRule: пороги дефицита (можно отложить к V1.1, но таблица уже есть)

**Критерий:** все нормы для сезона можно задать; калибровка огурцов настроена.

### A6. ChangeLog (инфраструктура)
- [x] Helper записи в ChangeLog (entity, field, old/new, user, timestamp) — `server/changelog.ts` `logChange()` (заведён попутно с Farmer)
- [~] Подключить к правкам справочников — сделано для Farmer; остальные по мере добавления

**Критерий:** правки пишутся в лог, Admin может его посмотреть.

**ИТОГ ЭТАПА A:** можно завести все справочные и настроечные данные сезона с чистого листа. Готов к вводу операций.

---

## Этап B — Ядро отгрузок (MVP, часть 2)

> Детализировать перед стартом. Здесь подключается Claude Design (лента и доска — нестандартный UX).

Блоки:
- Claude Design: прототипы ленты и доски-планировщика → завести DESIGN.md
- Shipment + ShipmentItem: создание машины, мультипозиции, привязка водителя
- Логика дат: ввод одной даты → вторая ±2 (BR-12), валидация рабочего дня (BR-11)
- Статусы planned→sent (BR-13)
- Лента: недельная группировка (ISO), сворачивание, центрирование на текущей неделе, шапка недели, дневные подытоги
- Доска: drag-drop (@dnd-kit), пересчёт дат, прогресс к WeeklyPlan
- Авто-движение тары при создании отгрузки (BR-3, StockMovement)
- WeeklyPlan: ввод недельного плана от завода

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
