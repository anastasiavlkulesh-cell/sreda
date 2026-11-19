/**
 * RBAC СРЕДЫ. Чистая доменная логика без зависимостей от БД.
 * Каталог прав синхронизируется в таблицу Permission при сидировании,
 * наборы прав ролей копируются в Role при создании компании и могут
 * настраиваться на уровне компании (кроме роли собственника).
 */

export const PERMISSIONS = {
  "org.manage": { module: "settings", description: "Управление компанией и настройками" },
  "org.delete": { module: "settings", description: "Удаление компании и данных" },
  "members.view": { module: "settings", description: "Просмотр пользователей компании" },
  "members.invite": { module: "settings", description: "Приглашение пользователей" },
  "members.manage": { module: "settings", description: "Назначение ролей и отключение пользователей" },
  "roles.manage": { module: "settings", description: "Настройка прав ролей" },
  "locations.manage": { module: "settings", description: "Управление точками и подразделениями" },
  "dashboard.view": { module: "dashboard", description: "Главная панель" },
  "diagnostics.view": { module: "diagnostics", description: "Просмотр диагностик и результатов" },
  "diagnostics.manage": { module: "diagnostics", description: "Запуск и настройка диагностик" },
  "diagnostics.respond": { module: "diagnostics", description: "Заполнение анкет руководителя" },
  "analysis.run": { module: "analysis", description: "Запуск AI-анализа" },
  "problems.view": { module: "analysis", description: "Просмотр проблем и причин" },
  "plan.view": { module: "plan", description: "Просмотр плана улучшений" },
  "plan.manage": { module: "plan", description: "Формирование и редактирование плана" },
  "plan.approve": { module: "plan", description: "Утверждение плана" },
  "tasks.view_all": { module: "tasks", description: "Просмотр всех задач (в своей области)" },
  "tasks.manage": { module: "tasks", description: "Создание, назначение и проверка задач" },
  "tasks.work": { module: "tasks", description: "Работа со своими задачами" },
  "team.view": { module: "team", description: "Список сотрудников" },
  "team.manage": { module: "team", description: "Управление сотрудниками" },
  "team.insights": { module: "team", description: "Агрегированные результаты опросов команды" },
  "metrics.view": { module: "metrics", description: "Просмотр бизнес-показателей" },
  "metrics.manage": { module: "metrics", description: "Ввод и загрузка бизнес-показателей" },
  "reports.view": { module: "reports", description: "Отчёты" },
  "assistant.use": { module: "assistant", description: "AI-помощник" },
  "audit.view": { module: "settings", description: "Журнал аудита" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type RoleKey =
  | "OWNER"
  | "NETWORK_MANAGER"
  | "LOCATION_MANAGER"
  | "MANAGER"
  | "EMPLOYEE"
  | "PLATFORM_EXPERT";

export const ROLE_LABELS: Record<RoleKey, string> = {
  OWNER: "Собственник",
  NETWORK_MANAGER: "Руководитель сети",
  LOCATION_MANAGER: "Управляющий точки",
  MANAGER: "Менеджер",
  EMPLOYEE: "Сотрудник",
  PLATFORM_EXPERT: "Эксперт платформы",
};

const MANAGEMENT_COMMON: Permission[] = [
  "dashboard.view",
  "diagnostics.view",
  "diagnostics.respond",
  "problems.view",
  "plan.view",
  "tasks.view_all",
  "tasks.manage",
  "tasks.work",
  "team.view",
  "metrics.view",
  "reports.view",
  "assistant.use",
  "members.view",
];

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  OWNER: [...ALL_PERMISSIONS],
  NETWORK_MANAGER: [
    ...MANAGEMENT_COMMON,
    "diagnostics.manage",
    "analysis.run",
    "plan.manage",
    "members.invite",
    "locations.manage",
    "team.manage",
    "team.insights",
    "metrics.manage",
  ],
  LOCATION_MANAGER: [...MANAGEMENT_COMMON, "team.manage", "team.insights", "metrics.manage"],
  MANAGER: ["dashboard.view", "diagnostics.respond", "plan.view", "tasks.view_all", "tasks.work", "team.view", "assistant.use"],
  EMPLOYEE: ["tasks.work"],
  // Эксперт: только просмотр аналитики; конкретный объём ограничивается moduleScope и сроком.
  PLATFORM_EXPERT: ["dashboard.view", "diagnostics.view", "problems.view", "plan.view", "tasks.view_all", "metrics.view", "reports.view"],
};

/** Права, которые нельзя выдать никому, кроме собственника. */
export const OWNER_ONLY: Permission[] = ["org.delete", "roles.manage", "plan.approve", "audit.view"];

/** Права, которые никогда не выдаются эксперту платформы, даже при ручной настройке. */
export const EXPERT_FORBIDDEN: Permission[] = [
  "org.manage",
  "org.delete",
  "members.manage",
  "roles.manage",
  "plan.approve",
  "members.invite",
];

export interface MembershipGrant {
  roleKey: RoleKey;
  rolePermissions: string[];
  moduleScope: string[];
  expiresAt: Date | null;
  archivedAt: Date | null;
}

/**
 * Итоговый набор прав участника с учётом ограничений:
 * — архивированный участник и истёкший доступ эксперта не имеют прав;
 * — права только из каталога; OWNER_ONLY — только у собственника;
 * — эксперт ограничен moduleScope и EXPERT_FORBIDDEN.
 */
export function effectivePermissions(grant: MembershipGrant, now = new Date()): Set<Permission> {
  if (grant.archivedAt) return new Set();
  if (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime()) return new Set();

  const known = new Set<string>(ALL_PERMISSIONS);
  let perms = grant.rolePermissions.filter((p): p is Permission => known.has(p));

  if (grant.roleKey !== "OWNER") perms = perms.filter((p) => !OWNER_ONLY.includes(p));
  if (grant.roleKey === "PLATFORM_EXPERT") {
    perms = perms.filter((p) => !EXPERT_FORBIDDEN.includes(p));
    if (grant.moduleScope.length > 0) {
      perms = perms.filter((p) => grant.moduleScope.includes(PERMISSIONS[p].module));
    }
  }
  return new Set(perms);
}

/** Кому участник может назначать роль: только «ниже» себя; OWNER — только собственник. */
const ROLE_RANK: Record<RoleKey, number> = {
  OWNER: 100,
  NETWORK_MANAGER: 80,
  LOCATION_MANAGER: 60,
  MANAGER: 40,
  PLATFORM_EXPERT: 30,
  EMPLOYEE: 10,
};

export function canAssignRole(actor: RoleKey, target: RoleKey): boolean {
  if (actor === "OWNER") return true;
  if (target === "OWNER" || target === "PLATFORM_EXPERT") return false;
  return ROLE_RANK[actor] > ROLE_RANK[target];
}
