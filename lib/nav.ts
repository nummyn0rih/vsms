import {
  LayoutList,
  CalendarRange,
  ClipboardCheck,
  FileText,
  Package,
  FlaskConical,
  Truck,
  BarChart3,
  BookOpen,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/lib/generated/prisma/client";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  // Пусто = видно всем ролям. Иначе — только перечисленным.
  roles?: Role[];
  // Подпункты (для раскрывающейся группы «Справочники»).
  children?: { href: string; label: string; enabled?: boolean }[];
};

// Меню из PRD §17. Матрица ролей в DOMAIN/PRD не зафиксирована —
// пока: Справочники и Настройки только admin, остальное всем. Правится здесь.
export const NAV: NavItem[] = [
  { href: "/shipments", label: "Лента отгрузок", icon: LayoutList },
  { href: "/planner", label: "Планировщик", icon: CalendarRange },
  { href: "/acceptance", label: "Приёмка", icon: ClipboardCheck },
  { href: "/contracts", label: "Контракты", icon: FileText },
  { href: "/packaging", label: "Тара", icon: Package },
  { href: "/ingredients", label: "Ингредиенты", icon: FlaskConical },
  { href: "/materials", label: "Логистика материалов", icon: Truck },
  { href: "/analytics", label: "Аналитика", icon: BarChart3 },
  {
    href: "/reference",
    label: "Справочники",
    icon: BookOpen,
    roles: ["admin"],
    children: [
      { href: "/reference/farmers", label: "Фермеры", enabled: true },
      { href: "/reference/cultures", label: "Культуры", enabled: true },
      { href: "/reference/transport-companies", label: "Транспортные компании", enabled: true },
      { href: "/reference/drivers", label: "Водители", enabled: true },
      { href: "/reference/packaging-types", label: "Типы тары", enabled: true },
      { href: "/reference/ingredients", label: "Ингредиенты", enabled: true },
    ],
  },
  {
    href: "/settings",
    label: "Настройки",
    icon: Settings,
    roles: ["admin"],
    children: [
      { href: "/settings/seasons", label: "Сезоны", enabled: true },
      { href: "/settings/norms", label: "Нормы", enabled: true },
      { href: "/settings/opening-stock", label: "Начальные остатки", enabled: true },
      { href: "/settings/recipes", label: "Рецептуры", enabled: true },
      { href: "/settings/alert-rules", label: "Пороги алертов", enabled: true },
    ],
  },
];

// Подтабы раздела «Справочники» (используются и в сайдбаре, и в reference/layout).
export const REFERENCE_TABS =
  NAV.find((i) => i.href === "/reference")?.children ?? [];

// Подтабы раздела «Настройки» (сайдбар + settings/layout).
export const SETTINGS_TABS =
  NAV.find((i) => i.href === "/settings")?.children ?? [];

export function navForRole(role: Role | undefined): NavItem[] {
  return NAV.filter((i) => !i.roles || (role && i.roles.includes(role)));
}

// Активность пункта меню по текущему маршруту (Sidebar + мобильный шелл).
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// Доступность href (топ-уровень или дочерний, напр. /reference/drivers) для роли —
// по roles родительского пункта NAV. Мобильный таб-бар/drawer (mobile-1) кажут
// отдельные дочерние ссылки как «полевые» ярлыки — та же ролевая модель, что Sidebar.
export function isHrefAllowedForRole(href: string, role: Role | undefined): boolean {
  const owner = NAV.find((i) => i.href === href || i.children?.some((c) => c.href === href));
  if (!owner) return true;
  return !owner.roles || (!!role && owner.roles.includes(role));
}
