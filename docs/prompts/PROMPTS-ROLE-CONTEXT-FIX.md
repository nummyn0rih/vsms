# PROMPTS — role-context-FIX: роль из серверного layout, без клиентского useSession

> **Симптом (прод, воспроизводится давно — НЕ волна 2):** после F5 админские элементы видны; при клиентской
> навигации (переход по меню, без перезагрузки) роль «пропадает» — исчезают кнопка «+ Отгрузка», действия
> приёмки, элементы планировщика. Следующий F5 всё возвращает.
>
> **Диагностика (проведена):**
> - на старых деплоях воспроизводится → дефект унаследованный, не от обновления зависимостей;
> - `console.log` в `app/layout.tsx` при soft-навигации даёт **`[layout] session? true`** → сервер сессию
>   читает и в `Providers` передаёт;
> - при этом `useSession()` в клиентских компонентах роли не отдаёт.
>
> **Вывод:** сервер исправен, ломается применение пропа внутри `SessionProvider` на клиенте. После F5 работает
> потому, что страница отрисована на СЕРВЕРЕ (там `useSession` видит проп и кнопка попадает в HTML); при
> клиентской навигации серверного рендера нет — и берётся пустое клиентское состояние провайдера.
>
> **Миграции НЕТ. Серверный RBAC (`requireRole`) НЕ трогаем** — он и так работает и остаётся источником правды.

## Решение

Перестать зависеть от клиентского состояния next-auth для гейтинга UI. Роль уже надёжно есть на сервере
(доказано логом) — прокидываем её **собственным React-контекстом**, который обновляется обычным пропом при
каждом рендере layout. Никаких внутренних fetch'ей, состояний и `useState`-инициализаторов.

| Развилка | Выбор |
|---|---|
| Источник роли для UI | Собственный контекст `RoleProvider` ← проп из серверного `app/layout.tsx` |
| `SessionProvider` | **Оставить смонтированным** (нужен для `signOut` и прочего API next-auth), но роль из него больше не читать |
| `useSession()` для ролей | Заменить на `useRole()` во ВСЕХ потребителях |
| Серверный RBAC | Без изменений — клиентский гейт остаётся только UX-слоем |
| Свежесть роли | Та же, что сейчас: роль из JWT-сессии на каждый рендер layout. Перечитывание из БД — отложенная половина П-4, здесь не делаем |

---

## ПРОМПТ — role-context-FIX (Claude Code)

```text
Задача role-context-FIX (VSMS): увести клиентский RBAC-гейт с useSession на собственный контекст роли,
питаемый из серверного layout. Причина: при клиентской навигации useSession не отдаёт роль (после F5 —
отдаёт), из-за чего пропадают все админские элементы. Миграция: НЕТ. Серверный requireRole НЕ трогать.

Перед кодом прочитать: app/layout.tsx (там уже const session = await auth()), app/providers.tsx,
components/auth/RoleGate.tsx, server/auth/session.ts, и всех потребителей useSession:
  app/(app)/acceptance/_components/AcceptanceBoard.tsx
  app/(app)/acceptance/_components/MobileAcceptanceBoard.tsx
  app/(app)/acceptance/_components/AcceptanceMachine.tsx
  app/(app)/planner/_components/BoardView.tsx
  app/(app)/planner/_components/PlanView.tsx
  app/(app)/planner/_components/ScopeCombo.tsx
  app/(app)/shipments/_components/ShipmentsFeed.tsx и MachineRow.tsx (через RoleGate)
Next 16 / next-auth v5 — сверить по context7 при сомнениях.

1) НОВЫЙ файл components/auth/RoleProvider.tsx ("use client"):
   - const RoleContext = createContext<Role | null>(null);
   - export function RoleProvider({ role, children }: { role: Role | null; children: React.ReactNode })
     → <RoleContext.Provider value={role}>{children}</RoleContext.Provider>
     ВАЖНО: значение берётся ПРЯМО из пропа на каждом рендере. Не заводить useState/useEffect/useMemo с
     инициализатором — именно этот паттерн и сломан в SessionProvider.
   - export function useRole(): Role | null → useContext(RoleContext).
   - Тип Role импортировать как type из "@/lib/generated/prisma/client".
2) app/providers.tsx — принять role пропом и обернуть детей:
   <SessionProvider session={session}>  // оставить: нужен для signOut/остального API
     <RoleProvider role={role}>{children}</RoleProvider>
     <Toaster />
   </SessionProvider>
   Подпись: { children, session, role }: { children: React.ReactNode; session: Session | null; role: Role | null }
3) app/layout.tsx — передать роль (session уже читается, второй запрос НЕ добавлять):
   const session = await auth();
   <Providers session={session} role={session?.user?.role ?? null}>{children}</Providers>
   Layout остаётся СЕРВЕРНЫМ ("use client" не добавлять).
4) components/auth/RoleGate.tsx — читать useRole() вместо useSession(). Публичный API компонента
   (props allow/children/fallback) НЕ менять — все места использования остаются как есть.
5) Заменить чтение роли через useSession на useRole во всех перечисленных потребителях:
   было:  const { data: session } = useSession(); const isAdmin = session?.user?.role === "admin";
   стало: const role = useRole(); const isAdmin = role === "admin";
   Аналогично canEdit = role === "operator" || role === "admin".
   ⚠ Если в компоненте useSession используется НЕ ради роли (напр. status/signOut) — эту часть оставить.
   После правок импорт useSession должен остаться только там, где он нужен не для роли.

ОГРАНИЧЕНИЯ
- Не трогать server/auth/session.ts, requireRole и любые серверные проверки — клиентский гейт только UX.
- Не удалять SessionProvider и не менять auth.config.ts/auth.ts.
- Не менять бизнес-логику, схему, стили, тексты.
- Никаких useState/useEffect в RoleProvider — значение должно течь пропом.

ПРОВЕРКА (показать) — ключевая проверка именно про НАВИГАЦИЮ, не про F5:
- npm run build && npm run start, вход под admin. Затем БЕЗ перезагрузки страницы:
  · /shipments → кнопка «+ Отгрузка» видна (и остаётся после подмены скелетона реальными данными);
  · переход в /acceptance → действия приёмки (акт/вес) доступны;
  · переход в /planner → админские элементы доски и ScopeCombo на месте;
  · переход в /reference/farmers → кнопка создания видна;
  · вернуться на /shipments — кнопка на месте. Ни один шаг не требует F5.
- То же на мобильной ширине (MobileAcceptanceBoard).
- Негатив: под ролью operator/user админские элементы скрыты; прямой вызов admin-action по-прежнему
  отклоняется сервером (requireRole не ослаблен) — прогнать scripts/settlement-rbac-verify.ts.
- Разлогиненный → редирект на /login.
- lint/tsc/build зелёные.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью role-context-FIX
1. `RoleProvider` — значение течёт пропом, без `useState`/`useEffect` (иначе воспроизведём ту же болезнь).
2. `app/layout.tsx` остался серверным; второго вызова `auth()` не добавлено.
3. `RoleGate` читает `useRole()`; его props-API не изменился; места использования не правились.
4. Все потребители роли переведены на `useRole()`; `useSession` остался только там, где нужен не для роли.
5. **Админский UI жив при клиентской навигации без единого F5** — по всем маршрутам из проверки.
6. Серверный RBAC не тронут; `settlement-rbac-verify` зелёный.

---

## Побочная находка (в эту задачу НЕ входит)

`app/(app)/shipments/loading.tsx` рисует статический тулбар с кнопкой «Отгрузка» **вне** `RoleGate` — на
скелетоне она видна при любой роли и «исчезает», когда приходит реальный `ShipmentsFeed`. При текущем баге это
выглядело как мигание, после фикса перестанет бросаться в глаза, но для не-admin несоответствие останется.
Мелочь на правило бойскаута: при следующей правке ленты убрать кнопку из скелетона (у `loading.tsx` нет доступа
к роли — проще нарисовать нейтральный плейсхолдер).

## После задачи — обновление памяти (зона PM)
- `CONTEXT-HANDOFF.md` → ARCHITECTURAL DECISIONS: «роль для клиентского UI — собственный `RoleProvider`
  (проп из серверного layout), НЕ `useSession`; серверный `requireRole` — источник правды».
- `AUDIT-REMEDIATION-PLAN.md`: зафиксировать как унаследованный дефект, найденный смоуком волны 2.
