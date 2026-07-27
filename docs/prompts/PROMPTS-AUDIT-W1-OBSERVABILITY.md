# PROMPTS — audit-w1: наблюдаемость прода и гарды чтений

> Волна 1 плана `AUDIT-REMEDIATION-PLAN.md`. Закрывает П-12 (молчаливые catch), П-5 (незащищённые чтения),
> П-18 (мёртвый код), П-19 (README), П-7 (security-заголовки).
> **Миграции НЕТ. Схему, бизнес-логику и auth-стек не трогаем.** Прод живой и наполняется данными —
> волна выбрана именно потому, что безопасна: ни одного изменения в расчётах и переходах статусов.

## Уточнения к аудиту (проверено по коду перед спекой)

1. **`authFail` дублируется в 19 файлах** (`grep -rl "function authFail" server` → 19). Аудит этого не отметил,
   но это меняет реализацию П-12: не «добавить `console.error` в каждый catch», а **вынести один общий хелпер**
   и заменить им 19 копий. Иначе следующая правка обработки ошибок снова будет умножаться на 19.
2. **П-5 шире, чем 4 функции из аудита.** Проверено: `requireRole` отсутствует в читающих экспортах во ВСЕХ
   доменах (`listFarmers`, `listCultures`, `getContract`/`getContractView`, `listContracts`, `listDrivers`,
   `listShipmentOptions`, `getShipment`, `getTripWeightNorm`, `getOpeningBalances`, `listIngredients`,
   `listSeasons`, `listPackagingTypes`, `listTransportCompanies`/`…Options`, `listRecipesByCulture`,
   `listCultureOptions`, `listIngredientOptions`, `listContractOptions`, `getMaterialShipment`,
   `listMaterialOptions`, `loadBoardWeek`, `loadPlanWeek`, `getActContext`).
3. **Мутации гардированы корректно** — проверил `markArrived`, `revertAct`, `setOpeningBalance`: везде
   `requireRole` первой строкой. Аудит прав, тут работы нет.
4. **Отдельная находка (НЕ в эту волну):** из `"use server"`-файлов экспортируются внутренние хелперы,
   принимающие `tx` (`applyOutboundDeliveryLeg`, `applyArrivedLegForItem`, `revertDeliveryLeg`,
   `persistShipmentItems`, `persistContractLines`, `persistCalibreScheme`, `loadPackagingContext`…).
   Формально это HTTP-эндпойнты, практически не вызываемы (Prisma-транзакция не сериализуется с клиента).
   Правильное лечение — вынести их в не-`"use server"` модули, но это правка импортов → **волна 5**, не здесь.

## Решения (зафиксированы)

| Развилка | Выбор |
|---|---|
| Уровень гарда на чтениях | **`await requireRole()` без ролей** — только факт аутентификации. Не ужесточать роли: цель волны — defense-in-depth, а не смена прав; ужесточение может тихо сломать рабочий UX. |
| Логирование | `console.error` (Vercel собирает логи stdout/stderr). Sentry — среднесрочно, не сейчас. |
| Общий хелпер | Новый модуль `server/action-result.ts`: `ActionResult`, `authFail`, `failWithLog`. 19 локальных копий `authFail` удаляются. |
| CSP | **Не включать полноценный CSP в этой волне.** Next инлайнит скрипты гидратации; наивный CSP кладёт прод. Ставим безопасный набор заголовков без CSP; CSP — отдельно и в Report-Only. |

---

## ПРОМПТ — audit-w1 (Claude Code)

```text
Задача audit-w1 (VSMS): наблюдаемость прод-ошибок + гарды на читающих server actions + чистка мёртвого кода +
README + security-заголовки. Миграция: НЕТ. Бизнес-логику, расчёты, переходы статусов, схему — НЕ ТРОГАТЬ.
Прод живой: любая правка должна быть поведенчески нейтральной, кроме добавления логов и проверки аутентификации.

Перед кодом прочитать:
- server/auth/session.ts — requireRole/AuthError (гард бросает AuthError, не возвращает результат).
- server/shipments/actions.ts (строки ~30–60) — эталон текущего authFail + формат ActionResult.
- server/farmers/actions.ts — эталонный CRUD-модуль (по нему сверять единообразие).
- CLAUDE.md — правила 5 (RBAC сервер+клиент) и 6 (logChange в транзакции).
Next 16 (headers в next.config) — сверить по context7.

1) НОВЫЙ модуль server/action-result.ts — единая точка результата и ошибок:
   - export type ActionResult (взять текущее определение, ничего не менять в форме);
   - export function authFail(e: unknown): { ok:false; error:string } | null — перенести существующую логику
     (AuthError → UNAUTHENTICATED/FORBIDDEN → человеческие сообщения) ВЕРБАТИМ, поведение не менять;
   - export function failWithLog(e: unknown, msg: string): { ok:false; error:string } —
     сначала const auth = authFail(e); if (auth) return auth;  (отказ доступа — НЕ ошибка, не шуметь в логах)
     иначе console.error("[VSMS]", msg, e) и вернуть { ok:false, error: msg }.
2) Заменить 19 локальных копий authFail на импорт из server/action-result.ts
   (файлы: grep -rl "function authFail" server). Локальные определения удалить.
3) Во ВСЕХ catch-блоках server actions заменить конструкцию
   `catch (e) { return authFail(e) ?? { ok:false, error:"<сообщение>" } }`
   на `catch (e) { return failWithLog(e, "<то же сообщение>") }`.
   ⚠ Тексты сообщений пользователю НЕ менять — это видимый UX.
4) Добавить `await requireRole();` (БЕЗ аргументов — только аутентификация) первой строкой в читающие
   экспортируемые функции "use server"-файлов, где гарда нет:
   farmers: listFarmers · cultures: listCultures, listPackagingOptions · contracts: listContracts, getContract,
   getContractView, listContractOptions · shipments: getShipment, getTripWeightNorm, listShipmentOptions ·
   drivers: listDrivers · packaging-types: listPackagingTypes · transport-companies: listTransportCompanies,
   listTransportCompanyOptions · ingredients: listIngredients · seasons: listSeasons ·
   recipes: listCultureOptions, listIngredientOptions, listRecipesByCulture · materials: getMaterialShipment,
   listMaterialOptions · inventory/opening: getOpeningBalances · board: loadBoardWeek · plan: loadPlanWeek ·
   acceptance/act: getActContext.
   - Роли НЕ ужесточать: именно requireRole() без ролей.
   - Внутренние хелперы, принимающие tx (applyOutboundDeliveryLeg, persistShipmentItems, loadPackagingContext,
     revertDeliveryLeg, persistContractLines, persistCalibreScheme и подобные) — НЕ ТРОГАТЬ: они вызываются
     внутри уже гардированных транзакций, гард там сломает вложенные вызовы.
   - Если функция уже содержит requireRole — не дублировать.
5) Удалить мёртвый server/shipments/actions.ts: getShipments (не используется в app/ — проверить грепом перед
   удалением; лента ходит через feed-loader). Вместе с ним — тип ShipmentListRow, если он больше не нужен.
6) README.md — заменить boilerplate create-next-app на:
   назначение VSMS (внутренняя система поставок овощного сырья), стек, ссылки на docs/ (DOMAIN, PRD, TASKS,
   DESIGN-SYSTEM, PROD-DEPLOY), локальный setup (npm ci → prisma generate → две строки Neon в .env → npm run dev),
   прод-контур (Vercel: main=прод, прочие ветки=preview; миграции migrate deploy на билде), команда сида.
   Секретов и URL-строк в README НЕ писать.
7) next.config.ts — заголовки безопасности через async headers() на все маршруты ("/:path*"):
   Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
   X-Frame-Options: DENY
   X-Content-Type-Options: nosniff
   Referrer-Policy: strict-origin-when-cross-origin
   Permissions-Policy: camera=(), microphone=(), geolocation=()
   ⚠ Content-Security-Policy НЕ добавлять в этой задаче (сломает инлайн-скрипты гидратации Next).

ОГРАНИЧЕНИЯ
- Ни одного изменения в расчётах, переходах статусов, движениях склада, схеме Prisma, auth.config/auth.ts.
- Тексты пользовательских ошибок сохранить дословно.
- Не ужесточать роли на чтениях; не добавлять гард внутрь tx-хелперов.
- Не вводить Sentry/логгеры-библиотеки — только console.error.
- Доки (кроме README) — зона PM.

БД ТЕСТОВАЯ (проект vsms-dev): проверки на dev-данных.

ПРОВЕРКА (показать)
- grep: "function authFail" встречается ровно 1 раз (в server/action-result.ts); getShipments отсутствует.
- Смоук на dev: логин → справочники (список + создание фермера) → создание отгрузки → sent → приёмка (акт) →
  откат. Поведение и тексты ошибок как раньше.
- Логирование: искусственно вызвать ошибку (например, временно бросить в одной action) → в консоли сервера
  видно "[VSMS] <сообщение> <stack>"; пользователю показывается прежний текст. Временную правку откатить.
- Гард чтений: разлогиненный вызов читающей action отклоняется (проверить, что UI под логином работает штатно).
- Заголовки: curl -I на локальный build → присутствуют 5 заголовков, CSP отсутствует.
- lint/tsc/build зелёные.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью audit-w1
1. `server/action-result.ts` — единственное определение `authFail`; 19 копий удалены; форма `ActionResult` не изменилась.
2. Все `catch` в server actions идут через `failWithLog`; тексты пользователю дословно прежние; отказ доступа не логируется как ошибка.
3. `requireRole()` (без ролей) добавлен во все перечисленные читающие экспорты; tx-хелперы не тронуты; дублей гарда нет.
4. `getShipments` удалён, мёртвых ссылок не осталось.
5. README описывает реальный проект; секретов нет.
6. 5 security-заголовков отдаются; CSP не добавлен.
7. Смоук пройден, поведение не изменилось; lint/tsc/build зелёные.

---

## После задачи — обновление памяти (зона PM)
- `AUDIT-REMEDIATION-PLAN.md`: волна 1 → закрыта; в волну 5 добавлен вынос tx-хелперов из `"use server"`-модулей.
- `CONTEXT-HANDOFF.md`: ARCHITECTURAL DECISIONS += «единый `server/action-result.ts`; все ошибки actions —
  через `failWithLog` (console.error); читающие server actions гардируются `requireRole()` без ролей».
- `CLAUDE.md`: в эталонные паттерны — `failWithLog` вместо локального `authFail`.
