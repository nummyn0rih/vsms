# PROMPTS — driver-phone-optional: телефон водителя необязателен

> Мелкая правка из бэклога: не всегда известен номер водителя, но завести его в справочник нужно.
> **Миграции НЕТ** — `Driver.phone` в схеме уже `String?`; обязательность держит только zod.

## Что известно по коду

| Место | Сейчас |
|---|---|
| `prisma/schema.prisma` → `model Driver` | `phone String?` — **уже nullable, миграция не нужна** |
| `server/drivers/schema.ts` | `phone: phoneSchema` → `.min(1, "Телефон обязателен")` — источник обязательности |
| `server/drivers/schema.ts` → `DriverRow` | `phone: string` — тип надо ослабить до `string \| null` |
| `lib/validators.ts` → `phoneSchema` | **общий с Farmer** — глобально ослаблять НЕЛЬЗЯ |

**Места отрисовки `tel:` для водителя (5):** `shipments/_components/DriverModal.tsx:93` ·
`shipments/_components/MobileMachineCard.tsx:74` · `acceptance/_components/MobileAcceptedCard.tsx:186` ·
`acceptance/_components/MobileAcceptanceCard.tsx:62` · `reference/drivers/_components/DriversTable.tsx:124` ·
`reference/drivers/_components/MobileDriversList.tsx:70`.
Телефон водителя фигурирует также в `MachineRow`, `AcceptanceMachine`, `AcceptedMachine`,
`MaterialTripCard`, `drivers/page.tsx` — проверить каждое.

⚠ `tel:` у **фермеров** (`FarmersTable`, `MainPanel`, `FarmerCardHeader`) — **не трогать**, там телефон
остаётся обязательным.

## Решение

| Развилка | Выбор |
|---|---|
| Как ослабить валидацию | Отдельный **`optionalPhoneSchema`** в `lib/validators.ts` (пустая строка → `null`, непустая — прежние правила). Общий `phoneSchema` не менять — от него зависит Farmer |
| Пустое значение в БД | **`null`**, не пустая строка — чтобы «нет номера» проверялось одним способом |
| UI без номера | Текст «номер не указан», приглушённый, **без ссылки `tel:`** и без вида кликабельного элемента. Кнопка звонка на мобильных — не рендерится вовсе |

---

## ПРОМПТ — driver-phone-optional (Claude Code)

```text
Задача driver-phone-optional (VSMS): сделать телефон водителя необязательным и корректно показывать его
отсутствие. Миграция: НЕТ (Driver.phone уже String?). Телефон ФЕРМЕРА остаётся обязательным — не трогать.

Перед кодом прочитать: lib/validators.ts (phoneSchema, normalizePhone, formatPhone),
server/drivers/schema.ts (driverSchema, DriverRow), server/drivers/actions.ts,
app/(app)/reference/drivers/_components/{DriverFormDialog,DriversTable,MobileDriversList}.tsx,
app/(app)/shipments/_components/{DriverModal,MobileMachineCard,MachineRow}.tsx,
app/(app)/acceptance/_components/{MobileAcceptanceCard,MobileAcceptedCard,AcceptanceMachine,AcceptedMachine}.tsx,
app/(app)/materials/_components/MaterialTripCard.tsx.
CLAUDE.md — эталон валидаторов (общие в lib/validators.ts, не дублировать).

1) lib/validators.ts — добавить optionalPhoneSchema:
   пустая строка/undefined → null; непустая → те же правила, что phoneSchema (символы, 10–15 цифр).
   ⚠ Существующий phoneSchema НЕ менять: он общий с Farmer, где телефон обязателен.
2) server/drivers/schema.ts:
   - driverSchema.phone → optionalPhoneSchema;
   - DriverRow.phone: string → string | null.
3) server/drivers/actions.ts — сохранять null при пустом вводе (не пустую строку). Остальное (RBAC,
   $transaction, logChange) без изменений; в ChangeLog пустое значение писать как null.
4) DriverFormDialog: снять пометку обязательности с поля телефона, подпись вида «Телефон (необязательно)».
   Валидация формы больше не блокирует сохранение без номера.
5) ВСЕ места показа телефона водителя: если phone == null (или пусто) — НЕ рендерить ссылку tel: и не рисовать
   элемент как кликабельный. Вместо этого приглушённый текст «номер не указан».
   - DriversTable, MobileDriversList — в строке справочника;
   - DriverModal (десктоп) — вместо ссылки текст; модалка открывается как обычно;
   - MobileMachineCard, MobileAcceptanceCard, MobileAcceptedCard — кнопку звонка НЕ рендерить вовсе
     (не рисовать disabled-кнопку: нажимать всё равно не на что);
   - MachineRow, AcceptanceMachine, AcceptedMachine, MaterialTripCard — проверить и привести к тому же правилу.
   Стиль «нет данных» взять существующий (в проекте уже есть паттерн вида «водитель не назначен» —
   переиспользовать класс/подачу, новых стилей не заводить).
6) Юнит-тесты в lib/validators.test.ts: optionalPhoneSchema — пусто → null; валидный номер → проходит;
   мусор → ошибка. Существующие тесты phoneSchema не менять.

ОГРАНИЧЕНИЯ
- Не менять схему БД и не заводить миграцию.
- Не ослаблять телефон ФЕРМЕРА (FarmersTable, MainPanel, FarmerCardHeader — не трогать).
- Не дублировать валидатор: optionalPhoneSchema живёт в lib/validators.ts.
- Не хранить пустую строку вместо null.
- RBAC и logChange — как раньше.

ПРОВЕРКА (показать)
- Создание и правка водителя БЕЗ номера проходят; в БД phone = NULL (показать строку).
- Водитель С номером: везде работает как раньше, ссылка tel: кликабельна.
- Водитель БЕЗ номера: во всех перечисленных местах — «номер не указан», ссылки нет, на мобильных кнопки
  звонка нет; вёрстка не ломается.
- Телефон фермера по-прежнему обязателен (попытка сохранить фермера без телефона отклоняется).
- npm run test зелёный (+ новые кейсы); lint/tsc/build зелёные.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью
1. `optionalPhoneSchema` — в `lib/validators.ts`, `phoneSchema` не изменён; фермер не задет.
2. `Driver.phone` пишется `null`, не пустой строкой; `DriverRow.phone` — `string | null`.
3. Все места показа обработаны (6 `tel:` + карточки машин/приёмки/материалов); нигде нет ссылки на пустой номер.
4. На мобильных кнопка звонка не рендерится (а не disabled).
5. Стиль «номер не указан» переиспользует существующий паттерн «нет данных».
6. Тесты/lint/tsc/build зелёные; миграции нет.
