import { describe, expect, it } from "vitest";

import { isActive, isHrefAllowedForRole, navForRole, NAV } from "./nav";

// Видимость пунктов меню по ролям. Это ТОЛЬКО UI-слой: доступ режет серверный
// requireRole (server/auth/session.ts). Тесты фиксируют, что админские разделы не
// протекают в меню operator/user.

const ADMIN_ONLY = ["/reference", "/settings"];

describe("navForRole", () => {
  it("admin видит все пункты меню", () => {
    expect(navForRole("admin")).toHaveLength(NAV.length);
  });

  it("operator и user не видят Справочники и Настройки", () => {
    for (const role of ["operator", "user"] as const) {
      const hrefs = navForRole(role).map((i) => i.href);
      for (const href of ADMIN_ONLY) expect(hrefs).not.toContain(href);
      expect(hrefs).toContain("/shipments");
      expect(hrefs).toContain("/acceptance");
    }
  });

  it("без роли (сессии ещё нет) админские пункты тоже скрыты", () => {
    const hrefs = navForRole(undefined).map((i) => i.href);
    for (const href of ADMIN_ONLY) expect(hrefs).not.toContain(href);
    expect(hrefs).toHaveLength(NAV.length - ADMIN_ONLY.length);
  });
});

describe("isHrefAllowedForRole", () => {
  it("подпункт наследует роли родительского раздела", () => {
    expect(isHrefAllowedForRole("/reference/drivers", "admin")).toBe(true);
    expect(isHrefAllowedForRole("/reference/drivers", "operator")).toBe(false);
    expect(isHrefAllowedForRole("/settings/norms", "user")).toBe(false);
  });

  it("общие разделы открыты всем ролям и без роли", () => {
    expect(isHrefAllowedForRole("/shipments", "user")).toBe(true);
    expect(isHrefAllowedForRole("/analytics", undefined)).toBe(true);
  });

  it("сам раздел закрыт так же, как его подпункты", () => {
    expect(isHrefAllowedForRole("/settings", "operator")).toBe(false);
    expect(isHrefAllowedForRole("/settings", "admin")).toBe(true);
  });

  it("неизвестный href → true: функция фильтрует МЕНЮ, а не доступ", () => {
    // Совпадение точное, без префиксного матчинга. Доступ к маршруту режет
    // серверный requireRole — здесь fail-open осознан.
    expect(isHrefAllowedForRole("/unknown", undefined)).toBe(true);
    expect(isHrefAllowedForRole("/shipments/123", "user")).toBe(true);
  });
});

describe("isActive", () => {
  it("активен при точном совпадении и на вложенном маршруте", () => {
    expect(isActive("/reference", "/reference")).toBe(true);
    expect(isActive("/reference/drivers", "/reference")).toBe(true);
  });

  it("не активен на соседнем разделе с общим префиксом строки", () => {
    expect(isActive("/references", "/reference")).toBe(false);
    expect(isActive("/shipments", "/ship")).toBe(false);
  });

  it("корень активен только при точном совпадении", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/shipments", "/")).toBe(false);
  });
});
