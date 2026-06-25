# PROMPTS — D3-2b: позиционное прибытие рейса (UI)

> D3-2, срез 2/2 (UI). Сервер готов (D3-2a/fix): `markItemArrived`/`unmarkItemArrived`/`markAllArrived`/
> `unmarkAllArrived`; feed отдаёт `item.arrivedAt`, `trip.derivedStatus` ("planned"|"sent"|"partial"|
> "arrived"), `arrivedCount`/`totalCount`. Задача — per-item отметка прибытия, бейдж «Частично N/M»,
> кнопка рейса «Принять» (markAllArrived) сохраняется. Решение 5: «частично» = заливка sent, без нового цвета.

## Что меняем
- Отображение статуса карточки — по `derivedStatus` (а не сырому `status`).
- В каждой строке позиции — контрол прибытия (отметить/снять + время).
- Футер: кнопка «Принять» (весь рейс, markAllArrived) остаётся; «Откатить в план» прятать, когда есть прибывшие.

---

## ПРОМПТ — D3-2b: UI позиционного прибытия (Claude Code)

```text
Задача D3-2b (VSMS): UI по-позиционного прибытия рейса. Сервер и feed готовы (D3-2a). Перед кодом —
текущие app/(app)/materials/_components/{MaterialTripCard.tsx, material-status.tsx, material-actions.tsx,
MaterialsFeed.tsx} и server/materials/feed.ts (типы MaterialTrip/MaterialFeedItem). shadcn/lucide — context7.
DESIGN-SYSTEM: заливки статусов, tabular-nums, Geist Mono для технических меток (время), без эмодзи-иконок.

ДАННЫЕ (уже есть): MaterialFeedItem.arrivedAt: string|null; MaterialTrip.derivedStatus:
"planned"|"sent"|"partial"|"arrived"; arrivedCount; totalCount; raw status: "planned"|"sent"|"arrived".
RBAC сервера: markItemArrived/markAllArrived = admin|operator; unmarkItemArrived/unmarkAllArrived/
revertToPlanned = admin.

1) material-status.tsx — добавить отображаемый статус "partial":
   - Тип DisplayStatus = MaterialStatus | "partial" (raw MaterialStatus оставить для фильтра/enum).
   - STATUS_STYLE += partial = ЗАЛИВКА sent (zone/bg/dot/color = как у sent), label "Частично".
   - StatusBadge принимать DisplayStatus + опц. { arrivedCount, totalCount }; при "partial" рендерить
     «Частично N/M» (N=arrivedCount, M=totalCount, tabular-nums). Прочие статусы — без счётчика.

2) material-actions.tsx — добавить per-item контрол прибытия (client):
   - ItemArrivedControl({ itemId, arrivedAt }): если arrivedAt==null → кнопка «Отметить прибытие»
     (RoleGate admin|operator) → markItemArrived(itemId). Если arrivedAt!=null → компактно: галочка
     (lucide Check) + время прибытия (Geist Mono, tabular-nums) + кнопка «снять» (RoleGate admin) →
     unmarkItemArrived(itemId). Состояние busy/disabled на время запроса; ошибку из ActionResult показать.
   - (опц.) переименовать ArriveMaterialButton label «Прибыл» → «Принять рейс» (action markAllArrived без
     изменений). RevertToSentButton (unmarkAllArrived) и RevertToPlannedButton — без изменений.

3) MaterialTripCard.tsx:
   - Зона/бейдж — по derivedStatus: zoneBg = STATUS_STYLE[trip.derivedStatus].zone; <StatusBadge
     status={trip.derivedStatus} arrivedCount={trip.arrivedCount} totalCount={trip.totalCount} />.
   - В строке позиции (grid) добавить контрол прибытия СПРАВА (4-я колонка или под количеством), видимый
     когда trip.status !== "planned" (позиция не может прибыть до отправки): <ItemArrivedControl
     itemId={it.id} arrivedAt={it.arrivedAt} />. На planned — контрола нет.
   - Футер-действия по derivedStatus:
     • planned → SendMaterialButton (как было).
     • sent | partial → ArriveMaterialButton («Принять рейс», markAllArrived, admin|operator) +
       RevertToPlannedButton (admin) ТОЛЬКО когда arrivedCount===0 (иначе скрыть — сервер всё равно
       отклонит при прибывших).
     • arrived → RevertToSentButton (unmarkAllArrived, admin).
   - Не ломать рендер позиций/футера-итогов (totalsByType/ingredientTotals) и иконки.

4) MaterialsFeed.tsx (опц., аккуратно): фильтр статуса — добавить «Частично» и фильтровать по derivedStatus
   (сейчас по сырому status). Если просто — добавить partial в STATUS_LABEL-список фильтра и сравнивать с
   t.derivedStatus. Если рискованно для дерева фильтрации — оставить как есть, не блокер.

ОГРАНИЧЕНИЯ:
- Только UI этих компонентов. Сервер/feed/движок/схему — НЕ трогать. Доки/TASKS — не трогать.
- «Частично» — заливка sent, без нового цвета в DESIGN-SYSTEM. Время — Geist Mono/tabular-nums; lucide; без эмодзи.
- RBAC контролов точно по серверу: отметить — admin|operator; снять/откат — admin.

БД ТЕСТОВАЯ: проверки через UI на seed-данных.

ПРОВЕРКА (через UI, показать):
- sent-рейс, 2 позиции: в каждой строке «Отметить прибытие»; бейдж «Отправлен», зона sent.
- отметить позицию 1 → строка 1: галочка + время + «снять»; бейдж «Частично 1/2», зона sent; «Откатить в
  план» скрыта (есть прибывшие); «Принять рейс» видна.
- отметить позицию 2 → бейдж «Прибыл», зона arrived; в строках — прибытие+время; «Снять прибытие со всех» видна.
- «снять» на позиции (admin) → назад «Частично 1/2» → sent; «Принять рейс» отмечает все разом.
- planned-рейс: per-item контролов нет; «Откатить в план» доступна (arrivedCount=0).
- RBAC: operator видит «Отметить прибытие»/«Принять рейс», но не «снять»/«откат»; не-операционные роли — read-only.
- регресс: рендер позиций, итоги по типам/ингредиентам, send/revert, фильтры — работают.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью D3-2b
1. material-status: "partial" = заливка sent, label «Частично»; StatusBadge рендерит «Частично N/M» (tabular-nums).
2. Карточка использует derivedStatus для зоны и бейджа; счётчик N/M верный.
3. Per-item контрол: arrivedAt==null → «Отметить прибытие» (admin|operator); иначе галочка+время+«снять» (admin); скрыт на planned.
4. Футер: «Принять рейс» (markAllArrived) на sent|partial; «Откатить в план» только при arrivedCount===0; «Снять со всех» на arrived.
5. RBAC контролов = серверу; время Geist Mono/tabular-nums; lucide; без эмодзи; новый цвет не добавлен.
6. Сервер/feed/движок/итоги не тронуты; регресс рендера/фильтров/действий зелёный.

---

## После D3-2b — закрытие D3-2
Батч-доков: DOMAIN §3 (позиционное прибытие: arrived_at, derived «partial», whole-trip send) + BR-29
(прибытие по-позиционно, статус «частично» производный, запрет дублей позиций); TASKS (D3-2 закрыт);
CONTEXT-HANDOFF (новое состояние, следующий кандидат: farmer→farmer transfer · B5 · широкий V1.1).
