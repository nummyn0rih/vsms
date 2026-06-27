# PROMPTS — transfer-1: farmer→farmer перенос (миграция + движок + сервер)

> Срез 1/2. Перенос остатков между фермерами = та же доставка, но origin = фермер (не завод) и транзит `-3`.
> Требует МИГРАЦИИ `MaterialShipment += source_farmer_id`. Переиспользует D3/D3-2-движок и прибытие.
> Решения: 1A (source_farmer_id) · 2A (новый транзит -3) · 3A (тот же MaterialShipment). Дефолт = доставка
> с завода (source_farmer_id=null, 95% кейсов); transfer — 5%.

## Стейт-машина (параллель доставке)
```
planned ─[send]→ sent: origin/good → транзит (все позиции)
sent ─[markItemArrived]→ позиция: транзит → фермер-получатель (per-item, D3-2 как есть)
sent ─[revertToPlanned]→ транзит → origin (гард: нет прибывших)
```
origin = source_farmer_id ?? FACTORY(0); транзит = source_farmer_id!=null ? -3 : -2.

---

## ПРОМПТ — transfer-1 (Claude Code)

```text
Задача transfer-1 (VSMS): farmer→farmer перенос остатков. Та же MaterialShipment-машина, но источник —
фермер (не только завод) и свой транзит -3. Миграция MaterialShipment += source_farmer_id. Перед кодом —
DOMAIN.md §3 (доставка/транзит/баланс=Σ движений; позиционное прибытие D3-2), CLAUDE.md (миграцию обсудить
— ОБСУЖДЕНО, см. ниже; логика в server/, ChangeLog в транзакции, requireRole, единый движок). Prisma migrate/
Next — context7. Движок доставки уже per-item и per-kind (D3-2/E1) — обобщаем только origin+транзит.

МИГРАЦИЯ (обсуждена, разрешена):
- MaterialShipment += source_farmer_id Int? (null = доставка с завода; заполнено = transfer от этого фермера)
  + relation на Farmer (onDelete: Restrict). Бэкфилл существующих = null. Имя: transfer_source_farmer.

КОНСТАНТА:
- server/shipments/packaging.ts += export const TRANSFER_TRANSIT = -3; // в пути между фермерами
  (рядом с FACTORY_LOCATION_ID=0, TRANSIT_TO_FACTORY=-1, TRANSIT_TO_FARMER=-2).

1) server/materials/movements.ts — обобщить плечи по origin+transit (читать из рейса, не хардкодить):
   - Ввести для рейса контекст { origin, transit }: origin = source_farmer_id ?? FACTORY_LOCATION_ID;
     transit = source_farmer_id != null ? TRANSFER_TRANSIT : TRANSIT_TO_FARMER.
   - applyOutboundDeliveryLeg (send): from_location_id = origin (вместо хардкода FACTORY),
     to_location_id = transit (вместо TRANSIT_TO_FARMER). Гард идемпотентности — по (origin↔transit) рейса.
   - applyArrivedLegForItem / батч / revertArrivedLegForItem: фильтр и плечо использовать transit РЕЙСА
     (вместо хардкода TRANSIT_TO_FARMER). Получатель = i.farmer_id (>0), как сейчас.
   - revertDeliveryLeg (sent→planned): между transit и origin рейса (вместо -2↔0).
   - Сигнатуры helper'ов — принять origin/transit (или объект рейса) параметром. Логику нетто/ключей
     (kind:itemId[:farmerId]) и идемпотентность НЕ менять по сути — только источник констант.

2) server/materials/schema.ts — source_farmer_id?: int (optional). superRefine:
   - если source_farmer_id задан (transfer): КАЖДАЯ позиция farmer_id (получатель) != source_farmer_id
     (запрет self-transfer) → ошибка на позиции; source_farmer_id должен быть > 0.
   - запрет дублей (farmer, kind, fk) — оставить как есть.

3) server/materials/actions.ts:
   - create/update: принимать source_farmer_id (null=доставка). Проверить, что source — существующий
     фермер (active ИЛИ архивный — перенос ОТ архивного разрешён); получатели — фермеры (>0).
   - send/markItem*/markAll*/unmark*/revertToPlanned: вычислять { origin, transit } из рейса и передавать
     в helper'ы movements.ts. Прочую логику (статус-пересчёт, гарды, RBAC) НЕ менять.
   - Гард отката sent→planned (нет прибывших) — без изменений.

4) server/materials/feed.ts + feed-loader.ts: на рейс отдавать sourceFarmerId (null|id) и sourceLabel
   («Завод» | имя фермера-источника) для UI (карточка/фильтр). Прочее не трогать.

ОГРАНИЧЕНИЯ:
- enum ShipmentStatus НЕ менять. Доставка (source_farmer_id=null) — поведение БЕЗ ИЗМЕНЕНИЙ (origin=0, транзит -2).
- Балансы не хранить; плечи per-kind (тара/ингредиент одинаково). Self-transfer запрещён.
- UI формы/карточки/дашборд транзита -3 — это transfer-2; здесь только миграция+движок+сервер+feed.
- Доки/TASKS — не трогать.

БД ТЕСТОВАЯ (правило проекта): миграция может пересоздавать данные; проверки seed/rolled-back.

ПРОВЕРКА (показать):
A. РЕГРЕСС ДОСТАВКИ (зелёный): рейс с завода (source_farmer_id=null), смешанный груз — send (0→-2),
   markAll/по-позиционно (-2→фермеры), unmark*, revertToPlanned (-2→0). Балансы как раньше.
B. TRANSFER: рейс source_farmer_id=A, позиция (получатель B, ящики 100): send → A/good −100, -3 +100;
   markItem(B) → -3 → B +100; A −100, B +100, завод не тронут; повтор → дублей нет.
C. TRANSFER откаты: unmarkItem → сторно (B→-3); revertToPlanned (нет прибывших) → -3 → A.
   При прибывшей позиции revertToPlanned отклонён.
D. ВАЛИДАЦИЯ: получатель == источник (B==A) → zod-ошибка; источник архивный → перенос разрешён;
   смешанный transfer (тара+ингредиент) → плечи по kind корректны.
E. RBAC: send/markAll/markItem — admin|operator; unmark*/revert — admin.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью transfer-1
1. Миграция `source_farmer_id Int?` + relation, бэкфилл null; enum не тронут; константа `-3` добавлена.
2. movements.ts: плечи читают origin+transit из рейса; доставка (null) — поведение неизменно; transfer — origin=A, транзит -3.
3. schema.ts: self-transfer запрещён (получатель≠источник), source>0; дубли позиций по-прежнему режутся.
4. actions.ts: source — существующий фермер (вкл. архивного); { origin, transit } прокинуты в helper'ы; статус/гарды/RBAC не тронуты.
5. feed: sourceFarmerId + sourceLabel отдаются.
6. Регресс доставки (тара+ингредиент+смешанный, send/прибытие/откаты) зелёный; transfer-цикл и валидация верны.

---

## После transfer-1 — transfer-2 (UI)
Форма рейса: выбор источника (Завод / Фермер), **дефолт = Завод (95% кейсов)**; при выборе фермера —
получатели из списка ≠ источник. Карточка: «Источник → получатели» (Завод или Фермер A). Дашборды тары и
ингредиентов: транзит-строка `-3` «в пути между фермерами» (рядом с `-2`). Затем — закрытие transfer (доки).
