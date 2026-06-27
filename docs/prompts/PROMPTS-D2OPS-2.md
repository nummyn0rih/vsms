# PROMPTS — D2-ops-2: корректировка остатка тары (adjustment как инвентаризация)

> Ручные операции тары, срез 2/2. Без миграции (enum `adjustment` есть). Tare-only. Решение 1A:
> **инвентаризация** — оператор вводит ФАКТИЧЕСКИЙ остаток, сервер пишет движение `adjustment` на разницу.
> Точка входа — drill-down диалог ячейки на `/packaging`, для ОБОИХ состояний (good и scrap; scrap-вид
> стал кликабельным в D2-ops-1-fix). Admin-only. Причина — в ChangeLog.

## Механика

- Корректируется тройка (локация × тип × состояние) к целевому значению.
- `delta = факт − текущий_Σ` (текущий считается на СЕРВЕРЕ, не с клиента). Одно движение `adjustment`:
  - `delta > 0`: `from=null/null → to=loc/state`, qty=delta (приход к ячейке).
  - `delta < 0`: `from=loc/state → to=null/null`, qty=|delta| (расход из ячейки).
  - `delta = 0`: движение НЕ пишем (вернуть «остаток совпал»).
- Знак кодируется стороной from/to (quantity всегда > 0). Баланс = Σ движений — поэтому одно одностороннее
  движение сдвигает ячейку ровно на delta.
- `chipFor` в balances.ts уже знает `adjustment` — историю НЕ дорабатывать.

---

## ПРОМПТ — D2-ops-2: adjustment (Claude Code)

```text
Задача D2-ops-2 (VSMS): корректировка остатка тары как ИНВЕНТАРИЗАЦИЯ — оператор вводит фактический остаток
ячейки, сервер пишет движение adjustment на разницу. Из drill-down диалога ячейки /packaging, для обоих
состояний (good/scrap). Без миграции (enum adjustment есть). Tare-only. Перед кодом — DOMAIN.md §3
(adjustment=ручная правка; баланс=Σ движений, может быть отрицательным), CLAUDE.md (логика в server/,
ChangeLog в той же транзакции, requireRole, баланс не хранить). Эталон — server/inventory/operations.ts
(scrapTare/disposeTare из D2-ops-1: validateOp, isOperableLocation, $transaction+logChange, revalidatePath).
Next/Prisma — context7.

КОНТЕКСТ: StockState{good|scrap}; MovementType содержит adjustment; SourceDocType содержит manual.
Локации операций — завод(0)/фермер (вкл. архивного); транзит(-1/-2)/null запрещены (как в D2-ops-1).
Кол-во тары — целое (шт).

1) server/inventory/operations.ts — добавить Server Action adjustTare({ locationId, packagingTypeId,
   state, actual, reason }), ActionResult, requireRole("admin"):
   - валидация: state ∈ {good,scrap}; Number.isInteger(actual) && actual >= 0; packagingType существует;
     isOperableLocation (переиспользовать из D2-ops-1) — иначе error.
   - ТЕКУЩИЙ остаток ячейки считать НА СЕРВЕРЕ: Σ движений по kind="packaging", packaging_type_id,
     для тройки (locationId, state): +quantity где (to_location_id=loc AND to_state=state);
     −quantity где (from_location_id=loc AND from_state=state). (Вынести в локальный хелпер
     getPackagingCellBalance или считать инлайн.)
   - delta = actual − current. Если delta === 0 → вернуть ok с сообщением «остаток уже совпадает», движение
     НЕ создавать.
   - $transaction: одно StockMovement:
     • delta>0: { kind:"packaging", packaging_type_id, quantity: delta, from_location_id:null,
       from_state:null, to_location_id:locationId, to_state:state, movement_type:"adjustment",
       source_doc_type:"manual", source_doc_id:null }
     • delta<0: { …, quantity: Math.abs(delta), from_location_id:locationId, from_state:state,
       to_location_id:null, to_state:null, movement_type:"adjustment", source_doc_type:"manual" }
     + logChange(entity "StockMovement", action "create", payload { op:"adjustment", locationId,
       packagingTypeId, state, from: current, to: actual, delta, reason }) В ТОЙ ЖЕ транзакции.
   - revalidatePath("/packaging").

2) app/(app)/packaging/_components/TareBalanceMatrix.tsx — в drill-down Drawer / OperationsSection
   добавить операцию «Скорректировать остаток» (admin-only, не транзит), доступную для ОБОИХ состояний:
   - показать текущий остаток ячейки; инпут «Фактический остаток» (целое ≥ 0); опц. «Причина».
   - превью разницы под инпутом: «корректировка: +3» / «−2» / «совпадает» (delta = факт − текущий).
   - подтверждение → adjustTare({ locationId, packagingTypeId, state, actual, reason }).
   - state брать из открытого drawer (good или scrap). После успеха: loadMovements + router.refresh();
     при delta=0 — показать «остаток уже совпадает» без записи. Ошибку — из ActionResult.
   - числа tabular-nums; lucide; без эмодзи. Не ломать scrap/disposal из D2-ops-1 и логику матрицы/итогов.

ОГРАНИЧЕНИЯ:
- Без миграции. Только server/inventory/operations.ts (+adjustTare) и drill-down в TareBalanceMatrix.tsx.
- Tare-only (ингредиентов нет). Факт ≥ 0 (целое); текущий Σ может быть отрицательным → delta любой знак.
- adjustment — source=manual; причина только в ChangeLog. admin на сервере И клиенте.
- balances.ts/chipFor (adjustment уже есть) и tare-функции — НЕ трогать. Доки/TASKS — не трогать.

БД ТЕСТОВАЯ (правило проекта): данные одноразовые; проверки через UI/seed, очистка свободно.

ПРОВЕРКА (показать):
- good у фермера X = 85. «Скорректировать» факт=80 → delta −5: движение adjustment (X/good→null, 5);
  good 80; история чип «корректировка»; ChangeLog payload from=85,to=80,delta=−5,reason.
- текущий good=80, факт=90 → delta +10: движение (null→X/good, 10); good 90.
- scrap-вид: ячейка scrap=5, факт=5 → delta 0 → «остаток уже совпадает», движения нет.
- отрицательный текущий: если Σ=−3, факт=0 → delta +3 → ячейка станет 0.
- локация-гард: на транзите кнопки нет; сервер отклоняет транзит/null. RBAC: не-admin не видит; requireRole отклоняет.
- регресс: scrap/disposal (D2-ops-1) и матрица/итоги/история работают как раньше.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью D2-ops-2
1. `adjustTare`: admin; факт целое ≥0; текущий Σ считается НА СЕРВЕРЕ по тройке (loc,type,state); delta=факт−текущий.
2. delta>0 → приход (null→loc/state); delta<0 → расход (loc/state→null); delta=0 → без движения; quantity>0, знак через from/to.
3. source=manual; logChange в той же транзакции (from/to/delta/reason в payload).
4. UI: «Скорректировать остаток» для обоих состояний, превью разницы, state из drawer, router.refresh; delta=0 не пишет.
5. Локация-гард (завод/фермер вкл. архив; транзит/null отклонены); tare-only; без миграции.
6. scrap/disposal (D2-ops-1), матрица/итоги/история, balances.ts/chipFor — не сломаны.

---

## После D2-ops-2 — закрытие D2-ops, затем D3-2
D2-ops закрыт (лом+утиль+корректировка) → батч-доков (DOMAIN §3/BR: ручные операции тары, manual; TASKS;
HANDOFF). Далее **D3-2** (позиционное прибытие рейса): потребуется МИГРАЦИЯ `MaterialShipmentItem +=
arrived_at Date?` + по-позиционное плечо `arrived` + производный статус машины — обсудим схему ПЕРЕД кодом.
