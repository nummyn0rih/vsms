# Отчёт: браузерная проверка через Playwright (задача print-fix2)

Дата: 2026-07-18. Задача: проверить кнопку «Печать» на видах «Сводка»/«План»
(правка `components/shell/FeedToolbar.tsx` — вынос `printSlot` из блока фильтров).
Документ — основа для будущего скилла «visual-verify через Playwright».

---

## Итог (TL;DR)

- **Правка подтверждена** DB-free рендер-тестом реального `FeedToolbar`:
  при `showFilters=false` (Сводка/План) `printSlot` рендерится **1 раз** и стоит
  до `.seg`; при `showFilters=true` (Лента) — тоже ровно 1 раз (не задвоился).
- **Полная браузерная проверка реальных экранов НЕ выполнена** — средовой блокер:
  из этого окружения (WSL2) **нет egress к БД Neon** (`ETIMEDOUT` на :5432).
  Без БД нет логина → `/shipments`, `/planner`, `/print/*` не рендерятся с данными.
- MCP Playwright по ходу починен в конфиге (`--browser chromium`), но фикс
  вступит в силу **со следующей сессии** (перезапуск MCP-сервера).

---

## Окружение

- Next.js 16.2.7 (Turbopack), dev на `http://localhost:3000`.
- Auth.js v5 Credentials, JWT-сессия. Логин: server-action → `signIn` → `authorize`
  делает `user.findUnique` (БД). Любая ошибка `authorize` (вкл. таймаут БД)
  заворачивается в `AuthError` → UI показывает «Неверный логин или пароль».
- БД: Neon (pooled+direct). Seed-креды в `.env`: `SEED_ADMIN_LOGIN/PASSWORD`.

---

## Хронология: действия → ошибка → фикс

### 1. Запуск dev-сервера
- `npm run dev` в фоне. **Грабли:** `&` внутри фоновой Bash-обёртки → трекер увидел
  выход `echo` и отметил команду «completed», хотя сервер жив.
  **Урок:** для фонового dev проверяй порт (`ss -ltnp | grep :3000`) и лог, а не
  статус обёртки. Сервер поднялся: `✓ Ready in 409ms`.

### 2. MCP Playwright — браузер не найден
- `mcp__playwright__browser_navigate` → ошибка:
  `Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`.
- **Причина:** MCP запущен как `npx @playwright/mcp@latest` **без** `--browser` →
  дефолтный канал `chrome` (реальный Google Chrome), которого в системе нет.
- **Попытки установки — провал:**
  - `npx playwright install chrome` → требует `sudo` для системных зависимостей,
    пароля нет → `Failed to install chrome`.
  - `npx playwright install chromium` → npx без локального пакета печатает варнинг
    и не ставит.
- **Что сработало:** bundled chromium уже лежит в кэше —
  `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`.
- **Фикс конфига:** в `~/.claude.json` глобальному MCP `playwright` добавлены args
  `--browser chromium` (в проекте `wsm-app` уже так — проверенный шаблон).

### 3. MCP не перечитал конфиг → kill убил тулы
- После правки конфига `browser_navigate` дал ту же ошибку (процесс MCP держал
  старые args, hot-reload нет).
- Убил stale-процессы (`kill <pid> <pid>` по `npm exec @playwright/mcp`).
  **Грабли:** CC **не respawn-ит** MCP-сервер в той же сессии — все
  `mcp__playwright__*` тулы отвалились (`No such tool available`).
  **Урок:** не убивай MCP-процесс на живой сессии ради reload. Конфиг подхватится
  при следующем старте сессии; для «здесь и сейчас» нужен фолбэк без MCP.

### 4. Фолбэк — standalone `playwright-core` + bundled chromium
- В scratchpad: `npm init -y` + `npm i playwright-core` (проект не трогаем).
- Запуск браузера напрямую:
  ```js
  chromium.launch({ executablePath:
    process.env.HOME + "/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
    headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
  ```
- **Chromium стартовал без системных либ** (`--no-sandbox`). Скрин `/login` снят —
  реальный dev-app рендерится. Тулчейн доказан.

### 5. Логин не проходит → диагностика БД
- Сабмит формы → остаёмся на `/login`, текст «Неверный логин или пароль».
- Проверки:
  - `npm run db:seed` → `ETIMEDOUT` (Neon), повтор — тоже таймаут.
  - Прямой `pg`-коннект (pooled) → `ETIMEDOUT` и по IPv6, и с `--dns-result-order=ipv4first`.
  - DNS: хост Neon отдаёт **и** AAAA (IPv6), **и** A (IPv4 52.57.171.9 и др.).
  - TCP `:5432` к IPv4-адресам Neon → **FAIL/timeout**; IPv6 route в WSL — нет.
  - `dev.log`: `CallbackRouteError` ← `PrismaClientKnownRequestError` на
    `user.findUnique()` (таймаут БД).
- **Вывод:** egress на порт 5432 к Neon из этого WSL-окружения заблокирован
  (плюс IPv6-only route). Это **не** дефект правки и не отсутствие юзера —
  среда не пускает к БД. Дальше по данным пройти нельзя.

### 6. DB-free доказательство правки
- Реальный `FeedToolbar` отрендерен через `react-dom/server`
  (`renderToStaticMarkup`), компонент зависит только от React — без БД/auth.
- Ассерты:
  | Кейс | `showFilters` | вхождений `printSlot` | до `.seg` |
  |------|---------------|------------------------|-----------|
  | Сводка/План | `false` | **1** | да |
  | Лента | `true` | **1** | да |
  - До фикса при `false` было бы **0** (слот жил внутри `{showFilters && …}`).
- Throwaway-скрипт удалён после прогона.

---

## Что проверить, когда БД будет доступна (докрутить)

1. `/shipments` → вид «Сводка»: кнопка «Печать» видна, href `/print/summary?week=…`.
2. `/planner` → вид «План»: «Печать» видна, href `/print/plan?week=…`;
   вид «Доска» — кнопки нет.
3. `/shipments` → «Лента»: «Печать» одна, фильтры/поиск/тумблер на месте.
4. `/print/*`: лист по центру на сером фоне, вертикальный скролл; `Ctrl+P` → чистый
   A4 без хрома.

---

## Рекомендации для скилла «visual-verify (Playwright)»

1. **Префлайт-чек браузера ДО навигации:** есть ли `~/.cache/ms-playwright/chromium-*`;
   MCP-конфиг с `--browser chromium`. Нет — ставить/чинить заранее.
2. **Никогда не kill-ать MCP-процесс на живой сессии** — тулы отвалятся без respawn.
   Правку MCP-конфига применять перезапуском сессии; для текущей — сразу фолбэк.
3. **Фолбэк-паттерн (надёжный):** `playwright-core` в scratchpad + `executablePath`
   на bundled chromium, `--no-sandbox --disable-dev-shm-usage` (WSL/headless).
4. **Префлайт-чек БД:** `ss`/TCP-проба к хосту БД до попытки логина. Neon в WSL —
   типовой `ETIMEDOUT :5432` (IPv6-only DNS + блок egress). Ловить это как средовой
   блокер, а не гонять seed по кругу.
5. **Логин:** креды из `.env` (`SEED_ADMIN_*`); при пустой dev-БД — seed (БД
   одноразовая). Помни: server-action заворачивает и ошибки БД в «неверный
   логин» — не путай отсутствие юзера с недоступностью БД (смотри `dev.log`).
6. **DB-free уровень:** чистую UI-логику (рендер/условные ветки) доказывать
   `renderToStaticMarkup` реального компонента — быстро и без инфраструктуры.
7. Фоновый dev: проверять `:3000` через `ss`/лог, не по статусу Bash-обёртки.
