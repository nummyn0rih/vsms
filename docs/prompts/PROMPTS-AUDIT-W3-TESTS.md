# PROMPTS — audit-w3: тестовая сетка под инварианты ядра (П-21)

> Волна 3 плана `AUDIT-REMEDIATION-PLAN.md`. Главный системный долг по аудиту: **ноль автотестов при леджере,
> корректность которого держится на инвариантах, ломающихся молча**. Закрываем юнит-тестами чистого ядра + CI.
> **Миграции НЕТ. Прикладной код НЕ переписываем** — только добавляем тесты и инфраструктуру.
>
> Почему сейчас: волна 4 (индексы, `@unique`, SQL-агрегация балансов) и волна 5 (нетто-гард, гонка `accepted`,
> вынос tx-хелперов) — это правки логики и схемы **на живом проде с реальными данными**. Без сетки под ногами
> их делать нельзя.

## Что уже есть (переиспользовать, не изобретать)

- 11 verify-скриптов в `scripts/` — интеграционные проверки против dev-БД. **Не трогать и не
  конвертировать в этой волне** (эволюция в интеграционные тесты — долгосрочный пункт роадмапа).
  ⚠ Глоб `scripts/*-verify.ts` ловит только 8 из них; ещё три названы иначе (`d3b-verify-material.ts`,
  `e1-verify-material.ts`, `e4-verify-ingredient.ts`).
- `scripts/_stubs/{auth,next-cache}.ts` — подмена `@/auth` и `next/cache`. Тот же приём применим в vitest
  через алиасы конфига. **По факту не понадобилось:** ни один покрытый тестами модуль не импортирует
  `@/auth`, `next/cache` или `@/lib/prisma`. Стабы остались только у verify-скриптов.

## Проверено: что реально чисто и тестируется без БД

| Модуль | Ключевые функции |
|---|---|
| `server/shipments/workdays.ts` (13 экспортов) | `isFactoryWorkday`, `parseDateUTC`, `isoWeek`, `isoWeekRange`, `seasonWeekBounds`, `compareIsoWeek`, `currentSeasonWeek`, `withinSummerRange`, `formatWeekParam`, `seasonYearOf` |
| `server/acceptance/accepted.ts` (8) | `computeAcceptedKg`, `computeWeightedBrak`, **`computeSettlement` (BR-33)**, `calibreRangeLabel`, `arrivalDateDefault` |
| `server/acceptance/board-filter.ts` | `filterBoard`, `boardOptions`, `anyAcceptanceFilterActive` |
| `server/acceptance/ingredients.ts` | `calcIngredientConsumption` |
| `server/shipments/feed.ts` | `filterFeedWeeks`, `weekSummary`, `daySummary` |
| `server/shipments/format.ts` | `pluralRu`, `formatTareTotals` |
| `lib/validators.ts` · `lib/nav.ts` · `lib/culture-palette.ts` | `normalizePhone`/`formatPhone`, `navForRole`/`isHrefAllowedForRole`, палитра |

⚠ **ИСПРАВЛЕНО по факту кода (было: «`packaging.ts` — `"use server"`-модуль, нужен стаб `@/lib/prisma`»).**
`server/shipments/packaging.ts` директивы `"use server"` НЕ содержит — в его шапке прямо написано «Чистый
модуль БЕЗ "use server"», и `@/lib/prisma` он не импортирует (только `Prisma` из `lib/generated/prisma/client`
ради `Decimal`, плюс tx-хелперы, принимающие транзакцию параметром). Поэтому **стаб `scripts/_stubs/prisma.ts`
не заводился** — он был бы мёртвым кодом. `calcPackagingUnits` импортируется в тест напрямую.
Сгенерированный Prisma-клиент под vite-трансформом работает без `server.deps.inline`.

---

## ПРОМПТ — audit-w3 (Claude Code)

```text
Задача audit-w3 (VSMS): поднять vitest, покрыть юнит-тестами чистое ядро расчётов и завести CI на GitHub Actions.
Миграция: НЕТ. Прикладной код НЕ менять — тесты не должны «подгонять» реализацию под себя.
Если тест выявит РЕАЛЬНЫЙ баг — НЕ чинить молча: показать, описать, дождаться решения (может быть доменным).

Перед кодом прочитать: docs/DOMAIN.md §1 (ЧЕТЫРЕ базы веса), §4 (BR, особенно BR-5/10/11/17/18/33), §5;
server/shipments/workdays.ts, server/acceptance/accepted.ts, server/acceptance/board-filter.ts,
server/acceptance/ingredients.ts, server/shipments/feed.ts, scripts/_stubs/ (приём подмены модулей),
docs/prompts/PROMPTS-SETTLEMENT-ADJUSTMENT.md (эталонный пример BR-33 с числами).
Vitest + Next 16 — сверить по context7.

1) Поставить vitest (dev-зависимость) + конфиг vitest.config.ts:
   - окружение node; include: ["**/*.test.ts"]; exclude node_modules/.next/lib/generated.
   - алиас "@" → корень проекта (как в tsconfig paths).
   - алиас-стаб для "@/lib/prisma" (простой объект-заглушка) — нужен, чтобы импортировать чистые функции из
     "use server"-модулей (calcPackagingUnits) без реальной БД. Стаб положить в scripts/_stubs/prisma.ts,
     рядом с существующими, с комментарием-предупреждением: только для тестов, в приложение не подключать.
   - скрипты в package.json: "test": "vitest run", "test:watch": "vitest".
   - В тестах импортировать describe/it/expect ЯВНО из "vitest" (без globals) — чтобы next build не требовал
     дополнительных типов.
2) Тесты (co-located: <модуль>.test.ts рядом с исходником). Ориентир 30–40 кейсов, приоритет — ИНВАРИАНТЫ, а не % покрытия:

   server/shipments/workdays.test.ts
   - isFactoryWorkday: лето/зима по наборам дней SeasonConfig (BR-18), граница сезона, воскресенье.
   - parseDateUTC + isoWeek: дата не «уезжает» на день (UTC-дисциплина), ISO-неделя на стыке года (31.12/01.01).
   - seasonWeekBounds/compareIsoWeek: первая/последняя неделя сезона, сравнение недель разных лет.
   - withinSummerRange: границы включительно; зафиксировать поведение на 01.06 и 30.09.

   server/acceptance/accepted.test.ts
   - computeAcceptedKg: simple = actual×(1−brak%); calibre = actual×Σ(принятых %); брак НЕ вычитается дважды
     (он одна из долей 100%); actual = null → null; пустой набор категорий → ветка simple.
   - computeWeightedBrak: взвешивание по ФАКТУ (не среднее арифметическое!); пустой набор → 0; Σactual=0 → 0.
   - computeSettlement (BR-33) — ЭТАЛОН из PROMPTS-SETTLEMENT-ADJUSTMENT.md, числом в число:
     actual 6850, категории 53,7/34,5 принятые + 10,4 нестандарт + 1,4 брак, settlement 97%
     → принятый 6041,7 · доплата 602,8 · оплачиваемый 6644,5 · разнос 367,0 и 235,8 по двум строкам.
     Плюс: settlementPercent = null → paid == accepted и surcharge == 0; Σ(принятых %) = 0 → surcharge 0 без падения.

   server/acceptance/ingredients.test.ts
   - calcIngredientConsumption: микродозы (аскорбинка ~0,00005 на кг) не схлопываются в 0 — точность Decimal(15,6).

   server/acceptance/board-filter.test.ts
   - filterBoard: И между осями (фермер И культура И поиск); машина видна, если ПОДХОДЯЩАЯ позиция есть хотя бы одна;
     поиск по коду машины и по водителю; счётчики зон из видимого набора; пустые фильтры → board возвращается как есть.
   - boardOptions: уникальность фермеров/культур, счётчики машин, сортировка по-русски.

   server/shipments/feed.test.ts
   - filterFeedWeeks: те же оси + статус + hidePlanned; недели без совпадений отсеиваются.
   - weekSummary/daySummary: суммы тоннажа и тары, пустой день.

   server/shipments/packaging.test.ts
   - calcPackagingUnits: ceil по нетто-норме (не round!), навал → none, отсутствие нормы → ошибка.

   lib/validators.test.ts · lib/nav.test.ts
   - normalizePhone/formatPhone: формат «+7 XXX XXX-XX-XX», мусорные символы.
   - navForRole/isHrefAllowedForRole: admin видит всё; operator/user не видят admin-пункты; неизвестный href.

3) CI — .github/workflows/ci.yml, триггеры: push и pull_request в ветки dev и main.
   Шаги: checkout → setup-node (Node 22, cache npm) → npm ci → npx prisma generate → npm run lint →
   npx tsc --noEmit → npm run test.
   ⚠ НЕ запускать npm run build в CI: скрипт build содержит `prisma migrate deploy` и полез бы в реальную БД.
     Именно поэтому prisma generate вызывается отдельным шагом (без него tsc падает на импортах Prisma-типов).
   ⚠ Секретов и переменных окружения в CI не заводить — всё перечисленное работает без БД.

ОГРАНИЧЕНИЯ
- Не менять поведение прикладного кода ради зелёных тестов. Расхождение тест↔реализация = повод для разбора.
- Не трогать scripts/*-verify.ts и существующие стабы (кроме добавления prisma-стаба).
- Не добавлять e2e/Playwright, не поднимать БД в CI, не трогать схему.
- Тесты пишем на ФАКТИЧЕСКОЕ поведение по DOMAIN, не на догадки: если правило неоднозначно — спросить.

ПРОВЕРКА (показать)
- npm run test — все тесты зелёные, вывести список кейсов.
- Эталон BR-33 сходится числом в число (показать вывод именно этого теста).
- npx tsc --noEmit и npm run lint зелёные; npm run build локально не сломан.
- CI-файл провалидирован по синтаксису; описать, что запустится на PR в dev.
- Отдельно перечислить: какие тесты выявили расхождения с ожиданием (если есть) — НЕ чинить самовольно.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью audit-w3
1. `vitest` поднят; `test`/`test:watch` в package.json; конфиг с алиасами; prisma-стаб только в `scripts/_stubs`.
2. Покрыты все перечисленные модули; акцент на инвариантах (базы веса, UTC, нетто, ceil), а не на количестве.
3. **Эталон BR-33 сходится числом в число.**
4. Прикладной код не изменён (дифф = тесты + конфиг + CI + package.json).
5. CI: lint + tsc + test на PR/push в `dev` и `main`; `prisma generate` есть, `npm run build` — НЕТ.
6. Найденные расхождения вынесены отдельно, а не «подогнаны».

---

## После задачи — обновление памяти (зона PM)
- `CLAUDE.md` → конвенции: «юнит-тесты чистых функций — `*.test.ts` рядом с модулем, `npm run test`;
  CI гоняет lint+tsc+test на PR; `npm run build` в CI не запускать (в нём `migrate deploy`)».
- `AUDIT-REMEDIATION-PLAN.md`: волна 3 → закрыта; волна 4 разблокирована.
- `CONTEXT-HANDOFF.md`: в «Гарантированно работает» — появилась тестовая сетка; убрать формулировку
  «тест-фреймворка нет».
