# PROMPTS — E3: начальные остатки ингредиентов (параметризация opening)

> Этап E, срез 3/4. Решение: **вариант A — параметризовать** `server/inventory/opening.ts` под `kind`
> (как E1), а не зеркалить. Экран — вкладки **Тара | Ингредиенты** на существующем `/settings/opening-stock`
> (расширение утверждённого экрана D1, не новый экран).

## Контекст (D1, готово для тары)

- `opening` — единственный тип движения, правимый ЗАМЕНОЙ (setup-данные): удалить старое + создать новое.
  Баланс не хранится = Σ движений; opening на тройку (локация × предмет).
- Текущее: `getOpeningBalances()` (матрица локация × тип тары) + `setOpeningBalance({locationId,
  packagingTypeId, quantity})`; UI `/settings/opening-stock` → `OpeningStockMatrix` → `OpeningStockInput`
  (автосейв по blur, валидирует ЦЕЛОЕ).
- Локации opening: завод (0) или активный фермер; транзит/null запрещены.

## Что меняется для ингредиента

- Колонка = `Ingredient(id, name, unit: kg|l, active)`; FK `ingredient_id`; `kind="ingredient"`.
- Кол-во — **Decimal кг/л** (НЕ целое). Тара остаётся целым (шт).
- Прочая механика (замена, requireRole admin, ChangeLog в транзакции, валидная локация) — общая.

---

## ПРОМПТ — E3: параметризация opening + вкладки (Claude Code)

```text
Задача E3 (этап E, VSMS): добавить начальные остатки ИНГРЕДИЕНТОВ, параметризовав движок opening под оба
kind, и вкладки Тара|Ингредиенты на экране /settings/opening-stock. Перед кодом — DOMAIN.md §3 (opening,
movement_type=opening, баланс не хранить), CLAUDE.md (логика в server/, ChangeLog в транзакции, requireRole,
дизайн-токены: tabular-nums, без эмодзи-иконок). shadcn (Tabs)/Next API — context7.

ВАРИАНТ A (как E1): обобщаем существующие getOpeningBalances/setOpeningBalance/матрицу/инпут под kind —
НЕ создаём ingredient-копии. Тара остаётся ЦЕЛЫМ (шт), ингредиент — Decimal (кг/л).

КОНТЕКСТ СХЕМЫ (НЕ менять): StockMovement(kind, packaging_type_id?, ingredient_id?, quantity Decimal(15,6),
from_location_id=null, to_location_id=локация, from_state=null, to_state=good, movement_type=opening,
source_doc_type=manual). Ingredient(id,name,unit{kg|l},active). FACTORY_LOCATION_ID=0; транзит -1/-2 запрещён.

1) server/inventory/opening.ts — параметризовать по kind: ItemKind ("packaging"|"ingredient"):
   - Унифицировать форму OpeningBalances: columns: { id; name; unit?: "kg"|"l" }[] (вместо types),
     values: { locationId; itemId; quantity }[] (вместо packagingTypeId), + kind в ответе.
   - getOpeningBalances(kind): для packaging — типы тары (unit отсутствует); для ingredient — активные
     ингредиенты с unit. movements.where = { kind, movement_type:"opening" }; values берут нужный FK по kind.
   - setOpeningBalance({ kind, locationId, itemId, quantity }):
     • валидация кол-ва ПО KIND: packaging → Number.isInteger && >=0; ingredient → Decimal >=0 (разрешить
       дробное, напр. step 0.001). qty=0 → только удаление.
     • проверка предмета по kind (packagingType.active ИЛИ ingredient.active).
     • isValidLocation — без изменений (завод/активный фермер; транзит/null запрещены).
     • замена: findFirst по { kind, movement_type:"opening", to_location_id, <FK по kind> } → delete +
       (qty>0) create с kind + нужным FK + quantity (Decimal). ChangeLog (entity StockMovement, field
       "opening", old/new) В ТОЙ ЖЕ транзакции. requireRole("admin").
   - revalidatePath(PATH) — PATH прежний.

2) app/(app)/settings/opening-stock/page.tsx — загрузить ОБА набора (getOpeningBalances("packaging") и
   ("ingredient")) и отрисовать вкладки shadcn Tabs: «Тара» | «Ингредиенты». В каждой — матрица своего kind.

3) OpeningStockMatrix.tsx — обобщить пропсы под columns/itemId/kind + режим ввода:
   - cellKey(locationId, itemId); рендер колонок из columns; для ингредиента в ЗАГОЛОВКЕ колонки показать
     единицу (name + «, кг»/«, л»).
   - прокинуть в ячейку mode: kind==="ingredient" ? "decimal" : "int" и unit.
   - подзаголовок зависит от kind: тара — «целое, штук»; ингредиент — «кг/л».

4) OpeningStockInput.tsx — обобщить под mode "int"|"decimal":
   - int: как сейчас (Number.isInteger, step=1, inputMode=numeric).
   - decimal: parseFloat, >=0, step=0.001, inputMode=decimal; показать единицу рядом.
   - вызывать setOpeningBalance({ kind, locationId, itemId, quantity }).

ОГРАНИЧЕНИЯ:
- Схему/миграции — нет. Движок доставки (materials/), balances.ts, дашборд — НЕ трогать (E4).
- opening пишется ТОЛЬКО на завод/активного фермера; транзит/null — запрещены (как для тары).
- Тара остаётся целым; ингредиент — Decimal. Кг и л — разные колонки (по unit ингредиента), не складывать.
- Иконки/хром — нейтральные, lucide; без эмодзи. RBAC — admin (как D1). Доки/TASKS — не трогать.

БД ТЕСТОВАЯ (правило проекта): данные одноразовые; проверки через UI на seed-данных, очистка свободно.

ПРОВЕРКА (показать):
A. РЕГРЕСС ТАРЫ (должен остаться зелёным): вкладка «Тара» — ввод целого по локациям сохраняется заменой,
   qty=0 удаляет, non-int отклоняется; баланс локации = введённому; non-admin отклонён.
B. ИНГРЕДИЕНТ: вкладка «Ингредиенты» — завод: соль 50 кг, фермер X: уксус 12.5 л → сохраняются;
   дробное принимается; правка заменяет (одно opening-движение на тройку); qty=0 удаляет; единица в
   шапке колонки верная (кг/л); ChangeLog пишет old/new.
C. Локация-гард: попытка opening на транзит/несуществующего фермера — отклонена.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью E3
1. `opening.ts` параметризован по kind; форма унифицирована (columns/itemId/unit/kind); тары-путь не сломан.
2. Валидация кол-ва по kind: тара — целое; ингредиент — Decimal (дробное ок). qty=0 удаляет.
3. Замена сохраняет инвариант «одно opening на (kind, локация, предмет)»; ChangeLog в той же транзакции.
4. Локация-гард (завод/активный фермер; транзит/null запрещены) общий и работает для обоих kind.
5. UI: вкладки Тара|Ингредиенты; единица в шапке ингредиентных колонок; tabular-nums; admin-only.
6. Схема/доставка/дашборд не тронуты; кг и л — раздельные колонки.

---

## После E3 — E4 (дашборд балансов ингредиентов)
Зеркало D4: `getIngredientBalances` (локация × ингредиент × состояние), кг/л раздельно, транзит -2;
«Итого в системе» УЧИТЫВАЕТ расход (consumption уводит из системы, инвариант «= Σ opening» не действует).
После E4 — батч-обновление доков (CLAUDE.md: правило тестовой БД; DOMAIN: ингредиент транзит только -2 +
consumption-аномалия «Итого»; TASKS; CONTEXT-HANDOFF) и закрытие этапа E.
