# PROMPTS — mobile-2: приёмка на мобиле

> Второй срез мобильной версии v1. **Responsive**, тот же код/данные/server-actions; на узком экране (<md) —
> мобильная раскладка приёмки (зоны-сегмент, инлайн-ввод веса, полноэкранный акт с датой прибытия). Десктоп
> по поведению НЕ менять. **Без миграции.** RBAC operator/admin (как сейчас). Прототип: `mobile-v1.html` (экран 2 + акт).
> Шелл (app-bar/таб-бар/drawer) уже есть из mobile-1 — переиспользовать.

## Решения (зафиксированы)
| Развилка | Выбор |
|---|---|
| Раскладка | Зоны (BR-26) — **сегмент-вкладки** сверху: «Ожидают перевески» · «На приёмке» · «Принято» (счётчики). Ниже — карточки машин. |
| Ввод веса | Инлайн на позиции: крупное поле `inputmode=numeric`, шрифт ≥16px (прототип 22px), autosave (как десктоп `setActualWeight`). |
| Отметить прибытие | Кнопка → маленький **bottom-sheet** выбора даты (acceptance auto-date: «дата из отгрузки / сегодня», умный дефолт). |
| Акт | **Полноэкранный** диалог: факт вес + брак% + дата прибытия (picker, с подсказкой авто-даты) + «к оплате» + «Принять позицию». Тот же `saveAct`. |
| Данные/логика | Тот же `getAcceptanceBoard` + те же server-actions (`setActualWeight`/`markArrived`/`saveAct`/`revertAct`). НЕ дублировать мутации/расчёты. |
| Десктоп | `AcceptanceBoard` (md+) без изменений. |

---

## ПРОМПТ — mobile-2 (Claude Code)

```text
Задача mobile-2 (VSMS): мобильная раскладка приёмки на узком экране (<md). Responsive, те же данные и
server-actions, что десктоп. Десктоп по поведению НЕ менять. Миграция: НЕТ. RBAC operator/admin.

Перед кодом прочитать:
- docs/prototypes/mobile-v1.html — экран 2 (приёмка: зоны-сегмент, карточка, инлайн-вес, «Отметить прибытие»,
  «Акт») и фрейм акта (полноэкранный: вес/брак/дата/к оплате + подсказка авто-даты). Источник вёрстки.
- app/(app)/acceptance/_components/* — AcceptanceBoard (зоны), AcceptanceMachine (зоны 1/2), AcceptedMachine
  (зона 3), WeightInput (инлайн-вес, autosave), AcceptanceActDialog (форма акта), AcceptanceActions
  (MarkArrivedButton), ActButton. Логику переиспользовать.
- server/acceptance/* — actions: setActualWeight (autosave → авто sent→arrived), markArrived (+ arrivalDate,
  acceptance auto-date), act.ts saveAct/revertAct, board.ts getAcceptanceBoard, schema.ts (типы зон/акта).
- DOMAIN.md BR-13/BR-24/BR-25/BR-26 (зоны/переходы/приёмка позиционная), acceptance auto-date (BR-24 доп).
- DESIGN-SYSTEM.md (токены, статус-заливки); mobile-1 шелл (app-bar/таб-бар/drawer) — переиспользовать.

UI (мобиле, <md)
1) Новый MobileAcceptanceBoard (client, `md:hidden`), десктоп AcceptanceBoard — `hidden md:block`. Данные — тот
   же getAcceptanceBoard (из page.tsx). Зоны — сегмент-вкладки с счётчиками (Ожидают перевески/На приёмке/Принято),
   активная зона — клиентское состояние (или ?zone в URL, на выбор; неделя/URL-паттерн не ломать).
2) Карточка машины (зоны 1/2): шапка со статус-заливкой + код + даты + водитель с call-кнопкой (tel:, ≥44px);
   позиции столбиком. По позиции:
   - зона 1/2 без веса: инлайн-поле веса (`inputmode=numeric`, ≥16px), autosave через setActualWeight (как
     WeightInput). Первый вес у sent-машины авто-переводит в arrived (существующая логика).
   - «Отметить прибытие» (машина без перевески): кнопка → bottom-sheet выбора даты (acceptance auto-date:
     «дата из отгрузки»/«сегодня», умный дефолт — плановая в прошлом → «дата из отгрузки»), затем markArrived({shipmentId, arrivalDate}).
   - «Акт» на позиции arrived+: → полноэкранный MobileActDialog.
   - Бейдж «N/M взвешено · принято», «Частично принята» — производный (как десктоп).
3) MobileActDialog (полноэкранный): поля из AcceptanceActDialog (факт вес, брак%, для calibre — категории; дата
   прибытия picker + подсказка авто-даты; к оплате — расчёт как на десктопе), кнопки «Отмена»/«Принять позицию»
   (saveAct). Полноэкранно (fixed inset). Клавиатура — системная (numeric у веса/брака).
4) Зона 3 «Принято»: карточки-просмотр (факт · к оплате · № акта · калибр-чипы), откат акта (admin) как десктоп.

ОГРАНИЧЕНИЯ
- Без миграции/схемы. Переиспользовать server-actions и расчёты (setActualWeight/markArrived/saveAct/getAcceptanceBoard,
  computeAcceptedKg) — НЕ дублировать мутации/формулы. Десктоп AcceptanceBoard не трогать по поведению.
- RBAC operator/admin на сервере (существующий requireRole) + клиент. Тач-цели ≥44px; поля ввода ≥16px.
- Токены/статус-заливки — канон DESIGN-SYSTEM. localStorage нельзя. Доки/TASKS — PM.

БД ТЕСТОВАЯ: проверки seed/rolled-back для мутаций (autosave веса, markArrived, saveAct) + визуал на узком вьюпорте.

ПРОВЕРКА (показать)
- Узкий экран: зоны-сегмент со счётчиками; инлайн-вес autosave (sent→arrived); «Отметить прибытие» → sheet даты
  (умный дефолт) → markArrived; «Акт» → полноэкранный, saveAct принимает позицию; «Частично принята» и «N/M»;
  зона 3 просмотр + откат акта (admin).
- Широкий экран (md+): десктоп-приёмка БЕЗ изменений (регресс).
- acceptance auto-date: bottom-sheet даты работает (дата из отгрузки/сегодня); в акте picker даты с подсказкой.
- RBAC: user (read-only) не может вводить вес/акт; сервер отклоняет.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью mobile-2
1. Responsive: <md — MobileAcceptanceBoard (зоны-сегмент/карточки/инлайн-вес/акт); md+ — десктоп-приёмка без регресса.
2. Мутации/данные — те же server-actions (setActualWeight/markArrived/saveAct/getAcceptanceBoard), без дублей; acceptance auto-date (sheet даты + picker в акте).
3. Тач ≥44px; вес `inputmode=numeric` ≥16px; статус-заливки/токены из системы; акт полноэкранный.
4. RBAC operator/admin (сервер+клиент); user read-only.
5. Без миграции; десктоп не тронут; localStorage не используется.

---

## После задачи — обновление памяти (зона PM, не Claude Code)
- TASKS.md: mobile-2 (приёмка) → `[x]`; следующий — mobile-3 контакты водителей (`PROMPTS-MOBILE-3-DRIVERS.md`).
- CONTEXT-HANDOFF.md: CURRENT IMPLEMENTATION += мобильная приёмка; NEXT TASK → mobile-3 водители.
