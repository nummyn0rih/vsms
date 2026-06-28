# PROMPTS — acceptance auto-date: фактическая дата прибытия на приёмке

> Закрыть пробел: `arrival_date` фиксируется только при создании отгрузки (отправление ±2) и больше не
> обновляется → плановая дата молча выдаётся за фактическую. Дать запись реальной даты прибытия:
> явно (диалог + умный дефолт) и авто (молча «сегодня»). **Без миграции** — `arrival_date`/`departure_date`
> уже в схеме.

## Решения (зафиксированы с пользователем)
| Путь | Поведение |
|---|---|
| **Явная отметка** (`markArrived`, кнопка «Отметить прибытие») | Диалог из двух вариантов «Дата из отгрузки: {план}» / «Сегодня: {today}». **Умный дефолт:** плановая `arrival_date` в прошлом (отгрузка заведена задним числом) → дефолт «дата из отгрузки» (защита от молчаливой подмены); иначе → «сегодня». Если план `null` → только «Сегодня». |
| **Авто** (`setActualWeight`, первая перевеска `sent`→`arrived`) | `arrival_date = сегодня` молча (перевеска на воротах = машина приехала). Диалога нет. |
| **Рабочий день / departure ≤ arrival** | Фактическую дату НЕ валидируем по BR-11/BR-12 — факт есть факт. BR-11/12 остаются правилами планирования (создание/правка отгрузки), не приёмки. |

Без снимков, без новых хранимых величин. RBAC operator/admin (как сейчас). Каждое изменение `arrival_date` → `logChange` (old→new) в той же транзакции.

---

## ПРОМПТ — acceptance auto-date (Claude Code)

```text
Задача acceptance auto-date (VSMS): на приёмке записывать ФАКТИЧЕСКУЮ дату прибытия в Shipment.arrival_date
вместо молчаливо стоящей плановой. Без миграции. Перед кодом прочитать:
- server/acceptance/actions.ts — markArrived (sent→arrived без веса, BR-24б) и setActualWeight (авто sent→arrived
  на первой перевеске, BR-24а); обе сейчас arrival_date НЕ трогают.
- server/acceptance/schema.ts — markArrivedSchema, типы AcceptanceMachine (уже несёт arrivalDate, departureDate).
- server/shipments — как arrival_date ПАРСИТСЯ и хранится при создании/правке отгрузки (date-only); повторить
  тот же способ для консистентности (не плодить свой формат даты).
- app/(app)/acceptance/_components/AcceptanceActions.tsx (MarkArrivedButton) и AcceptanceBoard.tsx (где кнопка
  рендерится; машина зоны 1 уже содержит arrivalDate).
- DOMAIN.md §1 (три базы веса — тара по плановому, дата прибытия их НЕ меняет), §3 (плечо прибытия -1→завод),
  BR-11/BR-12/BR-24. Next/Prisma API — context7.

СЕРВЕР
1) server/acceptance/schema.ts — markArrivedSchema += arrivalDate (ISO 'YYYY-MM-DD', опционально):
   z.string().date().optional(). Опционально ради идемпотентности/обратной совместимости.

2) server/acceptance/actions.ts → markArrived({ shipmentId, arrivalDate? }):
   - В переходе sent→arrived (когда статус реально меняется): если arrivalDate передан — распарсить в date-only
     ТЕМ ЖЕ способом, что server/shipments при создании, и записать shipment.arrival_date; logChange
     (entity Shipment, field "arrival_date", old=прежняя дата, new=выбранная) в той же $transaction.
   - Тара-плечо (applyInboundArrivedTareLeg) и остальное — без изменений.
   - Идемпотентность: если машина уже arrived — no-op как сейчас, arrival_date НЕ трогать (повторный вызов
     не перезаписывает дату; правка даты принятой машины — вне этой задачи).
   - arrivalDate НЕ передан → arrival_date не менять (старое поведение).
   - НЕ валидировать дату по рабочему дню / departure≤arrival (решение: факт допустим в любой день).

3) server/acceptance/actions.ts → setActualWeight: в существующей ветке isFirstWeight && status==="sent"
   (та, что переводит в arrived и ставит плечо прибытия) ДОПОЛНИТЕЛЬНО:
   - shipment.arrival_date = сегодня (date-only, тем же способом, что server/shipments; локальная дата завода,
     без TZ-сдвига) — в том же update/транзакции.
   - logChange (field "arrival_date", old→"сегодня"). Только на самом переходе (isFirstWeight), не на каждом
     сохранении веса.

UI
4) AcceptanceActions.tsx (MarkArrivedButton): по клику открыть компактный shadcn Dialog с выбором даты:
   - Два варианта (radio или две кнопки): «Дата из отгрузки: {planned, формат как в ленте}» и «Сегодня: {today}».
   - Умный дефолт: planned != null && planned < сегодня(ISO) → выбран «Дата из отгрузки»; иначе «Сегодня».
   - planned == null → показать только «Сегодня».
   - Подтверждение → markArrived({ shipmentId, arrivalDate: выбранное 'YYYY-MM-DD' }). После успеха
     router.refresh(); ошибки из ActionResult в toast. busy-стейт на время запроса.
   - Новый проп arrivalDate?: string | null (плановая дата машины).

5) AcceptanceBoard.tsx — пробросить machine.arrivalDate (плановую) в MarkArrivedButton. Других данных не нужно
   (today считается на клиенте).

ОГРАНИЧЕНИЯ
- Без миграции / изменения схемы. Балансы/принятый вес — не хранить (не трогаем). accepted_weight_kg / brak_weight_kg
  — НЕ писать. RBAC operator/admin на сервере (requireRole) и клиенте. Доки/TASKS — не трогать (обновит PM).
- arrival_date — единственное новое поведение; статус-машина, тара-плечи, перевеска — без изменений.

БД ТЕСТОВАЯ: проверки seed/rolled-back.

ПРОВЕРКА (показать)
- Отгрузка задним числом (planned arrival_date в прошлом): «Отметить прибытие» → диалог по умолчанию выбирает
  «Дата из отгрузки»; выбор «Сегодня» → arrival_date=today; выбор «Дата из отгрузки» → дата не меняется.
  ChangeLog содержит запись arrival_date.
- Нормальная отгрузка (planned сегодня/в будущем): диалог по умолчанию «Сегодня».
- Авто-путь: сохранить первый actual_weight на машине sent → status=arrived + arrival_date=today (молча) +
  плечо прибытия + ChangeLog (status, movements, arrival_date). Второй вес той же машины arrival_date НЕ меняет.
- Идемпотентность: markArrived на уже arrived → ok, дата не перезаписана.
- Вид «План» (BR-22): после смены arrival_date вклад машины в прогресс переезжает на фактический день прибытия.
- RBAC: user (read-only) не может отметить прибытие; сервер отклоняет.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью acceptance auto-date
1. `markArrivedSchema` += `arrivalDate` (ISO date, optional); парсинг даты — как в `server/shipments` (date-only, без TZ-сдвига).
2. `markArrived`: пишет `arrival_date` только на реальном переходе sent→arrived при переданном `arrivalDate`; idempotent no-op на уже `arrived`; `logChange` в той же транзакции; тара-плечо не тронуто.
3. `setActualWeight`: в ветке `isFirstWeight && sent` ставит `arrival_date=today` молча + `logChange`; на последующих весах дату не трогает.
4. UI: диалог двух вариантов, умный дефолт (план в прошлом → «дата из отгрузки»), `null`-план → только «Сегодня»; проп проброшен из `AcceptanceBoard`.
5. Без миграции; `accepted_weight_kg`/`brak_weight_kg` не пишутся; RBAC сервер+клиент; BR-11/12 к фактической дате НЕ применяются.

---

## После задачи — обновление памяти (зона PM, не Claude Code)
- TASKS.md: `[ ] acceptance auto-date` → `[x]` (раздел «Бэклог / следующее»).
- CONTEXT-HANDOFF.md: убрать из ACTIVE RISKS/NEXT TASK; PROJECT STATE += acceptance auto-date; добавить в
  SESSION SUMMARY/прецеденты. При необходимости — BR-уточнение в DOMAIN (фактическая дата прибытия пишется на
  приёмке; BR-11/12 — только планирование). Затем — переход к V1.1.
