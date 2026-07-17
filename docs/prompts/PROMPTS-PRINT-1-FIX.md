# PROMPTS — print-1-fix: консолидация агрегаций (брак + суммы отгрузок)

> Самодостаточный фикс-промпт (можно запускать в НОВОМ чате Claude Code без прочего контекста).
> print-1 уже реализован (print-роуты `app/print/shipments`, `app/print/acceptance`). Две пост-ревью правки —
> убрать дублирование агрегаций (правило проекта: «не дублировать формулы»). Без миграции, read-only, поведение
> печатных листов не меняется — только источник расчётов.

## ПРОМПТ — print-1-fix (Claude Code)

```text
Задача print-1-fix (VSMS): убрать дублирование двух агрегаций в печатных формах. Без миграции, read-only,
визуальный результат листов НЕ меняется — только переиспользуем существующие/выделенные чистые функции.

ФАЙЛЫ
- app/print/acceptance/page.tsx (инлайн-расчёт средневзвешенного брака, ~стр. 73–77)
- server/analytics/dashboard.ts (та же формула avgBrakPct, ~стр. 198–247)
- server/acceptance/board.ts (сюда вынести общую чистую функцию)
- app/print/shipments/page.tsx (локальные суммы actualKg/acceptedKg, ~стр. 44–50)
- server/shipments/feed.ts (уже есть чистые weekSummary/daySummary/summarizeCultures)

ФИКС 1 (medium) — общий средневзвешенный брак
- Выделить ЧИСТУЮ функцию `computeWeightedBrak(rows)` → % (Σ actual×brak% / Σ actual; пустой набор → 0),
  положить в server/acceptance/board.ts (или соседний server/acceptance-модуль), экспортировать.
  Сигнатура — по фактической форме данных обоих вызовов (напр. `{ actualKg: number; brakPercent: number }[]`);
  привести оба call-site к ней.
- Переиспользовать в:
  * server/analytics/dashboard.ts — заменить инлайн avgBrakPct на вызов computeWeightedBrak.
  * app/print/acceptance/page.tsx — заменить инлайн-расчёт (стр. 73–77) на вызов той же функции.
- Значения не должны измениться (та же формула). Округление/формат оставить как есть на месте показа.

ФИКС 2 (low) — суммы в печати отгрузок из feed-хелперов
- app/print/shipments/page.tsx: подытоги дня/недели брать из существующих weekSummary/daySummary (server/
  shipments/feed.ts), а не суммировать actualKg/acceptedKg локально в компоненте. Если нужного поля в хелпере
  нет — расширить хелпер в feed.ts (там же, где парные подытоги), а не считать в page. Результаты идентичны.

ОГРАНИЧЕНИЯ
- Только перечисленные файлы (+ при необходимости feed.ts). Без миграции, без новых зависимостей, read-only.
- Печатные листы визуально не меняются; статусы/деньги/ориентация не трогать.

ПРОВЕРКА (показать)
- npm run lint + npx tsc --noEmit + npm run build — зелёные.
- Средний брак в Аналитике (/analytics) и в печатной Приёмке (/print/acceptance) считаются ОДНОЙ функцией
  computeWeightedBrak; числа не изменились относительно до-фикса.
- Подытоги/итоги печатных Отгрузок берутся из weekSummary/daySummary; значения совпадают с прежними.
- Единственное определение формулы брака в репо (grep: нет второго инлайна).
В конце предложи git-коммит одной строкой (напр. `refactor(print): консолидация weighted-brak + feed-подытогов`).
```

### Чеклист ревью print-1-fix
1. `computeWeightedBrak` — одна чистая функция в server/acceptance; используется и в dashboard.ts (avgBrakPct), и в print/acceptance; инлайн-дубля нет.
2. Печать отгрузок — подытоги из feed-хелперов (weekSummary/daySummary), не локальные суммы.
3. Значения не изменились; листы визуально те же; без миграции; lint/tsc/build зелёные.
