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
  { href: "/", label: "Лента отгрузок", icon: LayoutList },
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
      { href: "/reference/cultures", label: "Культуры" },
      { href: "/reference/transport-companies", label: "Транспортные компании" },
      { href: "/reference/drivers", label: "Водители" },
      { href: "/reference/packaging-types", label: "Типы тары", enabled: true },
      { href: "/reference/ingredients", label: "Ингредиенты" },
    ],
  },
  { href: "/settings", label: "Настройки", icon: Settings, roles: ["admin"] },
];

// Подтабы раздела «Справочники» (используются и в сайдбаре, и в reference/layout).
export const REFERENCE_TABS =
  NAV.find((i) => i.href === "/reference")?.children ?? [];

export function navForRole(role: Role | undefined): NavItem[] {
  return NAV.filter((i) => !i.roles || (role && i.roles.includes(role)));
}
