# VSMS

Внутренняя система управления поставками овощного сырья на консервный завод.
Заменяет ручные Excel/Google-таблицы: планирование недели, отгрузки от фермеров,
приёмка с расчётом брака, склад тары и ингредиентов, контракты и аналитика.

Рабочий инструмент, не учебный проект. Solo-разработка.

## Стек

| Слой | Технология |
| --- | --- |
| Фреймворк | Next.js 16 (App Router) + TypeScript |
| БД | PostgreSQL (Neon) + Prisma 7 |
| Аутентификация | Auth.js v5 (NextAuth, Credentials), роль в сессии |
| UI | Tailwind CSS 4 + shadcn/ui, Geist |
| Drag & drop | @dnd-kit (планировщик недели) |
| Графики | Recharts |
| Экспорт | SheetJS (xlsx) |

Бизнес-логика живёт в `server/` (по доменам: shipments, acceptance, inventory,
contracts, materials, plan, analytics), страницы — в `app/`, схема БД —
в `prisma/schema.prisma`.

## Документация

| Файл | О чём |
| --- | --- |
| [`docs/DOMAIN.md`](docs/DOMAIN.md) | **Источник истины**: модель данных и бизнес-правила (BR-1…BR-23) |
| [`docs/PRD.md`](docs/PRD.md) | Продуктовые требования: модули, роли, границы MVP, роадмап |
| [`docs/TASKS.md`](docs/TASKS.md) | Чеклист задач, текущий фокус — вверху файла |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Дизайн-токены: цвета, типографика, радиусы, тени |
| [`docs/DESIGN.md`](docs/DESIGN.md) | UX-решения по экранам |
| [`docs/prompts/PROD-DEPLOY.md`](docs/prompts/PROD-DEPLOY.md) | Прод-контур, деплой, работа с прод-БД |

Правила для AI-ассистента — в [`CLAUDE.md`](CLAUDE.md).

## Локальный запуск

```bash
npm ci
npx prisma generate
npm run dev            # http://localhost:3000
```

Перед первым запуском нужен `.env` с **двумя** строками подключения Neon —
это требование pooled-режима, а не дублирование:

| Переменная | Назначение |
| --- | --- |
| `DATABASE_URL` | pooled-коннект (PgBouncer) — рантайм приложения, `lib/prisma.ts` |
| `DIRECT_URL` | прямой коннект — Prisma CLI: `migrate`, `studio`, `db seed` (PgBouncer ломает DDL и advisory-lock миграций) |
| `AUTH_SECRET` | подпись сессий Auth.js (`npx auth secret`) |

Прямой URL задаётся в `prisma.config.ts` (`datasource.url = env("DIRECT_URL")`) —
в Prisma 7 ключа `directUrl` в `schema.prisma` больше нет.

Значения берутся в консоли Neon и в переменных окружения Vercel; в репозиторий
и в эту документацию они не попадают.

## Скрипты

```bash
npm run dev        # дев-сервер
npm run build      # prisma generate && prisma migrate deploy && next build
npm run lint       # eslint
npm run db:migrate # prisma migrate dev — создать и применить миграцию (только dev)
npm run db:studio  # prisma studio
npm run db:seed    # tsx prisma/seed.ts — справочники и тестовые данные
```

## Прод-контур

Хостинг — Vercel, БД — отдельная прод-ветка Neon.

- ветка `main` → прод; любая другая ветка → preview-деплой;
- миграции применяются на билде: `npm run build` вызывает `prisma migrate deploy`
  (не `migrate dev` — прод не генерирует миграции и не сбрасывает БД);
- **прод-данные реальные и ценные.** Прод-миграции обязаны быть data-preserving;
  деструктивные изменения — только осознанно, с `pg_dump` и ревью. Dev-ветка Neon
  одноразовая, там данные можно вайпать.

Подробности и чеклист деплоя — в [`docs/prompts/PROD-DEPLOY.md`](docs/prompts/PROD-DEPLOY.md).
