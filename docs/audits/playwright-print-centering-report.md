# Отчёт: фикс центрирования print-листа + проверка через Playwright

Дата: 2026-07-18. Задача: печатный превью-лист (`/print/*`, новая вкладка) на экране
съезжает вправо/вниз, верх landscape-листов обрезается, кнопка «Печать» уезжает вбок.
Продолжение [playwright-verify-report.md](./playwright-verify-report.md).

Две итерации: (1) горизонталь — harness; (2) вертикаль — реальный рендер через мок-роут.

---

## Итог (TL;DR)

**Два независимых бага, два корня:**

- **Горизонталь** (итерация 1). Корень: `.print-wrap { align-items: center }`
  (flex-column). Лист шире вьюпорта (landscape 297мм; усилено `min-width:auto`
  флекс-ребёнка + `white-space:nowrap`) → центрирование уводит **левый край в
  отрицательный X**, недостижимый скроллом («прижат вправо», «кнопка в стороне»).
  `max-width:100%` не спасает (`min-width:auto`). **Фикс:** `align-items:center→stretch`
  + `margin-inline:auto` на `.sheet`/`.print-toolbar` (безопасно вырождается в 0).
  Проверено HTML-харнессом с реальным `print.css`. ✅ подтверждено пользователем.

- **Вертикаль** (итерация 2). Корень: **коллизия имени класса** — в `globals.css`
  есть `.sheet` (мобильный bottom-sheet/дровер): `position:fixed; inset; bottom:0;
  max-height:82vh; z-index:41`. Печатный лист тоже `.sheet` → незаявленные в `print.css`
  свойства **протекали** в лист: `position:fixed`+`bottom:0`+`max-height:82vh` →
  лист прижат вниз, верх обрезан, **скролла нет**. **Фикс:** `.print-wrap .sheet`
  (специфичность 0,2,0 > 0,1,0) сбрасывает `position:static; inset:auto; max-height:none;
  z-index:auto; border-radius:0` → лист в нормальный поток. ✅ проверено в реальном
  рендере (мок-роут).

**Ключевой урок:** harness с копией CSS НЕ ловит межфайловые коллизии классов —
`globals.css .sheet` в харнессе отсутствовал, потому вертикаль не воспроизводилась.
Для таких багов нужен реальный рендер (все стили страницы вместе).

---

## Замеры (харнесс, landscape-лист, до/после)

`sheet.x` — левый край листа; отрицательный = ушёл за левый край (недостижим).

| Вьюпорт | до: sheet.x | до: overflowX | после: sheet.x | после |
|---------|-------------|---------------|----------------|-------|
| 1440×900 | 102 (центр) | нет | 102 (центр) | центр, ок |
| 1280×720 | 22 (центр) | нет | 22 (центр) | центр, ок |
| 1122×800 | **−41** | да | **+16** | лист у левого края, скролл вправо |
| 1000×800 | **−41** | да | **+16** | ок |
| 900×700 | **−41** | да | **+16** | ок |

До: левый край −41 (клип, недостижим). После: +16 (padding контейнера), весь лист
доступен скроллом. На широких вьюпортах центрирование сохранилось. Скриншоты
`h-before-1000.png` / `h-after-1000.png` подтверждают визуально.

---

## Хронология: действия → ошибка → фикс

### 1. Сервер и БД
- `pkill -f 'next dev'`, перезапуск dev. **Грабли:** первый старт поймал холодный
  Neon → prisma-синглтон отдавал `ETIMEDOUT` на КАЖДЫЙ запрос. Перезапуск не помог —
  Neon реально отвечает через раз (см. п.4).

### 2. MCP Playwright — снова браузер
- MCP переподключился с прошлой правкой `--browser chromium` → теперь требует
  **chrome-for-testing v1232**: `Browser "chrome-for-testing" is not installed`.
- `npx @playwright/mcp install-browser chrome-for-testing` → `EAI_AGAIN cdn.playwright.dev`
  (нет DNS/egress до CDN Playwright). Скачать нельзя.
- В кэше есть `~/.cache/ms-playwright/chromium-1228` (совместим с проектным
  `playwright@1.61`). **Фикс конфига:** в `~/.claude.json` MCP `playwright` args →
  `--executable-path .../chromium-1228/chrome-linux64/chrome` (обходит cft-загрузку).
  Вступит в силу **со следующей сессии** (MCP не reload на лету).

### 3. Фолбэк этой сессии — проектный `playwright`
- Юзер поставил dev-dep `playwright@^1.61.1` + браузер. Гоню Node-скрипты через него.
  **Грабли:** ESM ищет `node_modules` от папки ФАЙЛА, не от cwd → скрипт из scratchpad
  не видел `playwright`. Решение: класть скрипт в корень проекта (`scratch-*.mjs`,
  удаляются после).

### 4. Логин не проходит — диагностика БД
- Через playwright сабмит формы → остаёмся на `/login`.
- `dev.log`: `CallbackRouteError ← PrismaClientKnownRequestError … code: 'ETIMEDOUT'`
  на `user.findUnique` / `packagingType.findMany` (adapter-pg, pooled).
- **Но** прямой `pg`-коннект тем же `DATABASE_URL` (ipv4first, timeout 15s) иногда даёт
  `POOLED OK, users: 3`, иногда `ETIMEDOUT`. Neon compute засыпает; pooler-endpoint
  отвечает нестабильно из этого окружения. `npm run db:seed` один раз прошёл
  (`admin готов id=1`), позже `warm` снова `ETIMEDOUT`.
- **Вывод:** средовой блокер (интермиттентный egress к Neon), не дефект правки.
  Стабильный скрин реальной `/print/*` недостижим.

### 5. Детерминированная проверка — HTML-харнесс
- `harness.html`: `<link>` на РЕАЛЬНЫЙ `app/print/print.css` + токены globals +
  html/body как в `app/layout.tsx` (`h-full` / `min-h-full flex flex-col`) +
  разметка `PrintSheet` (landscape, 28 строк). Без БД/auth.
- Playwright-скрипт мерил геометрию `.sheet/.print-toolbar/.print-wrap` на 5 ширинах,
  скриншотил. Баг воспроизведён (sheet.x=−41), после правки — устранён (см. таблицу).

### 6. Правка и проверки
- `app/print/print.css` (screen-часть): `align-items:center→stretch` на `.print-wrap`;
  `margin-inline:auto` на `.print-toolbar` и `.sheet`. `@media print` не тронут.
- `tsc` — чисто; `lint` — 0 errors (5 pre-existing warnings в `scripts/`).
  Scratch-скрипты удалены.

---

## Итерация 2: вертикаль (нет скролла, верх обрезан)

Пользователь подтвердил горизонталь, но вертикаль осталась. Харнесс её НЕ
воспроизводил (в нём не было `globals.css`). Нужен реальный рендер.

### Действия
1. **Ретрай Neon** (как просил пользователь) → `EAI_AGAIN` (VPN/DNS лёг, БД совсем
   недоступна). Логин через приложение невозможен.
2. **Мок вместо БД.** Временный роут `app/print-mock/{layout,page}.tsx` — рендерит
   РЕАЛЬНЫЙ `PrintSheet` + `print.css` с фейковыми данными, без БД. `?rows=N`, `?o=portrait`.
   - Грабли: `/print-mock` попал под `proxy.ts` (Next 16 middleware, matcher защищает
     всё) → 307 на `/login`. Временно добавил `print-mock` в исключения matcher
     (откатил `git checkout proxy.ts` после проверки).
3. **Инспекция реального DOM** (playwright, проектный `playwright`): прошёл цепочку
   предков `.sheet → html`, снял computed-стили + метрики скролла.

### Что показал реальный DOM (до фикса)
```
canScrollV=false   docScrollH=700=docClientH   (страница НЕ скроллится)
.sheet.landscape:  minHeight=793px  maxHeight=574px(!)  boxTop=-94  (верх обрезан)
```
`max-height:574px = 82vh` — чужое свойство. Источник: **`globals.css` `.sheet`**
(мобильный дровер, `position:fixed; bottom:0; max-height:82vh; z-index:41`). Один и тот
же класс `.sheet` у дровера и у печатного листа → протечка. `print.css .sheet` не
объявляет `position/max-height/inset/z-index` → эти свойства берутся из `globals`.

### После фикса (`.print-wrap .sheet` reset)
```
canScrollV=true    docScrollH=1214    sheetTop=96    sheetTopClipped=false
WIDE 1600: sheet.x=239 == right=239   (горизонталь цела)
@media print: position=static  max-height=none  margin=0  width=1122px  box-shadow=none
```
Печать НЕ регрессировала (наоборот — та же протечка гасится и в печати).
Скриншот `insp-fixed-short-1280x700.png` — лист по центру, верх виден, скролл есть.

---

## Почему именно `margin-inline:auto`, а не «доп. центрирование»

`align-items:center` (и `justify-content:center`) на скролл-контейнере **клипят
переполнение со стартовой стороны** — оверфлоу-часть уходит в отрицательную координату
и недостижима. `margin-inline:auto` на ребёнке центрирует при наличии свободного места
и схлопывается в 0 при его нехватке → элемент прижат к старту, переполнение уходит в
конец (скроллится). Альтернатива `align-items: safe center` короче, но хуже
поддержана кросс-браузерно; авто-маргины — универсальны.

---

## Рекомендации для скилла «visual-verify (Playwright)»

1. **MCP-браузер (WSL, оффлайн CDN):** не полагаться на `--browser chromium` (тянет
   chrome-for-testing с `cdn.playwright.dev`; в закрытом окружении — `EAI_AGAIN`).
   Конфиг MCP → `--executable-path` на уже скачанный `~/.cache/ms-playwright/chromium-*`.
   Правка `~/.claude.json` применяется со следующей сессии.
2. **Фолбэк без MCP:** проектный `playwright`/`playwright-core`; Node-скрипт держать
   в КОРНЕ проекта (ESM-резолюция node_modules идёт от файла).
3. **Префлайт БД:** проба TCP + короткий `SELECT 1` до логина. Neon в WSL — типовой
   интермиттентный `ETIMEDOUT` (cold-start pooler, IPv6-only DNS). Ловить как средовой
   блокер; не гонять seed/логин по кругу.
4. **CSS/layout-баги — проверять харнессом, а не полным приложением:** изолированный
   HTML с `<link>` на РЕАЛЬНЫЙ проектный CSS + верные html/body-обёртки из root-layout.
   Детерминированно, без БД/auth, правка CSS отражается сразу. Мерить `getBoundingClientRect`
   (x/right/ширины, `scrollWidth>innerWidth`) — числа доказательнее скриншота.
5. **Флекс-центрирование + возможный оверфлоу:** `align-items/justify-content: center`
   на скролл-контейнере опасно (клип старта). Центрировать `margin:auto` на детях.
6. Харнесс-фиделити: не забывать про `box-sizing:border-box` (Tailwind preflight) и
   классы html/body — иначе абсолютные числа поедут (направление бага сохраняется).
7. **Харнесс НЕ ловит межфайловые коллизии классов.** Копия одного CSS в харнессе
   пропустила `globals.css .sheet`, протекавший в печатный лист. Для «стилей, которые
   ведут себя странно только в приложении» — проверять в РЕАЛЬНОМ рендере (все CSS
   страницы вместе), не в изоляции.
8. **Мок-роут вместо БД** (когда данные недоступны, а нужен реальный рендер): временный
   `app/<name>/{layout,page}.tsx` с фейковыми пропсами реального компонента; для обхода
   auth — временно исключить путь в `proxy.ts` matcher. Обязательно откатить
   (`git checkout proxy.ts`, `rm -rf app/<name>`) после проверки.
9. **Коллизии имён классов** — при отладке «протекающих» стилей смотреть `getComputedStyle`
   на реальном элементе и `grep` класса по ВСЕМ CSS (`globals.css` + модульные). Чужое
   значение (напр. `max-height:82vh` на A4-листе) = сигнал коллизии. Чинить повышенной
   специфичностью (`.parent .cls`) или переименованием класса.
