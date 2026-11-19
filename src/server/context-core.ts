import "server-only";
import { prisma } from "./db/client";
import { tenantDb, type TenantDb } from "./db/tenant";
import type { SessionUser } from "./auth/types";
import { effectivePermissions, type Permission, type RoleKey } from "@/domain/rbac";
import { forbidden } from "./errors";

export interface OrgContext {
  user: SessionUser;
  org: { id: string; name: string; isDemo: boolean; industry: string; settings: OrgSettings };
  membership: { id: string; roleKey: RoleKey; roleName: string; locationIds: string[] };
  permissions: Set<Permission>;
  db: TenantDb;
  can: (p: Permission) => boolean;
  /** Фильтр по точкам для пользователей с ограниченной областью (undefined — вся компания) */
  locationScope: string[] | undefined;
}

export interface OrgSettings {
  priority?: { weights: Record<string, number>; thresholds: { P1: number; P2: number; P3: number } };
  anonymityMinGroup?: number;
  allowExternalAI?: boolean;
  allowAnonymizedAnalytics?: boolean;
  allowModelTraining?: boolean;
  retentionMonths?: number;
}

/** Загрузка контекста компании для пользователя (без cookies — удобно для тестов). */
export async function loadOrgContext(user: SessionUser, preferredOrgId?: string | null): Promise<OrgContext | null> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: user.id, archivedAt: null, organization: { archivedAt: null } },
    include: { organization: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  const now = new Date();
  const active = memberships.filter((m) => !m.expiresAt || m.expiresAt > now);
  if (active.length === 0) return null;
  const m = active.find((x) => x.organizationId === preferredOrgId) ?? active[0];

  const permissions = effectivePermissions({
    roleKey: m.role.key,
    rolePermissions: m.role.permissions,
    moduleScope: m.moduleScope,
    expiresAt: m.expiresAt,
    archivedAt: m.archivedAt,
  });

  return {
    user,
    org: {
      id: m.organization.id,
      name: m.organization.name,
      isDemo: m.organization.isDemo,
      industry: m.organization.industry,
      settings: (m.organization.settings ?? {}) as OrgSettings,
    },
    membership: { id: m.id, roleKey: m.role.key, roleName: m.role.name, locationIds: m.locationIds },
    permissions,
    db: tenantDb(m.organizationId),
    can: (p) => permissions.has(p),
    locationScope: m.locationIds.length ? m.locationIds : undefined,
  };
}


export function assertCan(ctx: OrgContext, p: Permission) {
  if (!ctx.can(p)) throw forbidden();
}

/** Проверка, что точка входит в область видимости пользователя. */
export function assertLocationInScope(ctx: OrgContext, locationId: string | null | undefined) {
  if (!ctx.locationScope) return;
  if (!locationId || !ctx.locationScope.includes(locationId)) throw forbidden("Точка вне вашей области доступа");
}
