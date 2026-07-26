# PROD-DEPLOY — VSMS выкат в прод

> Runbook первого прод-выката и перехода на dev-ветку. Стек уже прод-готов (Neon облачный, Next деплоится
> нативно, миграции есть). Балансы/стоимость вычисляются → кэш переносить не нужно, старт с чистой БД чистый.
> Исполнители помечены: **[Ivan]** — внешние консоли (Vercel/Neon/GitHub), **[CC]** — Claude Code (код+git).

## Решения (зафиксированы)

| Развилка | Выбор |
|---|---|
| Хостинг | **Vercel** (managed, нативный Next 16, авто-деплой main→прод / dev→preview). |
| Прод-БД | **Отдельная от dev.** Neon: default-ветка = **прод**, дочерняя ветка `dev` = разработка/preview. |
| Стартовые данные | **Чистая прод-БД** + ввод справочников руками. Импорт Excel-истории — отдельно, этап G. |
| Пользователи на старте | **Только Ivan** (admin). Бэкапы всё равно ставим; RBAC-мультиюзер — не срочно. |
| Git-flow | `main` = прод (защищён, авто-релиз), `dev` = интеграция + preview. Фичи — ветками от `dev`. |
| Миграции | Автор локально `migrate dev` (dev Neon-ветка) → коммит → на Vercel build `migrate deploy` (идемпотентно). |
| Прод-данные | **Ценные.** Правило CLAUDE.md «dev одноразовые, вайп перед продом» — ТОЛЬКО про dev-ветку (см. §9). |

---

## Фаза 1 — Пре-флайт код-правки [CC]

> Отдельный маленький срез перед выкатом. Ветка `chore/prod-preflight` от `main` (или прямо в `main` — solo).

```text
Задача prod-preflight (VSMS): подготовить репозиторий к деплою на Vercel с Neon (прод + dev ветки).
Миграция: НЕТ (только конфиги/скрипты). Перед кодом прочитать: prisma.config.ts, package.json, auth.config.ts,
auth.ts, lib/prisma.ts, .env.example. Prisma/Auth.js v5/Next 16 — сверить по context7.

1) prisma.config.ts — миграции/studio через ПРЯМОЙ коннект: datasource.url = env("DIRECT_URL")
   (сейчас pooled DATABASE_URL — это был WSL-компромисс; на Vercel/Mac direct-эндпоинт Neon доступен, а pooled
   PgBouncer ломает DDL/advisory-lock миграций). Рантайм (lib/prisma, adapter-pg) остаётся на pooled DATABASE_URL —
   его НЕ трогать. Комментарий про WSL заменить на «migrate/studio — DIRECT_URL».
   ⚠ На СИД это не влияет: prisma/seed.ts поднимает СВОЙ клиент из process.env.DATABASE_URL и datasource из
   prisma.config.ts не читает. Поведение сида не менять — просто не считать, что он пойдёт через DIRECT_URL.
2) package.json build — гарантировать генерацию клиента и применение миграций на Vercel:
   "build": "prisma generate && prisma migrate deploy && next build"
   (Vercel не зовёт prisma generate сам; client пишется в gitignored lib/generated/prisma. migrate deploy
   идемпотентен — применяет только незакоммиченные-но-невыполненные миграции; на preview бьёт по dev-ветке Neon,
   на прод — по прод-БД, каждый по своим env). NODE_OPTIONS-префикс в build можно убрать (WSL-специфичный,
   на Vercel не нужен) — если убираешь, убери и из start; в dev-скрипте оставь.
3) Auth.js v5 на Vercel — устойчивость за прокси: в auth.ts (или authConfig) добавить trustHost: true
   (beta.31 автодетектит VERCEL, но явное trustHost:true снимает риск host-mismatch на custom-домене/preview).
   AUTH_SECRET/AUTH_URL — через env Vercel (см. §4), в код не хардкодить.
4) .env.example — дополнить комментарием, что DIRECT_URL обязателен и для миграций (не только опционален).

ОГРАНИЧЕНИЯ: без изменения schema.prisma; рантаймовый DATABASE_URL (pooled) не трогать; секреты только в env.
ПРОВЕРКА (показать): npx prisma generate ок; npm run build локально проходит (миграции применятся к dev-ветке —
ОК, идемпотентно); npm run dev логинится. В конце предложи git-коммит одной строкой.
```

## Фаза 1b — Cleanup-миграция (РЕШЕНО: делаем до прода) [CC]

Снос мёртвых колонок-снимков `ShipmentItem.accepted_weight_kg` / `AcceptanceAct.brak_weight_kg`, чтобы первая
прод-схема была чистой. Спека — **`PROMPTS-CLEANUP-DEPRECATED-COLUMNS.md`**. Обе колонки nullable и нигде не
пишутся (проверено грепом) → drop безопасен. Порядок с Фазой 1 не важен, но обе — **до** Фазы 5 (первый
прод-деплой), иначе колонки уедут в прод и снос станет деструктивным прод-релизом с бэкапом.

---

## Фаза 2 — Neon: прод + dev ветки [Ivan]

1. Открыть проект VSMS в Neon-консоли. Текущая **default-ветку** назначить **проду** (или создать `production`).
2. От неё создать дочернюю ветку **`dev`** (кнопка Branches → New branch). Дочерняя копирует схему; данные в ней —
   одноразовые (как раньше).
3. Для КАЖДОЙ ветки скопировать **две строки**: pooled (`...-pooler...`, → `DATABASE_URL`) и direct
   (без `-pooler`, → `DIRECT_URL`). Итого 4 строки: прод×2, dev×2.
4. Проверить **retention/PITR** текущего плана Neon (см. §8) — до приёма реальных данных.

---

## Фаза 3 — GitHub: ветка dev [CC/Ivan]

1. `git checkout -b dev && git push -u origin dev`.
2. В настройках репо (или позже в Vercel) `main` = защищённая релизная ветка.
3. Локальный `.env` перевести на **dev**-строки Neon (разработка идёт против dev-ветки, не прода).

---

## Фаза 4 — Vercel: проект и переменные [Ivan]

1. Vercel → Add New Project → импорт `github.com/nummyn0rih/vsms`. Framework — Next.js (автоопределит).
2. Settings → Git: **Production Branch = `main`**. Остальные ветки (`dev`, фичи) → **Preview** автоматически.
3. Settings → Environment Variables — задать по областям:

   | Переменная | Production (Neon прод) | Preview (Neon dev) |
   |---|---|---|
   | `DATABASE_URL` | прод pooled | dev pooled |
   | `DIRECT_URL` | прод direct | dev direct |
   | `AUTH_SECRET` | **свежий** (`openssl rand -base64 32`) | свой (можно другой) |
   | `AUTH_URL` | `https://<прод-домен>` | оставить пустым (авто по preview-URL) |
   | `SEED_ADMIN_LOGIN` | твой admin-логин | — (сид только прод) |
   | `SEED_ADMIN_PASSWORD` | **сильный** пароль | — |

   ⚠ Прод `AUTH_SECRET` — НЕ dev-шный. Прод-пароль admin — не как в dev.

---

## Фаза 5 — Первый прод-деплой + сид admin

1. **[Ivan]** Merge `dev` → `main` (или первый деплой из `main`). Vercel build прогонит
   `prisma generate && prisma migrate deploy && next build` → миграции создадут прод-схему на чистой Neon-ветке.
2. **[CC/Ivan]** Сид первого admin в прод — один раз, локально против прод-БД:

   ```bash
   DATABASE_URL='<прод-pooled>' SEED_ADMIN_LOGIN='<логин>' SEED_ADMIN_PASSWORD='<пароль>' npm run db:seed
   ```

   ⚠ **Именно `DATABASE_URL`, не `DIRECT_URL`:** `prisma/seed.ts` создаёт клиент из `process.env.DATABASE_URL`
   (строка 23) — `DIRECT_URL` он не читает, и с ним сид молча ушёл бы в БД из локального `.env` (dev), а прод-логин
   не заработал бы. Инлайн-префикс перебивает `.env`, т.к. `dotenv/config` не переопределяет уже заданные env.
   Прямой коннект здесь не нужен: сид — это DML (`upsert`), pooler его тянет.

   **Перед сидом убедиться, что бьём в прод** (иначе admin уедет в dev):
   ```bash
   DATABASE_URL='<прод-pooled>' npx tsx -e "import {PrismaPg} from '@prisma/adapter-pg';import {PrismaClient} from './lib/generated/prisma/client';const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});p.user.count().then(n=>console.log('users в этой БД:',n)).finally(()=>p.\$disconnect())"
   ```
   На чистой прод-БД ожидаем `0`. Если больше — это НЕ та база, остановиться.

   После сида: проверить, что создан ровно 1 пользователь `role=admin` (сид идемпотентен — повторный запуск
   не плодит дублей, а сбрасывает пароль/роль).
3. **[Ivan]** Открыть прод-URL, залогиниться admin-логином/паролем.

---

## Фаза 6 — Смоук-проверка прода [Ivan]

- [ ] Логин/логаут работает; неавторизованный редиректится на `/login`.
- [ ] Справочники: создать 1 фермера, 1 культуру, 1 тип тары, 1 ТК, 1 водителя — сохраняются.
- [ ] Норма тары фермер×культура задаётся; отгрузка `planned` создаётся, `sent` двигает тару (StockMovement).
- [ ] Приёмка: перевеска → акт → принято; баланс/стоимость считаются.
- [ ] RBAC: (позже, при вводе operator) не-admin не видит admin-действий.
- [ ] Экспорт Excel / печать открываются.

---

## Фаза 7 — Git-flow дальше (рабочий цикл)

1. Фича: ветка от `dev` (`feat/<name>`) → PR в `dev` → Vercel Preview-деплой на dev Neon-ветке → ревью.
2. Схема: локально `npm run db:migrate` (migrate dev, dev Neon-ветка) → коммит миграции.
3. Стабильно → merge `dev` → `main` = **релиз** (авто-деплой + `migrate deploy` на прод-БД).
4. PM-контур (`_PM-WORKFLOW.md`) без изменений: спека → Claude Code → invariant-review → коммит → обновление памяти.

---

## Фаза 8 — Бэкапы [Ivan]

- **Neon PITR** — проверить глубину retention на текущем плане (free — короткая история; платный — длиннее).
  Для рабочей заводской базы этого может быть мало.
- **Рекомендую:** периодический `pg_dump` прод-БД (напр. еженедельно) в отдельное хранилище. Могу поставить
  scheduled-задачу VSMS, которая делает дамп и кладёт файл (скажи — оформлю).
- Первый ручной `pg_dump` сделать сразу после ввода стартовых справочников (точка отката).

---

## Фаза 9 — Обновления памяти/правил [CC/PM]

- **CLAUDE.md §«Данные в dev/staging»** — переписать (сделано этим шагом, см. коммит): dev-ветка одноразовая
  (миграции могут вайпать), **прод — ценные данные, миграции обязаны быть data-preserving**, деструктив — только
  осознанно и с бэкапом. Убрать «перед продом БД стирается».
- **CONTEXT-HANDOFF.md** — ENVIRONMENT-блок (WSL→Mac) снести, если Mac зелёный; добавить блок PROD (URL, ветки
  Neon, где env). NEXT TASK → после стабилизации прода вернуться к фич-бэклогу (календарь и пр.).
- **TASKS.md** — прод-выкат отметить по факту закрытия фаз.

---

## Риски / на что смотреть

- **Прод-миграции необратимы по данным.** `migrate deploy` применяет всё незавершённое; деструктивную миграцию
  (drop/rename колонки) на прод — только с бэкапом и ревью. Правило dev-вайпа к проду НЕ применять.
- **Сид смотрит на `DATABASE_URL`.** `prisma/seed.ts` игнорирует `DIRECT_URL` и `prisma.config.ts`. Запуск сида
  без инлайн-`DATABASE_URL` уйдёт в БД из локального `.env` (dev) молча, без ошибки. Всегда задавать инлайн и
  сверять `user.count()` до запуска (Фаза 5 п.2).
- **Pooled vs direct.** Рантайм — pooled (`DATABASE_URL`), миграции — direct (`DIRECT_URL`). Перепутать = либо
  DDL-локи ломаются, либо рантайм упирается в лимит соединений. Обе строки нужны в каждой Vercel-области.
- **AUTH_SECRET прод.** Смена секрета инвалидирует сессии — задать один раз, не менять без нужды.
- **Preview делит dev Neon-ветку.** Несколько параллельных фич-preview с разными миграциями → конфликт на dev-БД.
  Solo: держать одну активную линию dev; при нужде — отдельная Neon-ветка на фичу.
- **Секреты.** Прод-строки/пароли — только в env Vercel, никогда в git. `.env` gitignored (проверено).
