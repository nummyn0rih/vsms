# PROMPTS — cleanup-deprecated-columns: снос колонок-снимков

> Снимаем две мёртвые колонки-снимка перед прод-выкатом, чтобы **первая прод-схема была чистой**:
> `ShipmentItem.accepted_weight_kg` и `AcceptanceAct.brak_weight_kg`. Обе — наследие ранней модели (снимок
> результата приёмки); с C3 принятый вес и брак **вычисляются на лету** (`computeAcceptedKg`/`computeWeightedBrak`),
> колонки не пишутся и не читаются. **Есть миграция** (изменение схемы — согласовано с пользователем).

## Обоснование сноса (проверено грепом по репо, до спеки)

| Проверка | Результат |
|---|---|
| Записи/чтения в `server/`, `app/`, `lib/`, `components/` | **Нет.** Единственное упоминание — комментарий в `server/contracts/execution.ts` (поясняет, что колонка мертва). |
| `prisma/seed.ts`, `scripts/` | Нет упоминаний. |
| Raw SQL (`$queryRaw`/`$executeRaw`) | Нет. Найденные raw — про `max(code)`, к колонкам не относятся. |
| Nullability | Обе `Decimal?` **nullable** → drop без бэкфилла/дефолтов, данные не теряются (их и нет). |
| Прод | Прод-БД ещё НЕ создана → первый `migrate deploy` прогонит цепочку и придёт к чистой схеме. Data-preserving-требование к проду ещё не действует. |

## Решения (зафиксированы)

| Развилка | Выбор |
|---|---|
| Момент | **Сейчас, до прод-выката** — пока БД можно свободно менять (dev-ветка одноразовая). После прода это был бы деструктивный прод-релиз с бэкапом. |
| Объём | **Только эти две колонки.** Никаких «заодно» — прочие поля схемы не трогать. |
| Имя миграции | `cleanup_deprecated_snapshot_columns`. |
| DOMAIN/PRD/handoff | Правит **PM** после зелёного прогона (не Claude Code). |

---

## ПРОМПТ — cleanup-deprecated-columns (Claude Code)

```text
Задача cleanup-deprecated-columns (VSMS): удалить из схемы две мёртвые колонки-снимка —
ShipmentItem.accepted_weight_kg и AcceptanceAct.brak_weight_kg. Миграция: ДА, деструктивная по этим двум
колонкам (согласована). Делаем ДО прод-выката, пока dev-БД одноразовая.

Перед кодом прочитать:
- prisma/schema.prisma — модели ShipmentItem (~строка 324) и AcceptanceAct (~строка 342); обе колонки Decimal? nullable.
- server/contracts/execution.ts — комментарий вверху файла ссылается на accepted_weight_kg как на мёртвую колонку.
- server/acceptance/* (computeAcceptedKg, computeWeightedBrak) — источник истины расчёта; НЕ менять логику.
- CLAUDE.md §«Данные: dev vs прод» — правило dev/прод.
Prisma 7 (URL в prisma.config.ts, не в schema) — сверить по context7.

1) prisma/schema.prisma:
   - model ShipmentItem — удалить поле `accepted_weight_kg Decimal? @db.Decimal(12,3)` вместе с комментарием-снимком
     над ним («СНИМОК результата приёмки = actual × Σ(принятых %)…»).
   - model AcceptanceAct — удалить поле `brak_weight_kg Decimal? @db.Decimal(12,3)` вместе с его комментарием-снимком.
   - Больше в схеме НИЧЕГО не менять (ни порядок прочих полей, ни индексы, ни связи).
2) Миграция: npm run db:migrate (prisma migrate dev) с именем `cleanup_deprecated_snapshot_columns`.
   Ожидаемый SQL — два ALTER TABLE ... DROP COLUMN. Показать содержимое сгенерированного migration.sql.
   ⚠ Если Prisma предложит РЕСЕТ базы (drift) — НЕ применять вслепую: показать причину и остановиться, спросить.
   Ожидание: обычная аддитивно-деструктивная миграция без ресета.
3) npx prisma generate — перегенерировать клиент (типы Prisma больше не содержат этих полей).
4) server/contracts/execution.ts — актуализировать комментарий: колонки больше НЕ существует, принятый вес
   считается computeAcceptedKg (убрать формулировку «та колонка нигде не пишется» → «колонка снесена
   миграцией cleanup_deprecated_snapshot_columns»). Логику НЕ трогать.
5) Проверить, что в исходниках (server/, app/, lib/, components/, prisma/seed.ts, scripts/) не осталось
   ни одного обращения к accepted_weight_kg / brak_weight_kg. Греп показать. (lib/generated/prisma —
   сгенерированный клиент, gitignored, в счёт не идёт: он перегенерируется шагом 3.)

ОГРАНИЧЕНИЯ
- НИКАКОЙ другой правки схемы. Не переименовывать, не менять типы, не трогать StockMovement/индексы.
- Расчётную логику (computeAcceptedKg / computeWeightedBrak / getContractExecution) НЕ менять — снос колонок
  на неё не влияет (она их и не использовала).
- Балансы/стоимость/принятый вес по-прежнему НЕ хранить.
- Доки (DOMAIN.md/PRD.md/CONTEXT-HANDOFF.md/TASKS.md) НЕ трогать — это зона PM.

БД ТЕСТОВАЯ (dev-ветка Neon): данные одноразовые, ресет не требуется, но допустим при необходимости.

ПРОВЕРКА (показать)
- Содержимое сгенерированного migration.sql (два DROP COLUMN, ничего лишнего).
- npx prisma migrate status — чисто, дрейфа нет.
- tsc/lint/build зелёные (типы Prisma перегенерированы, битых ссылок нет).
- Смоук по контуру приёмки на dev-данных: создать/взять позицию → акт приёмки (simple и calibre) → проверить,
  что принятый вес, брак%, стоимость и выполнение контракта считаются как раньше (значения не изменились).
- Греп: 0 обращений к снесённым колонкам в исходниках.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью cleanup-deprecated-columns
1. В `schema.prisma` удалены ровно две колонки (+их комментарии); прочая схема не тронута.
2. Миграция `cleanup_deprecated_snapshot_columns` = два `DROP COLUMN`, применена без ресета; `migrate status` чист.
3. `prisma generate` прогнан; tsc/lint/build зелёные.
4. Расчёты приёмки/стоимости/выполнения не изменились (смоук simple + calibre).
5. В исходниках 0 обращений к снесённым колонкам; комментарий в `execution.ts` актуализирован.
6. Доки не тронуты (PM обновит после).

---

## После задачи — обновление памяти (зона PM, не Claude Code)
- `docs/DOMAIN.md`: таблица `ShipmentItem` (~113) — убрать `accepted_weight_kg (производное; DEPRECATED)`;
  блок ~234 «Колонки-снимки … DEPRECATED» — переписать в «снесены миграцией `cleanup_deprecated_snapshot_columns`».
- `docs/PRD.md` ~303: убрать `accepted_weight_kg (производное)` из состава `ShipmentItem`.
- `docs/CONTEXT-HANDOFF.md`: ACTIVE RISKS — снять пункт «⚠️ Схема↔код»; INVARIANTS — «никогда не писать
  accepted_weight_kg/brak_weight_kg» заменить на «принятый/брак — только вычислять» (колонок больше нет);
  CURRENT IMPLEMENTATION — убрать из «не реализовано».
- `docs/TASKS.md` ~243: cleanup-миграция → `[x]`.
- `docs/agents/invariant-review.md` ~19: правило про «не пишутся» → «колонок не существует; принятый/брак вычисляются».
