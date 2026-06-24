# PROMPTS — E4: дашборд балансов ингредиентов (зеркало D4)

> Этап E, срез 4/4 (последний). Решение: для `balances.ts` — **зеркалить** (не параметризовать):
> у ингредиента отличия СТРУКТУРНЫЕ (нет состояния scrap, один транзит -2, колонки с unit), общая —
> только агрегация Σ движений (выносим в хелпер). Экран — отдельный **`/ingredients`** (сейчас заглушка,
> обещает экран на этапе E; справочник — на `/reference/ingredients`), симметрично таре на `/packaging`.

## Контекст (D4, тара) и отличия ингредиента

| Аспект | Тара (D4) | Ингредиент (E4) |
|---|---|---|
| Состояние | good/scrap (тоггл) | всегда good — тоггла НЕТ |
| Транзит | -1 (на завод) и -2 (с завода) | только -2 (доставка); -1 не используется |
| Колонка | тип тары (box/barrel, шт) | ингредиент + его unit (кг/л) |
| Итог колонки | Σ по локациям | Σ по локациям; **учитывает расход** (consumption to=null) |
| «= Σ opening» | держится (disposal=0) | **НЕ держится**: consumption уводит из системы — это норма |
| Drill-down источники | shipment / material_shipment / inv | delivery (material_shipment) / opening (manual) / **consumption (acceptance_act)** |

Движения ингредиента: opening (`from=null→локация`), delivery (`завод 0→-2→фермер`),
consumption (`from=фермер→to=null`, источник acceptance_act, C2). Баланс не хранится = Σ движений.
Отрицательный баланс фермера допустим (расход отметили раньше прибытия доставки) — показывать как есть.

---

## ПРОМПТ — E4: дашборд балансов ингредиентов (Claude Code)

```text
Задача E4 (этап E, VSMS): read-only дашборд остатков ИНГРЕДИЕНТОВ — зеркало дашборда тары (D4), но проще:
без состояния scrap, один транзит -2, колонки с единицей (кг/л). Экран — вкладки Тара|Ингредиенты на
существующем /packaging. Перед кодом — DOMAIN.md §3 (баланс=Σ движений, транзит -2, consumption to=null),
CLAUDE.md (логика в server/, баланс не хранить, дизайн-токены: tabular-nums, без эмодзи — только lucide).
shadcn(Tabs)/Next — context7.

ЭТАЛОН ДЛЯ ЗЕРКАЛИРОВАНИЯ — server/inventory/balances.ts (getTareBalances/getTareMovements/chipFor) и
app/(app)/packaging/_components/TareBalanceMatrix.tsx. НЕ параметризовать tare-функции — добавить
ingredient-сиблинги; общую агрегацию Σ движений (add/neg по to/from) вынести в локальный хелпер,
если выходит чисто; иначе продублировать (~10 строк).

КОНТЕКСТ СХЕМЫ (НЕ менять): StockMovement(kind, ingredient_id?, quantity Decimal(15,6), from/to_location_id,
from/to_state, movement_type, source_doc_type, source_doc_id). Ingredient(id,name,unit{kg|l},active).
FACTORY_LOCATION_ID=0, TRANSIT_TO_FARMER=-2. Для ингредиента -1 (TRANSIT_TO_FACTORY) НЕ используется.

1) server/inventory/balances.ts — добавить:
   - типы: IngredientCol { id; name; unit:"kg"|"l" }; IngredientLocation { id; name; kind:"factory"|"farmer"
     |"transit"; inactive? }; IngredientCell { locationId; ingredientId; quantity }; IngredientBalances
     { columns: IngredientCol[]; locations; cells }. БЕЗ state (ингредиент всегда good).
   - getIngredientBalances(): requireRole(). movements where {kind:"ingredient"}. Агрегация Σ: +qty в
     (to_location, ingredient); −qty в (from_location, ingredient); null-сторону пропускать (opening from=null
     приход; consumption to=null расход). Колонки = активные ингредиенты ∪ встреченные в движениях
     (деактивированные не терять), с unit. Локации = Завод(0) + активные фермеры + фермеры с ненулевым
     балансом (inactive-пометка) + ОДНА транзит-строка -2 «В пути с завода». cells — только ненулевые.
   - getIngredientMovements(locationId, ingredientId): requireRole(). where {kind:"ingredient", ingredient_id,
     OR[from_location_id=loc, to_location_id=loc]}. Знаковый qty для (locationId): +to / −from. Резолв имён
     фермеров и кодов источников БАТЧЕМ: material_shipment→MaterialShipment.code (Рейс ...),
     acceptance_act→AcceptanceAct (Акт <code|#id>). chip по movement_type:
       • opening → «остаток на начало»
       • delivery: завод→-2 «отправлено»; -2→завод «сторно отправки»; -2→фермер «доставка»;
         фермер→-2 «сторно доставки»
       • consumption (from=фермер, to=null) → «расход в производство»
     transit=true когда одна сторона = -2. locName: 0→«Завод», -2→«В пути с завода», >0→имя фермера, null→null.

2) app/(app)/ingredients/page.tsx — ЗАМЕНИТЬ заглушку (Placeholder) на дашборд по образцу
   app/(app)/packaging/page.tsx: загрузить getIngredientBalances(), отрисовать IngredientBalanceMatrix,
   заголовок «Ингредиенты». /packaging и TareBalanceMatrix НЕ трогать (тара живёт отдельно, как было).

3) app/(app)/ingredients/_components/IngredientBalanceMatrix.tsx — по образцу
   app/(app)/packaging/_components/TareBalanceMatrix.tsx, но:
   - БЕЗ тоггла состояния (good-only).
   - Колонки = ингредиенты; в ЗАГОЛОВКЕ колонки — «name, кг»/«name, л» (unit). Числа tabular-nums,
     Decimal (показывать дробные кг/л, не округлять до целого).
   - Строки: Завод, фермеры (inactive помечены), ОДНА транзит-строка «В пути с завода» (-2).
   - Строка «Итого в системе» = Σ по локациям ПО КАЖДОЙ колонке (per-ingredient, единица колонки).
     НЕ суммировать между колонками (разные единицы). Подпись/легенда: «итог колонки — живой остаток,
     учитывает расход в производство; может быть меньше начального».
   - Drill-down: клик по ненулевой ячейке → диалог истории (getIngredientMovements), чипы как выше,
     отрицательные значения показывать как есть.

ОГРАНИЧЕНИЯ:
- Схему/миграции — нет. /packaging, TareBalanceMatrix и tare-функции balances.ts — НЕ менять (только
  добавлять ingredient-сиблинги в balances.ts + новый экран /ingredients).
- Один транзит -2; -1 ингредиента не касается. Состояния scrap у ингредиента нет.
- Кг и л НИКОГДА не складывать (каждая колонка — своя единица; межколоночного «итого» нет).
- Иконки lucide, без эмодзи; чтение под (app)-auth (requireRole() без конкретной роли, как D4).
- Доки/TASKS — не трогать (ассистент батчем после ревью E4).

БД ТЕСТОВАЯ (правило проекта): данные одноразовые; проверки через UI/seed, очистка свободно.

ПРОВЕРКА (показать):
- сид: opening соль завод 100 кг; доставка соль 30 кг фермеру X (send+arrive); расход (C2) соль 12 кг у X.
  Ожидаем: завод 70 кг · фермер X 18 кг · транзит -2 = 0 · «Итого в системе» по соли = 88 кг (= 100 − 12).
  Явно показать, что 88 ≠ 100 (opening) — расход 12 ушёл из системы, это норма.
- в пути: доставка отправлена, но не прибыла → транзит -2 показывает кол-во; прибытие обнуляет транзит.
- отрицательный кейс: расход у фермера до прибытия доставки → ячейка фермера отрицательна, показана как есть.
- две единицы: соль (кг) и уксус (л) — отдельные колонки, межколоночного суммирования нет.
- drill-down соли у фермера X: чипы «остаток на начало»/«доставка»/«расход в производство», источники
  Рейс <code> / Акт <code>; знак qty для ячейки верный.
- регресс тары: /packaging работает как раньше (good/scrap, оба транзита, итоги) — файлы тары не тронуты.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью E4
1. `getIngredientBalances`: Σ движений, колонки с unit (активные ∪ встреченные), один транзит -2, без state.
2. `getIngredientMovements`: чип consumption «расход в производство»; источник acceptance_act резолвится; знак qty верен.
3. Tare-функции и `TareBalanceMatrix` не тронуты; добавлены только сиблинги/новый компонент.
4. UI: отдельный экран `/ingredients` (заглушка заменена); без тоггла состояния; колонки с единицей; Decimal не округлён; tabular-nums.
5. «Итог колонки» = живой остаток (учитывает расход), легенда про «≠ начальный»; межколоночного итога нет.
6. Транзит только -2; отрицательные ячейки показаны; кг/л нигде не слиты; чтение под (app)-auth.

---

## После E4 — закрытие этапа E (батч-доки, делает ассистент)
- CLAUDE.md: правило тестовой БД (данные одноразовые, без data-preserving миграций до прод-вайпа).
- DOMAIN.md §3: ингредиент — транзит только -2; «Итого в системе» у ингредиентов уменьшается на consumption
  (инвариант «= Σ opening» не действует — норма); farmer→farmer (transfer) остаётся отложенным.
- TASKS.md: E1–E4 закрыты; зафиксировать отложенное (transfer ингредиентов/тары, D2-ops, D3-2).
- CONTEXT-HANDOFF.md: новое состояние, следующий кандидат-срез.
