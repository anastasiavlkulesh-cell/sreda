import "server-only";
import { prisma } from "../db/client";
import { audit } from "../audit";
import { AppError, forbidden, notFound } from "../errors";
import { hashPassword } from "../auth/password";
import { hashToken, newToken } from "../crypto";
import { DEFAULT_ROLE_PERMISSIONS, ROLE_LABELS, canAssignRole, type RoleKey, type Permission, OWNER_ONLY, ALL_PERMISSIONS } from "@/domain/rbac";
import { DEFAULT_PRIORITY_SETTINGS } from "@/domain/priority";
import type { OrgContext } from "../context-core";
import type { DiagnosticSourceType } from "@/generated/prisma/enums";

const ALL_SOURCES: DiagnosticSourceType[] = ["OWNER", "MANAGER", "EMPLOYEE", "CUSTOMER", "MYSTERY_SHOPPER", "BUSINESS_METRICS"];

export const DEFAULT_ORG_SETTINGS = {
  priority: DEFAULT_PRIORITY_SETTINGS,
  anonymityMinGroup: 5,
  allowExternalAI: false,
  allowAnonymizedAnalytics: false,
  allowModelTraining: false,
  retentionMonths: 36,
};

export async function registerUser(input: { name: string; email: string; password: string }) {
  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) throw new AppError("Пользователь с таким e-mail уже зарегистрирован", "CONFLICT");
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, passwordHash: await hashPassword(input.password) },
  });
  await audit({ orgId: null, userId: user.id }, "user.register", "User", user.id);
  return user;
}

export async function createOrganization(
  userId: string,
  input: { name: string; industry: string; locationName: string; city?: string; isDemo?: boolean },
) {
  const org = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: input.name,
        industry: input.industry,
        isDemo: input.isDemo ?? false,
        settings: DEFAULT_ORG_SETTINGS as unknown as object,
      },
    });
    const roleKeys = Object.keys(DEFAULT_ROLE_PERMISSIONS) as RoleKey[];
    const roles = await Promise.all(
      roleKeys.map((key) =>
        tx.role.create({
          data: {
            organizationId: org.id,
            key,
            name: ROLE_LABELS[key],
            permissions: DEFAULT_ROLE_PERMISSIONS[key],
          },
        }),
      ),
    );
    const ownerRole = roles.find((r) => r.key === "OWNER")!;
    await tx.organizationMembership.create({ data: { organizationId: org.id, userId, roleId: ownerRole.id } });
    await tx.subscription.create({
      data: { organizationId: org.id, plan: "PILOT", status: "TRIAL", enabledSources: ALL_SOURCES },
    });
    await tx.location.create({ data: { organizationId: org.id, name: input.locationName, city: input.city || null } });
    return org;
  });
  await audit({ orgId: org.id, userId }, "org.create", "Organization", org.id, { isDemo: org.isDemo });
  return org;
}

export async function updateOrganization(ctx: OrgContext, input: { name: string; industry: string }) {
  if (!ctx.can("org.manage")) throw forbidden();
  await prisma.organization.update({ where: { id: ctx.org.id }, data: input });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "org.update", "Organization", ctx.org.id, input);
}

export async function updateOrgSettings(ctx: OrgContext, patch: Record<string, unknown>) {
  if (!ctx.can("org.manage")) throw forbidden();
  const current = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
  const settings = { ...DEFAULT_ORG_SETTINGS, ...((current.settings as object) ?? {}), ...patch };
  await prisma.organization.update({ where: { id: ctx.org.id }, data: { settings: settings as object } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "org.settings_update", "Organization", ctx.org.id, patch);
}

// ---------------------------------------------------------------------------
// Точки и подразделения
// ---------------------------------------------------------------------------

export async function createLocation(ctx: OrgContext, input: { name: string; city?: string; address?: string }) {
  if (!ctx.can("locations.manage")) throw forbidden();
  const loc = await ctx.db.location.create({
    data: { organizationId: ctx.org.id, name: input.name, city: input.city || null, address: input.address || null },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "location.create", "Location", loc.id);
  return loc;
}

export async function archiveLocation(ctx: OrgContext, id: string) {
  if (!ctx.can("locations.manage")) throw forbidden();
  const loc = await ctx.db.location.findFirst({ where: { id, archivedAt: null } });
  if (!loc) throw notFound();
  const active = await ctx.db.location.count({ where: { archivedAt: null } });
  if (active <= 1) throw new AppError("Нельзя архивировать единственную точку компании");
  await ctx.db.location.update({ where: { id }, data: { archivedAt: new Date() } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "location.archive", "Location", id);
}

export async function createDepartment(ctx: OrgContext, input: { name: string; locationId?: string }) {
  if (!ctx.can("locations.manage")) throw forbidden();
  if (input.locationId) {
    const loc = await ctx.db.location.findFirst({ where: { id: input.locationId } });
    if (!loc) throw notFound("Точка не найдена");
  }
  return ctx.db.department.create({ data: { organizationId: ctx.org.id, name: input.name, locationId: input.locationId || null } });
}

// ---------------------------------------------------------------------------
// Участники, приглашения, роли
// ---------------------------------------------------------------------------

async function validateLocationIds(ctx: OrgContext, ids: string[]) {
  if (ids.length === 0) return;
  const found = await ctx.db.location.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new AppError("Указана точка, не принадлежащая компании");
}

export async function inviteMember(
  ctx: OrgContext,
  input: { email: string; roleKey: RoleKey; locationIds: string[]; expiresInDays?: number },
) {
  if (!ctx.can("members.invite")) throw forbidden();
  if (!canAssignRole(ctx.membership.roleKey, input.roleKey)) throw forbidden("Вы не можете назначить эту роль");
  await validateLocationIds(ctx, input.locationIds);
  const role = await ctx.db.role.findFirst({ where: { key: input.roleKey } });
  if (!role) throw notFound("Роль не найдена");

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    const m = await ctx.db.organizationMembership.findFirst({ where: { userId: existingUser.id, archivedAt: null } });
    if (m) throw new AppError("Этот пользователь уже состоит в компании", "CONFLICT");
  }

  const token = newToken();
  const days = input.roleKey === "PLATFORM_EXPERT" ? Math.min(input.expiresInDays ?? 30, 90) : 14;
  const invitation = await ctx.db.invitation.create({
    data: {
      organizationId: ctx.org.id,
      email: input.email,
      roleId: role.id,
      locationIds: input.locationIds,
      tokenHash: hashToken(token),
      invitedById: ctx.user.id,
      expiresAt: new Date(Date.now() + days * 86400_000),
    },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "member.invite", "Invitation", invitation.id, {
    role: input.roleKey,
  });
  return { invitation, token };
}

export async function revokeInvitation(ctx: OrgContext, id: string) {
  if (!ctx.can("members.invite")) throw forbidden();
  const inv = await ctx.db.invitation.findFirst({ where: { id, acceptedAt: null, revokedAt: null } });
  if (!inv) throw notFound();
  await ctx.db.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "member.invite_revoke", "Invitation", id);
}

export async function findInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: true, role: true },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

export async function acceptInvitation(user: { id: string; email: string }, token: string) {
  const inv = await findInvitation(token);
  if (!inv) throw new AppError("Приглашение недействительно или истекло");
  if (inv.email.toLowerCase() !== user.email.toLowerCase())
    throw new AppError("Приглашение отправлено на другой e-mail. Войдите под адресом, на который пришло приглашение.");

  const isExpert = inv.role.key === "PLATFORM_EXPERT";
  await prisma.$transaction(async (tx) => {
    const existing = await tx.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } },
    });
    if (existing && !existing.archivedAt) throw new AppError("Вы уже состоите в этой компании", "CONFLICT");
    const data = {
      roleId: inv.roleId,
      locationIds: inv.locationIds,
      archivedAt: null,
      grantedById: inv.invitedById,
      expiresAt: isExpert ? inv.expiresAt : null,
    };
    if (existing) await tx.organizationMembership.update({ where: { id: existing.id }, data });
    else await tx.organizationMembership.create({ data: { ...data, organizationId: inv.organizationId, userId: user.id } });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
  });
  await audit({ orgId: inv.organizationId, userId: user.id }, "member.join", "Invitation", inv.id, { role: inv.role.key });
  return inv.organizationId;
}

export async function changeMemberRole(
  ctx: OrgContext,
  input: { membershipId: string; roleKey: RoleKey; locationIds: string[] },
) {
  if (!ctx.can("members.manage")) throw forbidden();
  const m = await ctx.db.organizationMembership.findFirst({
    where: { id: input.membershipId, archivedAt: null },
    include: { role: true },
  });
  if (!m) throw notFound("Участник не найден");
  if (m.userId === ctx.user.id) throw new AppError("Нельзя изменить собственную роль");
  if (m.role.key === "OWNER" && ctx.membership.roleKey !== "OWNER") throw forbidden();
  if (!canAssignRole(ctx.membership.roleKey, input.roleKey)) throw forbidden("Вы не можете назначить эту роль");
  await validateLocationIds(ctx, input.locationIds);
  const role = await ctx.db.role.findFirst({ where: { key: input.roleKey } });
  if (!role) throw notFound("Роль не найдена");
  await ctx.db.organizationMembership.update({
    where: { id: m.id },
    data: { roleId: role.id, locationIds: input.locationIds },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "member.role_change", "OrganizationMembership", m.id, {
    from: m.role.key,
    to: input.roleKey,
  });
}

export async function deactivateMember(ctx: OrgContext, membershipId: string) {
  if (!ctx.can("members.manage")) throw forbidden();
  const m = await ctx.db.organizationMembership.findFirst({
    where: { id: membershipId, archivedAt: null },
    include: { role: true },
  });
  if (!m) throw notFound("Участник не найден");
  if (m.userId === ctx.user.id) throw new AppError("Нельзя отключить самого себя");
  if (m.role.key === "OWNER") {
    const owners = await ctx.db.organizationMembership.count({ where: { archivedAt: null, role: { key: "OWNER" } } });
    if (owners <= 1) throw new AppError("В компании должен остаться хотя бы один собственник");
    if (ctx.membership.roleKey !== "OWNER") throw forbidden();
  }
  await ctx.db.organizationMembership.update({ where: { id: m.id }, data: { archivedAt: new Date() } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "member.deactivate", "OrganizationMembership", m.id);
}

export async function updateRolePermissions(ctx: OrgContext, roleId: string, permissions: string[]) {
  if (!ctx.can("roles.manage")) throw forbidden();
  const role = await ctx.db.role.findFirst({ where: { id: roleId } });
  if (!role) throw notFound("Роль не найдена");
  if (role.key === "OWNER") throw new AppError("Права собственника не настраиваются");
  const known = new Set<string>(ALL_PERMISSIONS);
  const clean = [...new Set(permissions)].filter(
    (p) => known.has(p) && !OWNER_ONLY.includes(p as Permission),
  );
  await ctx.db.role.update({ where: { id: role.id }, data: { permissions: clean } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "role.permissions_update", "Role", role.id, {
    role: role.key,
    permissions: clean,
  });
}
