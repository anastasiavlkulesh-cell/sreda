import type { Permission } from "@/domain/rbac";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Достаточно любого из прав */
  anyOf: Permission[];
  /** false — модуль запланирован на следующие этапы (показывается как «Скоро», не кликабелен) */
  ready: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: "Обзор",
    items: [
      { href: "/dashboard", label: "Главная панель", icon: "LayoutDashboard", anyOf: ["dashboard.view"], ready: true },
      { href: "/assistant", label: "AI-помощник", icon: "Sparkles", anyOf: ["assistant.use"], ready: false },
    ],
  },
  {
    title: "Диагностика",
    items: [
      { href: "/diagnostics", label: "SERVICE 5D", icon: "Radar", anyOf: ["diagnostics.view", "diagnostics.respond"], ready: true },
      { href: "/problems", label: "Проблемы и причины", icon: "SearchCheck", anyOf: ["problems.view"], ready: true },
    ],
  },
  {
    title: "Улучшения",
    items: [
      { href: "/plan", label: "План улучшений", icon: "ClipboardList", anyOf: ["plan.view"], ready: true },
      { href: "/tasks", label: "Задачи", icon: "ListChecks", anyOf: ["tasks.work", "tasks.view_all"], ready: true },
    ],
  },
  {
    title: "Люди и бизнес",
    items: [
      { href: "/team", label: "Команда", icon: "Users", anyOf: ["team.view"], ready: false },
      { href: "/metrics", label: "Бизнес-показатели", icon: "TrendingUp", anyOf: ["metrics.view"], ready: true },
      { href: "/reports", label: "Отчёты", icon: "FileText", anyOf: ["reports.view"], ready: false },
    ],
  },
  {
    title: "Следующие этапы",
    items: [
      { href: "/training", label: "Обучение", icon: "GraduationCap", anyOf: ["team.view"], ready: false },
      { href: "/standards", label: "Стандарты", icon: "BookOpen", anyOf: ["diagnostics.view"], ready: false },
      { href: "/customers", label: "Клиентский опыт", icon: "HeartHandshake", anyOf: ["diagnostics.view"], ready: false },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  href: "/settings",
  label: "Настройки",
  icon: "Settings",
  // Личные настройки уведомлений доступны всем; остальные вкладки — по правам.
  anyOf: [],
  ready: true,
};

export function visibleNav(perms: Set<string>) {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.anyOf.some((p) => perms.has(p))) })).filter((g) => g.items.length);
}

export function isModuleReady(href: string): boolean {
  for (const g of NAV) for (const i of g.items) if (href === i.href || href.startsWith(i.href + "/")) return i.ready;
  return true;
}

/** Первый готовый раздел, доступный по правам (иначе — личные настройки). */
export function landingPath(perms: Set<string>): string {
  for (const g of NAV) for (const i of g.items) if (i.ready && i.anyOf.some((p) => perms.has(p))) return i.href;
  return "/settings?tab=profile";
}
