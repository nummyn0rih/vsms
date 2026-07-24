# PROMPTS — mobile-acceptance-filters: фильтры в мобильной приёмке

> Десктопная приёмка уже фильтруется (Поставщик · Сырьё · поиск) через общий чистый модуль
> `server/acceptance/board-filter.ts`. Мобильная доска (`MobileAcceptanceBoard`) фильтров не имеет — показывает
> полный `board`. Переносим фильтры на мобиле через bottom-sheet (паттерн `MobileFilterSheet` из ленты),
> **переиспользуя тот же модуль**. Read-only, **без миграции, без сервера, без новых CSS** (классы sheet — глобальные).

## Решения (зафиксированы)

| Развилка | Выбор |
|---|---|
| Оси фильтра | **Поставщик · Сырьё · поиск** (№ машины / водитель). Оси «Статус» нет — на приёмке её роль играют зоны-сегменты (BR-26). |
| Компонент фильтрации | Общий чистый `server/acceptance/board-filter.ts` (`filterBoard`/`boardOptions`/`anyAcceptanceFilterActive`) — тот же, что десктоп и печать. НЕ дублировать, НЕ инлайнить. |
| UI-паттерн | Bottom-sheet, калька `app/(app)/shipments/_components/MobileFilterSheet.tsx`. Глобальные классы `.sheet`, `.ov-scrim`, `.sheet-*`, `.opt-chips`/`.opt-chip`, `.filter-btn`, `.fdot` (в `app/globals.css`) — переиспользовать, новых стилей не заводить. |
| Поиск | Входит в sheet (поле сверху body). `filterBoard` уже поддерживает `search` — параллелит десктоп. Осмысленно на машино-центричном экране. |
| Состояние | Клиентское (`useState<Set<number>>` + `search`), без localStorage. URL не трогаем (в мобильной приёмке в URL живёт только `?zone=` — оставить как есть). |
| Уровень фильтрации | По МАШИНЕ — уже реализовано в `filterBoard` (машина видна, если ∃ позиция с выбр. фермером И ∃ позиция с выбр. культурой И совпал поиск). Счётчики зон-табов — из отфильтрованного `view`. |
| Печать / Excel | В мобильный срез НЕ входят (мобиле — read-only полевой экран; на десктопе печать/экспорт уже есть). |

---

## ПРОМПТ — mobile-acceptance-filters (Claude Code)

```text
Задача mobile-acceptance-filters (VSMS): добавить фильтры (Поставщик · Сырьё · поиск) на МОБИЛЬНУЮ приёмку
через bottom-sheet, переиспользуя существующий чистый модуль фильтрации доски. Миграция: НЕТ. Сервер: НЕ менять.
Read-only (фильтр = вид, никаких мутаций). Не дублировать логику/стили.

Перед кодом прочитать:
- server/acceptance/board-filter.ts — ГОТОВЫЙ чистый модуль: filterBoard(board, {search, supplierSel, cultureSel}),
  boardOptions(board) -> {farmers: ComboOption[], cultures: ComboOption[]}, anyAcceptanceFilterActive(filters),
  тип AcceptanceFilters. Переиспользовать as-is, НЕ править, НЕ копировать.
- app/(app)/acceptance/_components/AcceptanceBoard.tsx — десктоп-эталон применения (useMemo boardOptions/filterBoard,
  toggleNum, resetAll, anyFilterActive, emptyNote). Мобиле повторяет ту же модель состояния.
- app/(app)/acceptance/_components/MobileAcceptanceBoard.tsx — цель правки (зоны-сегменты zone1/zone2/zone3,
  счётчики board.zone1.length / board.zone2.length / board.acceptedCount, EmptyZone, ?zone= через writeUrlParam).
- app/(app)/shipments/_components/MobileFilterSheet.tsx — эталон bottom-sheet (классы .sheet/.ov-scrim/.sheet-head/
  .sheet-body/.sheet-sec/.opt-chips/.opt-chip/.sq/.sheet-foot; live-apply тапом по чипу; счётчик «Показать N»).
- app/(app)/shipments/_components/MobileShipmentsFeed.tsx — эталон обвязки sheet: filter-btn с .fdot-счётчиком,
  sheetOpen-стейт, toggleNum, resetAll, проброс onToggle*/onReset в sheet.
Next/React — context7 при сомнениях.

UI-1) НОВЫЙ файл app/(app)/acceptance/_components/MobileAcceptanceFilterSheet.tsx — калька MobileFilterSheet, но:
  - секции: «Сырьё» (чипы культур с .sq-цветом) + «Поставщик» (чипы фермеров). Секции «Статус» НЕТ.
  - вверху sheet-body — поле поиска (класс .search, как в тулбаре десктопной приёмки), value/onChange проброшены.
  - опции — из boardOptions(board): options.cultures (несут color), options.farmers.
  - счётчик кнопки «Показать N машин»: count = сумма длин зон из filterBoard(board, {search, supplierSel, cultureSel})
    (zone1+zone2+zone3). Плюрализация — pluralRu (server/shipments/format) «машину/машины/машин».
  - пропсы: open, onClose, board, options, search, supplierSel, cultureSel, onSearch, onToggleSupplier,
    onToggleCulture, onReset. Обёртка div.md:hidden + .ov-scrim(onClose) + .sheet — вербатим паттерн ленты.

UI-2) app/(app)/acceptance/_components/MobileAcceptanceBoard.tsx — добавить фильтры:
  - импорт filterBoard, boardOptions, anyAcceptanceFilterActive, тип AcceptanceFilters из board-filter;
    MobileAcceptanceFilterSheet.
  - состояние: search (string), supplierSel/cultureSel (Set<number>), sheetOpen (bool). toggleNum + resetAll —
    как в MobileShipmentsFeed. localStorage НЕЛЬЗЯ.
  - const options = useMemo(() => boardOptions(board), [board]);
    const view = useMemo(() => filterBoard(board, {search, supplierSel, cultureSel}), [board, search, supplierSel, cultureSel]);
    const anyFilterActive = anyAcceptanceFilterActive({search, supplierSel, cultureSel});
    const filterCount = supplierSel.size + cultureSel.size + (search.trim() ? 1 : 0);
  - НАД .zone-seg — строка с кнопкой .filter-btn «Фильтры» (+ .fdot-счётчик filterCount при >0), onClick setSheetOpen(true).
    (Дизайн кнопки — вербатим из .mweekbar ленты; иконка Filter из lucide-react.)
  - ВСЕ обращения board.zone1/zone2/zone3/acceptedCount в рендере зон и счётчиках табов заменить на view.*:
    таб zone1 -> view.zone1.length, zone2 -> view.zone2.length, zone3 -> view.acceptedCount;
    списки карточек — view.zone1/zone2/zone3.
  - EmptyZone note: если anyFilterActive -> «Ничего не найдено по фильтрам.», иначе базовый текст зоны
    («Нет машин в пути.» / «Нет машин на приёмке.» / «Нет принятых машин.») — как emptyNote на десктопе.
  - в конце JSX — <MobileAcceptanceFilterSheet ... /> с пробросом состояния и onToggle*/onSearch/onReset.
  - onOpenAct / диалог акта / зоны-сегмент / ?zone= — НЕ трогать (мутации и навигация зон как были).

ОГРАНИЧЕНИЯ
- Без миграции/схемы. Сервер (board-filter.ts и пр.) НЕ менять — только импорт и вызов.
- Одна функция фильтрации на весь проект: мобиле зовёт тот же filterBoard/boardOptions, что десктоп и печать.
  ВТОРОЙ копии/инлайна фильтра быть не должно.
- Новых CSS-классов не заводить — только глобальные (app/globals.css). Токены/паттерн sheet — как в ленте.
- Read-only: фильтр — вид, никаких мутаций, никаких новых server-запросов (board уже загружен целиком).
- localStorage/sessionStorage нельзя. Десктопную AcceptanceBoard и board-filter.ts не менять. Доки/TASKS — PM.

БД ТЕСТОВАЯ: проверки — UI (мутаций нет).

ПРОВЕРКА (показать)
- Фильтр по поставщику / по культуре / по поиску (№ машины, водитель) по отдельности и в комбинации →
  корректный видимый набор во всех трёх зонах-табах; счётчики на табах пересчитаны из view.
- «Показать N машин» в футере sheet совпадает с суммой видимых машин по трём зонам.
- «Сбросить» очищает все оси; пусто-после-фильтра в активной зоне показывает «Ничего не найдено по фильтрам.».
- Открытие акта (markArrived / getActContext) и переключение зон работают как раньше; фильтр их не ломает.
- Десктопная приёмка визуально/функционально не изменилась (тот же board-filter.ts).
- lint / tsc / build зелёные.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью mobile-acceptance-filters
1. Фильтрация — переиспользован `filterBoard`/`boardOptions` из `board-filter.ts`; второй копии/инлайна нет; сервер не тронут.
2. Bottom-sheet — новый `MobileAcceptanceFilterSheet` на глобальных классах ленты; новых CSS не добавлено; секции Сырьё+Поставщик+поиск (без Статуса).
3. Счётчики зон-табов и списки карточек — из `view` (filterBoard), не из полного `board`; `acceptedCount` из view.
4. Пусто-после-фильтра — осмысленная подпись; `.fdot`-счётчик активных фильтров на кнопке.
5. Read-only: мутации акта/веса и `?zone=` не затронуты; localStorage не используется; десктоп не изменился.
6. lint/tsc/build зелёные; (опц.) прогон `invariant-review`.

---

## После задачи — обновление памяти (зона PM, не Claude Code)
- `TASKS.md`: «фильтры в МОБИЛЬНОЙ приёмке» → `[x]`; остаток бэклога — календарь (в последнюю очередь), Excel Аналитики, снос deprecated-колонок.
- `CONTEXT-HANDOFF.md`: CURRENT IMPLEMENTATION += фильтры мобильной приёмки; NEXT TASK → выбрать из остатка (календарь / Excel Аналитики / cleanup-миграция). Убрать пункт из «Не реализовано».
