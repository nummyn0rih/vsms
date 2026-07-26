# PROMPTS — session-hydration-FIX: сессия из серверного layout в SessionProvider

> **Симптом (прод):** залогинен как admin, `/api/auth/session` отдаёт корректное `{"user":{"role":"admin",...}}`,
> но UI под `RoleGate allow={["admin"]}` не рендерится (нет кнопки «Создать» в справочниках). Перелогин и
> redeploy без кэша не помогли. В dev проблема не воспроизводится.
>
> **Причина:** `app/providers.tsx` рендерит `<SessionProvider>` **без пропа `session`**. В App Router это значит:
> при SSR клиентские компоненты видят `useSession() === undefined` → `RoleGate` отдаёт `fallback` (null), а роль
> появляется только ПОСЛЕ клиентского запроса к `/api/auth/session`. Если этот запрос не отработал (или его
> результат не доехал до гидратации), UI навсегда остаётся в состоянии «роли нет».
>
> **Масштаб больше одной кнопки:** от `useSession` зависят также `AcceptanceBoard`/`MobileAcceptanceBoard`
> (`canEdit`/`isAdmin` — действия приёмки), `AcceptanceMachine`, `BoardView`, `PlanView`, `ScopeCombo`.
> На проде это ломает RBAC-зависимый UI целиком, а не только справочники.
>
> **Миграция:** НЕТ. Схема, серверный RBAC (`requireRole`) и бизнес-логика не затрагиваются.

## Решения (зафиксированы)

| Развилка | Выбор |
|---|---|
| Способ | Прокинуть сессию из **серверного** `app/layout.tsx` в `SessionProvider` (`session={session}`) — штатный паттерн App Router. |
| Альтернатива (отвергнута) | Переписать `RoleGate` на серверный компонент везде — крупный рефактор ~8 файлов, часть из них клиентские по другим причинам (стейт, дnd). Не сейчас. |
| Цена вызова `auth()` в layout | Мала: стратегия сессии — **JWT**, `auth()` только верифицирует куку, запроса в БД нет. |
| `RoleGate` | Оставить клиентским и без изменений — он начнёт получать сессию сразу при первом рендере. |

---

## ПРОМПТ — session-hydration-FIX (Claude Code)

```text
Задача session-hydration-FIX (VSMS): прокинуть серверную сессию в SessionProvider, чтобы клиентские
компоненты (RoleGate, доски приёмки, планировщик) получали роль сразу при рендере, а не после клиентского
запроса /api/auth/session. Миграция: НЕТ. Бизнес-логику и серверный RBAC НЕ трогать.

Перед кодом прочитать: app/layout.tsx, app/providers.tsx, auth.ts, auth.config.ts,
components/auth/RoleGate.tsx. Auth.js v5 (beta.31) + Next 16 App Router — сверить по context7
(конкретно: рекомендованный способ передачи session в SessionProvider из серверного layout).

1) app/providers.tsx — принять сессию пропом и передать в провайдер:
   - подпись: { children, session }: { children: React.ReactNode; session: Session | null }
     (тип Session импортировать из "next-auth" как type).
   - <SessionProvider session={session}> … </SessionProvider>. Остальное (Toaster) без изменений.
2) app/layout.tsx (СЕРВЕРНЫЙ компонент, "use client" не добавлять!) — получить сессию и отдать вниз:
   - import { auth } from "@/auth";
   - сделать RootLayout async, внутри: const session = await auth();
   - <Providers session={session}>{children}</Providers>.
   - Шрифты/metadata/классы html-body НЕ трогать.
3) Ничего больше не менять: RoleGate, auth.config.ts, proxy.ts, серверные requireRole — как есть.

ОГРАНИЧЕНИЯ
- Не превращать app/layout.tsx в клиентский компонент (иначе сломаются шрифты/metadata и весь SSR).
- Не убирать и не ослаблять серверные проверки requireRole — клиентский гейт остаётся только UX-слоем.
- Не менять схему/бизнес-логику/стили. Доки — зона PM.
- Учесть: layout станет динамическим (auth() читает куки). Это ожидаемо — приложение и так за логином.

ПРОВЕРКА (показать)
- npm run build + npm run start локально: залогиниться admin → в справочнике «Фермеры» ВИДНА кнопка создания
  СРАЗУ (без задержки/мигания), диалог открывается, фермер создаётся.
- Приёмка: действия, завязанные на canEdit/isAdmin (AcceptanceBoard/MobileAcceptanceBoard), доступны admin.
- Негатив RBAC: под ролью user/operator (создать тестового или временно сменить роль в dev-БД) admin-действия
  скрыты, а прямой вызов server-action всё так же отклоняется requireRole (серверная проверка не ослабла).
- Разлогиненный → редирект на /login (proxy.ts работает как раньше).
- lint/tsc/build зелёные.
В конце предложи git-коммит одной строкой.
```

### Чеклист ревью session-hydration-FIX
1. `app/layout.tsx` остался серверным, стал async, зовёт `auth()` и передаёт `session` в `Providers`.
2. `SessionProvider` получает `session` пропом; `RoleGate` не изменён.
3. Роль доступна клиенту при первом рендере (кнопки не «доезжают» после паузы).
4. Серверный RBAC (`requireRole`) не тронут; негатив-проверка ролью проходит.
5. Без миграции; lint/tsc/build зелёные.

---

## После задачи — обновление памяти (зона PM)
- `CONTEXT-HANDOFF.md` → ARCHITECTURAL DECISIONS: «сессия прокидывается из серверного layout в `SessionProvider`;
  клиентский `useSession` не должен зависеть от отдельного запроса к `/api/auth/session`».
- `PROD-DEPLOY.md` → Фаза 6: добавить в смоук пункт «RBAC-кнопки видны admin сразу после логина».
