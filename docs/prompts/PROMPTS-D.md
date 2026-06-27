# PROMPTS — Этап D: жизненный цикл тары (склад)

> Переопределено по итогам обсуждения: D — это не просто read-only дашборд, а полный цикл тары.
> Цель — видеть РЕАЛЬНЫЕ остатки тары у завода и каждого фермера + сколько в пути в обе стороны.

## Модель (зафиксирована, в DOMAIN §3)

Баланс = `Σ StockMovement` по тройке **локация × тип × состояние** (`good`/`scrap`).
Локации: `0`=завод · `Farmer.id`=фермер · **`-1`=в пути НА завод** · **`-2`=в пути С завода** · `null`=вне системы.
Константы — `server/shipments/packaging.ts`: `FACTORY_LOCATION_ID=0`, `TRANSIT_TO_FACTORY=-1`, `TRANSIT_TO_FARMER=-2`.

**Тара двигается ДВУХФАЗНО, привязано к статусам** (дебет при отправке, кредит при прибытии, между — транзит):

| Событие | Движение |
|---|---|
| Продукция (Shipment) `planned→sent` | фермер → `-1` |
| Продукция `sent→arrived` | `-1` → завод |
| Доставка тары (MaterialShipment) `planned→sent` | завод → `-2` |
| Доставка тары `sent→arrived` | `-2` → фермер |

- Кол-во входящей тары = `ceil(planned_weight / норму)` (как в B2). Кол-во доставки = задаётся вручную (`MaterialShipmentItem.quantity`).
- Доставка тары — отдельный рейс (свой водитель/даты, груз=тара), с входящим НЕ связан. Зеркало отгрузки продукции.
- Начальный остаток = разовое движение `opening` (`from=null → локация`, source=manual), редактируется заменой.
- Откат любого статуса (Admin) сторнирует своё плечо. Идемпотентно.

## Решения (залочены)
Транзит-сентинелы `-1/-2` ✓ · `opening` отдельным `movement_type` (мини-миграция enum) ✓ ·
старые tare-движения СБРОСИТЬ ✓ · доставка тары (бывший этап E) входит в D ✓.

## Срезы
- **D1** — модель + начальные остатки: миграция `opening`, константы транзита, СБРОС старых tare-движений,
  экран ввода стартовых остатков (завод + фермеры × типы) → opening-движения. ← промпт ниже.
- **D2** — входящая тара двухфазно: переписать B2 (`sent`→`-1`, `arrived`→завод) + сторно по статусам.
- **D3** — доставка тары (`MaterialShipment`): дизайн нового экрана «Логистика материалов» → код
  (создание/отправка/прибытие рейса тары, `sent`→`-2`, `arrived`→фермер) + сторно.
- **D4** — дашборд «Тара»: матрица локация×тип (Завод + фермеры + строки/колонки «в пути на завод/с завода»),
  состояние good/scrap, реальные остатки; опц. атрибуция транзита по фермеру (join к рейсам). Дизайн —
  доработка утверждённого прототипа `inventory-tare-d0.html` (добавить транзит, легенда «реальный остаток»).

Порядок ценности: D1 (занести реальность) → D2 (входящая) → D3 (доставка) → D4 (видимость). Дашборд
становится «настоящим» к D3; до этого остатки видны на экране начальных остатков (D1).

---

## ПРОМПТ — D1: модель + начальные остатки тары (Claude Code)

```text
Задача D1 (этап D, VSMS): фундамент склада тары — миграция, константы транзита, сброс старых движений
тары и экран начальных остатков. Перед кодом — docs/DOMAIN.md §3 (НОВАЯ модель тары: транзит-сентинелы,
двухфазность, opening), CLAUDE.md (баланс = Σ движений, не хранится; логика в server/; ChangeLog в
транзакции). Эталон матрицы ввода — app/(app)/settings/norms/_components/NormsMatrix.tsx. API — context7.

1) МИГРАЦИЯ d1_tare_opening:
   - enum MovementType += `opening`. (Postgres ALTER TYPE ADD VALUE; данные целы.)
   - npx prisma migrate dev --name d1_tare_opening. Сверить SQL глазами.

2) КОНСТАНТЫ в server/shipments/packaging.ts (рядом с FACTORY_LOCATION_ID=0):
   export const TRANSIT_TO_FACTORY = -1;   // в пути НА завод (продукция фермер→завод)
   export const TRANSIT_TO_FARMER  = -2;   // в пути С завода (тара завод→фермер)

3) СБРОС старых движений тары (модель сменилась): скрипт scripts/d1-reset-packaging.ts —
   prisma.stockMovement.deleteMany({ where:{ kind:"packaging" } }). Запускается один раз (npx tsx ...).
   Вывести количество удалённых. НЕ трогать kind=ingredient. (Данные ранние/тестовые — подтверждено.)
   После сброса входящие движения появятся заново в D2; начальные — в п.5.

4) server/inventory/opening.ts — backend начальных остатков:
   - getOpeningBalances(): по всем активным фермерам + заводу и всем активным типам тары вернуть текущее
     значение opening (из движений opening) для матрицы. Структура: locations[{id,name,isFactory}],
     types[{id,name}], value(locationId,typeId)→number.
   - setOpeningBalance({ locationId, packagingTypeId, quantity }): requireRole("admin"),
     $transaction → удалить существующее opening-движение этой (локация,тип) + создать новое
     { kind:"packaging", packaging_type_id, quantity, from_location_id:null, to_location_id:locationId,
       from_state:null, to_state:"good", movement_type:"opening", source_doc_type:"manual",
       source_doc_id:null } (quantity>0; quantity=0 → просто удалить, без нового) + logChange.
     ВАЖНО: opening — единственный movement_type, который можно заменять (setup-данные); операционный
     леджер (return/delivery/...) НЕ редактируется. Локация: 0=завод или Farmer.id (транзит/ null — нельзя).

5) UI — Настройки → «Начальные остатки тары» (setup-данные → в Настройках, новый подпункт):
   app/(app)/settings/opening-stock/page.tsx + компонент OpeningStockMatrix.tsx ("use client") по стилю
   NormsMatrix: строки = Завод (первой, выделен) + активные фермеры; колонки = активные типы тары;
   ячейка = редактируемое число (целое, >=0), автосейв по blur через setOpeningBalance, sticky шапка/
   первый столбец, tabular-nums. Пустая/0 = нет начального остатка. RoleGate admin (правка), остальным —
   read-only.

ОГРАНИЧЕНИЯ:
- Менять схему ТОЛЬКО enum += opening (обсуждено). Баланс не хранить.
- Логика — в server/; компонент отображает и зовёт server-actions.
- Сброс (п.3) — отдельный скрипт, НЕ автозапуск в коде приложения.
- Доки/TASKS.md не трогать (обновит ассистент после ревью).

ПРОВЕРКА (покажи результат):
- миграция применена, MovementType содержит opening; старые packaging-движения удалены (count);
- ввод начальных остатков: завод 5000 ящиков, фермер 1200 → создались opening-движения; баланс этих
  локаций = введённым значениям;
- повторное редактирование ячейки → значение ЗАМЕНЯется (не дублируется, одно opening-движение на тройку);
- 0 → opening-движение удалено;
- non-admin: матрица read-only, setOpeningBalance отклоняется.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью D1
1. Миграция аддитивная (enum += opening); SQL сверен; ingredient-движения не тронуты.
2. Константы транзита `-1/-2` в packaging.ts.
3. Сброс — отдельный скрипт, только kind=packaging.
4. opening-движение: `from=null → локация`, `to_state=good`, `source=manual`; замена при правке (не дубли).
5. Баланс = Σ движений (на лету); матрица по стилю NormsMatrix; admin-гейт на запись.

---

---

## ПРОМПТ — D2: входящая тара двухфазно (Claude Code)

Переписывает существующий B2 (одно-плечевое движение тары) на две фазы по статусам.

```text
Задача D2 (этап D, VSMS): входящая тара (продукция фермер→завод) — ДВУХФАЗНО: на `sent` тара уходит у
фермера в «в пути на завод» (-1); на `arrived` приходит на завод (0). Переписывает текущий B2. Перед кодом
— docs/DOMAIN.md §3 (новая модель, BR-3), CLAUDE.md. Prisma API при сомнении — context7.

КОНТЕКСТ (текущий код):
- server/shipments/packaging.ts: FACTORY_LOCATION_ID=0, TRANSIT_TO_FACTORY=-1, TRANSIT_TO_FARMER=-2,
  calcPackagingUnits, loadPackagingContext, buildTarePlan, tareSummary.
- server/shipments/actions.ts: sendShipment (planned→sent, СЕЙЧАС создаёт движение фермер→FACTORY, return);
  revertShipmentToPlanned (sent→planned, сторно нетто-паттерном).
- Переход sent→arrived ОДНОСТОРОННИЙ (BR-24), в ДВУХ местах server/acceptance/actions.ts:
  (а) авто-arrived на первом сохранённом весе (saveWeight) и (б) markArrived. ВАЖНО: act.ts:~552 — это
  accepted→arrived при ОТКАТЕ акта, НЕ новое прибытие → туда плечо НЕ вешать.
- arrived→sent обратного перехода НЕТ → плечо прибытия НЕ сторнируется.
- Старые packaging-движения уже сброшены (D1). Миграции данных не нужно, только go-forward.

1) sendShipment — плечо ОТПРАВКИ: в createMany заменить `to_location_id: FACTORY_LOCATION_ID` →
   `TRANSIT_TO_FACTORY`. (movement_type остаётся "return"; from=farmerId, to=-1.) Остальное без изменений.

2) revertShipmentToPlanned — сторно плеча отправки: `isOriginal = m.to_location_id === TRANSIT_TO_FACTORY`
   (было FACTORY_LOCATION_ID); в storno createMany `from_location_id: TRANSIT_TO_FACTORY` (было FACTORY).
   (Откат только из sent → плечо прибытия там ещё не создано. Для надёжности игнорируй движения с
   to/from = FACTORY, если попадутся.)

3) НОВЫЙ хелпер в packaging.ts — applyInboundArrivedTareLeg(tx, shipmentId): плечо ПРИБЫТИЯ.
   - идемпотентность: если уже есть {source_doc_type:"shipment", source_doc_id:shipmentId, kind:"packaging",
     from_location_id:TRANSIT_TO_FACTORY, to_location_id:FACTORY_LOCATION_ID} → выйти, ничего не создавая.
   - иначе прочитать движения плеча отправки (source=shipment, kind=packaging, return), посчитать НЕТТО по
     packaging_type в транзите -1 (оригиналы to=-1 плюс; сторно to=farmer минус); для типов с нетто>0
     создать по одному движению {from=-1, to=0, packaging_type, quantity=нетто, from_state/to_state:"good",
     movement_type:"return", source_doc_type:"shipment", source_doc_id} (фермер на заводской стороне не важен).
   - вернуть число созданных (для лога).

4) Вызвать applyInboundArrivedTareLeg в ОБОИХ местах sent→arrived в acceptance/actions.ts — сразу после
   tx.shipment.update({status:"arrived"}): в блоке авто-arrived (saveWeight) и в markArrived. В их logChange
   добавить field:"movements" ("плечо прибытия: N движ."). act.ts НЕ трогать.

ОГРАНИЧЕНИЯ: схему не менять; баланс не хранить; плечо прибытия не сторнируется (переход односторонний);
логика в server/; доки/TASKS.md не трогать (обновит ассистент после ревью).

ПРОВЕРКА (rolled-back tx или тест-данные, покажи результат):
- send машины с тарой: фермер −units · транзит -1 +units · завод 0;
- markArrived (и отдельно — первый вес): -1 → 0 · завод +units; повтор markArrived → плечо НЕ дублируется;
- revert sent→planned (до прибытия): сторно плеча отправки, фермер обратно, -1 → 0;
- навал (нет тары) → движений нет; смешанная машина — только по тарным позициям;
- полный цикл: фермер −units · завод +units · транзит 0.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью D2
1. sendShipment: тара уходит в `-1` (не на завод); movement_type "return", from=фермер.
2. Плечо прибытия — в ОБОИХ местах sent→arrived (saveWeight авто + markArrived); НЕ в act.ts (это откат).
3. applyInboundArrivedTareLeg идемпотентен (повтор не дублирует); нетто по типу из транзита.
4. revert правит detection и storno на `TRANSIT_TO_FACTORY`; работает только из sent.
5. Плечо прибытия не сторнируется (переход односторонний); баланс на лету; схема не тронута.
6. Навал/смешанная машина обработаны; полный цикл сходится (фермер −, завод +, транзит 0).

---

## Дальше (детализирую перед стартом каждого)
- **D3** — доставка тары: дизайн-промпт нового экрана «Логистика материалов» (рейс тары, зеркало отгрузки)
  → код (`MaterialShipment` статус-флоу + движения `завод→-2→фермер` на sent/arrived + сторно).
- **D4** — дашборд «Тара»: матрица + «в пути на завод/с завода»; реальные остатки; доработка прототипа
  `inventory-tare-d0.html`. Опц.: атрибуция транзита по фермеру (join к Shipment/MaterialShipment).
