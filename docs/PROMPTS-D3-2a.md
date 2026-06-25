# PROMPTS — D3-2a: позиционное прибытие рейса (миграция + сервер)

> D3-2, срез 1/2 (сервер). Прибытие доставки становится ПО-ПОЗИЦИОННЫМ. Требует МИГРАЦИИ
> `MaterialShipmentItem += arrived_at`. Статус «частично» — ПРОИЗВОДНЫЙ (enum `ShipmentStatus` общий с
> отгрузками продукции — не трогаем). Отправка — по-прежнему на весь рейс. arrived_at = now() при отметке.

## Решения (утверждены)
1. «Частично прибыл» — производное (status хранит planned/sent/arrived; enum НЕ менять).
2. Отправка whole-trip (по-позиционным становится только прибытие).
3. arrived_at = now() при отметке.
4. Откат отправки sent→planned — только если НИ ОДНА позиция не прибыла.
5. Кнопка «Принять» (UI, D3-2b) = пакетная отметка всех позиций → нужны и по-позиционные, и пакетные actions.

## Стейт-машина
```
planned ─[send весь рейс]→ sent (все позиции: завод 0 → -2)
sent ─[markItemArrived]→ позиция -2 → фермер (arrived_at=now); все прибыли → status=arrived; иначе sent (DERIVED «частично»)
arrived/частично ─[unmarkItemArrived]→ сторно плеча позиции; status=sent
sent ─[revertToPlanned]→ только если 0 прибывших → все -2 → завод; status=planned
```

---

## ПРОМПТ — D3-2a: миграция + сервер (Claude Code)

```text
Задача D3-2a (VSMS): сделать прибытие доставки ПО-ПОЗИЦИОННЫМ. Миграция MaterialShipmentItem += arrived_at;
по-позиционные плечи прибытия в server/materials/; новые actions mark/unmark (item + пакетные). Статус
«частично» — производный (enum ShipmentStatus НЕ менять — он общий с отгрузками продукции). Перед кодом —
DOMAIN.md §3 (доставка, транзит -2, баланс=Σ движений), CLAUDE.md (миграцию обсудить — ОБСУЖДЕНО, см. ниже;
логика в server/, ChangeLog в транзакции, requireRole). Prisma migrate/Next — context7. Движок доставки —
параметризован по item_kind (E1): плечо строится per-item по kind+FK, поэтому смешанный груз обрабатывается сам.

МИГРАЦИЯ (обсуждена, разрешена):
- MaterialShipmentItem += arrived_at DateTime? (nullable; null = не прибыло).
- Бэкфилл существующих: для рейсов со status="arrived" проставить items.arrived_at = trip.arrival_date
  (или now() если arrival_date null). (БД тестовая — допустим и вайп, но бэкфилл чище.)
- Имя миграции: d3_2_item_arrived_at.

1) server/materials/movements.ts — выделить ПО-ПОЗИЦИОННЫЕ плечи прибытия (из текущего пакетного
   applyOutboundArrivedLeg):
   - applyArrivedLegForItem(tx, item, shipmentId, date): плечо -2 → фермер для ОДНОЙ позиции (kind+FK по
     item_kind, qty позиции). Идемпотентность: если плечо этой позиции уже есть — не дублировать.
   - revertArrivedLegForItem(tx, item, shipmentId): нетто-сторно плеча прибытия ОДНОЙ позиции
     (фермер → -2), ключ как раньше `${kind}:${itemId}:${farmerId}`.
   - applyOutboundArrivedLeg (пакетный) переписать как цикл по applyArrivedLegForItem для НЕ прибывших
     позиций (чтобы пакет и поштучно использовали один примитив). Отправку (applyOutboundDeliveryLeg) и
     revertDeliveryLeg НЕ трогать.

2) server/materials/actions.ts — заменить рейс-уровневые arrive/revertToSent на mark/unmark:
   - statusFromItems(items): "arrived" если у всех arrived_at != null; иначе "sent" (если рейс отправлен).
   - markItemArrived(itemId): requireRole("admin","operator"). Найти позицию+рейс; рейс должен быть sent
     или частично (не planned). Если уже arrived_at — no-op. $transaction: applyArrivedLegForItem +
     set item.arrived_at=now() + пересчёт trip.status=statusFromItems + logChange. revalidatePath.
   - unmarkItemArrived(itemId): requireRole("admin"). $transaction: revertArrivedLegForItem +
     item.arrived_at=null + trip.status=statusFromItems (→ sent) + logChange. revalidatePath.
   - markAllArrived(tripId) [powers кнопку «Принять»]: requireRole("admin","operator"). Рейс sent/частично.
     $transaction: для всех НЕ прибывших позиций applyArrivedLegForItem + arrived_at=now(); status="arrived";
     logChange (сколько отмечено). revalidatePath. (Эквивалент старого arrive, идемпотентно по позициям.)
   - unmarkAllArrived(tripId) [powers «снять прибытие со всех», заменяет revertMaterialToSent]:
     requireRole("admin"). $transaction: revertArrivedLegForItem по всем прибывшим + arrived_at=null;
     status="sent"; logChange. revalidatePath.
   - sendMaterialShipment — без изменений (whole-trip, planned→sent). revertMaterialToPlanned — оставить,
     но ГАРД: разрешить только если НИ у одной позиции нет arrived_at (иначе error «сначала снимите прибытие»).
   - УДАЛИТЬ старые arriveMaterialShipment и revertMaterialToSent (заменены mark/unmark).

3) server/materials/feed-loader.ts — отдавать на позицию arrived_at; на рейс — производное:
   arrivedCount/totalCount и derivedStatus: "planned"|"sent"|"partial"|"arrived" ("partial" = sent &&
   0<arrivedCount<total). status в БД остаётся planned/sent/arrived; "partial" — только для UI.

ОГРАНИЧЕНИЯ:
- enum ShipmentStatus НЕ менять. Отправка остаётся whole-trip. Движок отправки/сторно отправки не трогать.
- Балансы не хранить; плечи — по item_kind (тара и ингредиент одинаково). Доки/TASKS — не трогать.
- UI (карточка рейса, кнопки) — это D3-2b; здесь только сервер + loader.

БД ТЕСТОВАЯ (правило проекта): данные одноразовые; миграция может пересоздавать данные; проверки seed/rolled-back.

ПРОВЕРКА (показать):
A. РЕГРЕСС полного цикла (должен остаться зелёным):
   - смешанный рейс (фермер1: ящики 300; фермер2: соль 200 кг): send → завод −300ящ −200кг, -2 +300 +200;
   - markAllArrived → оба фермера получили; status=arrived; повтор markAllArrived → дублей нет;
   - unmarkAllArrived → -2 ↔ фермеры сторно; status=sent; revertToPlanned → -2 → завод; status=planned.
B. ПО-ПОЗИЦИОННО:
   - send; markItemArrived(позиция фермер1) → фермер1 +300; status=sent (derivedStatus "partial",
     arrivedCount=1/2); markItemArrived(фермер2) → status=arrived;
   - unmarkItemArrived(фермер2) → status=sent (partial); сторно только его плеча.
C. ГАРД отката: при ≥1 прибывшей позиции revertToPlanned → отклонён; после снятия всех прибытий → проходит.
D. RBAC: mark — admin/operator; unmark/revert — admin.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью D3-2a
1. Миграция `arrived_at DateTime?` + бэкфилл arrived-рейсов; enum ShipmentStatus не тронут.
2. `movements.ts`: per-item applyArrivedLegForItem/revertArrivedLegForItem; пакетный = цикл по примитиву; идемпотентность per-item.
3. `actions.ts`: markItemArrived/unmarkItemArrived/markAllArrived/unmarkAllArrived; statusFromItems пересчитывает sent↔arrived; старые arrive/revertToSent удалены.
4. revertToPlanned с гардом «нет прибывших»; send/сторно отправки не тронуты.
5. feed-loader: per-item arrived_at + derived partial (arrivedCount/total, derivedStatus "partial").
6. Регресс полного цикла (тара+ингредиент+смешанный) зелёный; по-позиционные пути верны; RBAC по действиям.

---

## После D3-2a — D3-2b (UI)
Карточка рейса: на позицию — переключатель «прибыло» (markItemArrived/unmarkItemArrived) с отметкой времени;
рейс-уровневая кнопка «Принять» (markAllArrived) + «Снять прибытие со всех» (unmarkAllArrived); бейдж
«частично N/M прибыло» (derivedStatus "partial", заливка sent, без нового цвета).
