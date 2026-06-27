# PROMPTS — D2-ops-1: лом + утиль тары (scrap + disposal)

> Ручные операции тары, срез 1/2. Без миграции (enum `scrap`/`disposal` уже есть). Tare-only.
> Точка входа — существующий drill-down диалог ячейки на `/packaging` (решение 2A). Admin-only.
> Причина операции — в ChangeLog (у `StockMovement` поля «причина» нет).

## Механика (DOMAIN §3)

- **scrap** (списание в лом): `loc/good → loc/scrap`, ТА ЖЕ локация. movement_type=scrap, source=manual.
- **disposal** (утиль): `loc/scrap → null`. movement_type=disposal, source=manual.
- Локации операций — завод(0) или фермер (включая архивного: лом может «застрять» у деактивированного).
  Транзит (`-1`/`-2`) и `null` — запрещены. Кол-во тары — целое (шт), >0.
- Баланс может быть отрицательным (BR §3) → жёсткого потолка на кол-во НЕ ставим; в диалоге показываем
  текущий остаток (опц. мягкое предупреждение, если кол-во больше остатка).

---

## ПРОМПТ — D2-ops-1: scrap + disposal (Claude Code)

```text
Задача D2-ops-1 (VSMS): ручные операции тары — списание в лом (scrap) и утилизация (disposal), из
существующего drill-down диалога ячейки на дашборде /packaging. Без миграции (enum scrap/disposal есть).
Tare-only. Перед кодом — DOMAIN.md §3 (scrap=loc/good→loc/scrap; disposal=loc/scrap→null; баланс=Σ движений,
может быть отрицательным), CLAUDE.md (логика в server/, ChangeLog в той же транзакции, requireRole, баланс
не хранить, дизайн-токены). Эталон серверного паттерна — server/inventory/opening.ts (валидация локации,
$transaction + logChange, revalidatePath). Next/Prisma API — context7.

КОНТЕКСТ СХЕМЫ (НЕ менять): StockMovement(kind, packaging_type_id, quantity Decimal(15,6), from_location_id,
to_location_id, from_state StockState?, to_state StockState?, movement_type, source_doc_type, source_doc_id).
StockState {good|scrap}. MovementType содержит scrap, disposal. SourceDocType содержит manual.
FACTORY_LOCATION_ID=0, TRANSIT_TO_FACTORY=-1, TRANSIT_TO_FARMER=-2 (server/shipments/packaging.ts).
chipFor в server/inventory/balances.ts уже знает scrap(«списание»)/disposal(«утилизация») — drill-down
историю НЕ дорабатывать.

1) server/inventory/operations.ts (новый файл) — два Server Action, ActionResult, requireRole("admin"):
   - scrapTare({ locationId, packagingTypeId, quantity, reason }):
     • валидация: Number.isInteger(quantity) && quantity>0; packagingType существует; локация = завод(0)
       ИЛИ существующий фермер (active ИЛИ архивный); транзит(-1/-2)/null — отклонить (ActionResult error).
       НЕ ограничивать сверху текущим остатком (баланс может быть отрицательным).
     • $transaction: создать StockMovement { kind:"packaging", packaging_type_id, quantity,
       from_location_id=locationId, from_state:"good", to_location_id=locationId, to_state:"scrap",
       movement_type:"scrap", source_doc_type:"manual", source_doc_id:null } + logChange(entity
       "StockMovement", action "create", payload { op:"scrap", locationId, packagingTypeId, quantity,
       reason }) В ТОЙ ЖЕ транзакции.
     • revalidatePath("/packaging").
   - disposeTare({ locationId, packagingTypeId, quantity, reason }):
     • та же валидация локации/кол-ва.
     • $transaction: StockMovement { kind:"packaging", packaging_type_id, quantity,
       from_location_id=locationId, from_state:"scrap", to_location_id:null, to_state:null,
       movement_type:"disposal", source_doc_type:"manual", source_doc_id:null } + logChange(payload
       op:"disposal"). revalidatePath("/packaging").
   - Локация-валидатор переиспользовать/зеркалить из opening.ts, НО разрешить архивного фермера (лом мог
     застрять у деактивированного) — отличие от opening (там только active).

2) app/(app)/packaging/_components/TareBalanceMatrix.tsx — в drill-down Drawer добавить секцию «Операции»
   (под историей движений), видимую ТОЛЬКО admin (RoleGate admin) и ТОЛЬКО для локаций завод/фермер
   (НЕ транзит):
   - если state==="good": кнопка «Списать в лом» → инлайн числовой инпут (целое, шт; показать текущий
     остаток good этой ячейки) + кнопка подтверждения → scrapTare(...). Опц. поле «Причина» (короткий текст).
   - если state==="scrap": кнопка «Утилизировать» → инлайн инпут (целое, шт; показать текущий остаток scrap)
     + подтверждение → disposeTare(...). Опц. «Причина».
   - мягкое предупреждение (не блок), если введённое кол-во > текущего остатка ячейки.
   - после успеха: router.refresh() (обновить RSC-данные матрицы) + перезагрузить движения ячейки; при
     ошибке — показать текст из ActionResult. Числа — tabular-nums; иконки lucide; без эмодзи.
   - НЕ менять логику матрицы/тоглов/итогов и tare-функции balances.ts.

ОГРАНИЧЕНИЯ:
- Без миграции. Только новый server/inventory/operations.ts + правки drill-down в TareBalanceMatrix.tsx.
- Tare-only (ингредиентов и adjustment здесь нет — adjustment это D2-ops-2). Транзит/null — не локации операций.
- scrap/disposal — source=manual; причина только в ChangeLog (у StockMovement поля нет). admin на сервере И клиенте.
- Доки/TASKS — не трогать (ассистент батчем). Эталоны не переписывать.

БД ТЕСТОВАЯ (правило проекта): данные одноразовые; проверки через UI/seed, очистка свободно.

ПРОВЕРКА (показать):
- сид: у фермера X good ящиков = 100. «Списать в лом» 15 → good 85 · scrap 15 (та же локация);
  движение scrap, в истории чип «списание»; ChangeLog содержит op/локацию/кол-во/причину.
- «Утилизировать» 10 из scrap у X → scrap 5 · из системы ушло 10; чип «утилизация»; «Итого в системе»
  по типу уменьшилось на 10 (disposal выводит из системы — в отличие от scrap).
- предупреждение: попытка списать 999 при остатке 85 → мягкое предупреждение, операция всё же возможна
  (баланс уходит в минус — разрешено).
- локация-гард: scrap на транзитной строке недоступен (кнопок нет); попытка на null/транзит на сервере
  отклонена.
- RBAC: не-admin не видит секцию операций; серверный requireRole("admin") отклоняет.
- регресс: матрица/тоглы/итоги/история работают как раньше; tare-функции balances.ts не тронуты.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью D2-ops-1
1. `operations.ts`: scrapTare/disposeTare — admin, валидация кол-ва (целое>0) и локации (завод/фермер вкл. архив; транзит/null отклонены).
2. scrap: loc/good→loc/scrap (та же локация); disposal: loc/scrap→null; source=manual; logChange в той же транзакции (причина в payload).
3. Нет жёсткого потолка по остатку (баланс может быть отрицательным); мягкое предупреждение в UI.
4. Drill-down: секция операций admin-only, по состоянию ячейки (good→лом, scrap→утиль), не на транзите; router.refresh после успеха.
5. Матрица/итоги/история и tare-функции balances.ts не тронуты; disposal уменьшает «Итого в системе», scrap — нет.
6. Без миграции; tare-only; adjustment отсутствует (это D2-ops-2).

---

## После D2-ops-1 — D2-ops-2 (корректировка)
adjustment как ИНВЕНТАРИЗАЦИЯ (решение 1A): в диалоге ячейки — «Скорректировать остаток» → ввод ФАКТИЧЕСКОГО
остатка; сервер пишет движение adjustment на разницу (от текущего Σ к факту), source=manual, причина в
ChangeLog. Tare-only. Затем — D3-2 (позиционное прибытие рейса) — там понадобится миграция, обсудим отдельно.
