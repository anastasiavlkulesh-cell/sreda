"use server";
import { cookieOptions } from "@/server/cookies";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { requireUser } from "@/server/auth/session";
import { actionContext, ORG_COOKIE } from "@/server/context";
import {
  createOrganization, updateOrganization, createLocation, archiveLocation, createDepartment,
  inviteMember, revokeInvitation, changeMemberRole, deactivateMember, updateRolePermissions, updateOrgSettings,
} from "@/server/services/organizations";
import { createDemoOrganization } from "@/server/services/demo";
import { createOrgSchema, inviteSchema, locationSchema, roleKeySchema, toArray, INDUSTRIES } from "@/lib/validation";
import { validatePrioritySettings } from "@/domain/priority";

async function setOrgCookie(orgId: string) {
  (await cookies()).set(ORG_COOKIE, orgId, cookieOptions());
}

export const createOrgAction = defineAction("createOrg", createOrgSchema, async (input) => {
  const user = await requireUser();
  const org = await createOrganization(user.id, input);
  await setOrgCookie(org.id);
  redirect("/dashboard");
});

export const createDemoAction = defineAction("createDemo", z.object({}), async () => {
  const user = await requireUser();
  const org = await createDemoOrganization(user.id);
  await setOrgCookie(org.id);
  redirect("/dashboard");
});

export const updateOrgAction = defineAction(
  "updateOrg",
  z.object({ name: z.string().trim().min(2).max(120), industry: z.enum(Object.keys(INDUSTRIES) as [string, ...string[]]) }),
  async (input) => {
    const ctx = await actionContext("org.manage");
    await updateOrganization(ctx, input);
    revalidatePath("/", "layout");
    return { ok: true, message: "Данные компании сохранены" };
  },
);

export const updatePrivacyAction = defineAction(
  "updatePrivacy",
  z.object({
    allowExternalAI: z.string().optional(),
    allowAnonymizedAnalytics: z.string().optional(),
    allowModelTraining: z.string().optional(),
    anonymityMinGroup: z.coerce.number().int().min(3).max(20),
    retentionMonths: z.coerce.number().int().min(6).max(120),
  }),
  async (i) => {
    const ctx = await actionContext("org.manage");
    await updateOrgSettings(ctx, {
      allowExternalAI: i.allowExternalAI === "on",
      allowAnonymizedAnalytics: i.allowAnonymizedAnalytics === "on",
      allowModelTraining: i.allowModelTraining === "on",
      anonymityMinGroup: i.anonymityMinGroup,
      retentionMonths: i.retentionMonths,
    });
    revalidatePath("/settings");
    return { ok: true, message: "Настройки данных сохранены" };
  },
);

export const updatePriorityAction = defineAction(
  "updatePriority",
  z.object({
    severity: z.coerce.number(), businessImpact: z.coerce.number(), urgency: z.coerce.number(),
    scale: z.coerce.number(), systemic: z.coerce.number(),
    P1: z.coerce.number(), P2: z.coerce.number(), P3: z.coerce.number(),
  }),
  async (i) => {
    const ctx = await actionContext("org.manage");
    const settings = {
      weights: { severity: i.severity, businessImpact: i.businessImpact, urgency: i.urgency, scale: i.scale, systemic: i.systemic },
      thresholds: { P1: i.P1, P2: i.P2, P3: i.P3 },
    };
    const errors = validatePrioritySettings(settings);
    if (errors.length) return { ok: false, error: errors.join(" ") };
    await updateOrgSettings(ctx, { priority: settings });
    revalidatePath("/settings");
    return { ok: true, message: "Параметры приоритизации сохранены. Они применятся к следующему анализу." };
  },
);

export const createLocationAction = defineAction("createLocation", locationSchema, async (input) => {
  const ctx = await actionContext("locations.manage");
  await createLocation(ctx, input);
  revalidatePath("/settings");
  return { ok: true, message: "Точка добавлена" };
});

export const archiveLocationAction = defineAction("archiveLocation", z.object({ id: z.string() }), async ({ id }) => {
  const ctx = await actionContext("locations.manage");
  await archiveLocation(ctx, id);
  revalidatePath("/settings");
  return { ok: true, message: "Точка перенесена в архив" };
});

export const createDepartmentAction = defineAction(
  "createDepartment",
  z.object({ name: z.string().trim().min(2).max(120), locationId: z.string().optional() }),
  async (input) => {
    const ctx = await actionContext("locations.manage");
    await createDepartment(ctx, input);
    revalidatePath("/settings");
    return { ok: true, message: "Подразделение добавлено" };
  },
);

export const inviteMemberAction = defineAction("inviteMember", inviteSchema, async (input) => {
  const ctx = await actionContext("members.invite");
  const { token } = await inviteMember(ctx, { ...input, locationIds: toArray(input.locationIds) });
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const link = `${base}/invite/${token}`;
  const { notifyInvitation } = await import("@/server/services/notifications");
  const sent = await notifyInvitation(input.email, ctx.org.name, link);
  revalidatePath("/settings");
  return {
    ok: true,
    message: sent ? "Приглашение отправлено на e-mail. Ссылка также доступна ниже." : "Приглашение создано. Отправьте ссылку сотруднику.",
    data: { link },
  };
});

export const revokeInvitationAction = defineAction("revokeInvitation", z.object({ id: z.string() }), async ({ id }) => {
  const ctx = await actionContext("members.invite");
  await revokeInvitation(ctx, id);
  revalidatePath("/settings");
  return { ok: true, message: "Приглашение отозвано" };
});

export const changeRoleAction = defineAction(
  "changeRole",
  z.object({ membershipId: z.string(), roleKey: roleKeySchema, locationIds: z.union([z.string(), z.array(z.string())]).optional() }),
  async (input) => {
    const ctx = await actionContext("members.manage");
    await changeMemberRole(ctx, { ...input, locationIds: toArray(input.locationIds) });
    revalidatePath("/settings");
    return { ok: true, message: "Роль обновлена" };
  },
);

export const deactivateMemberAction = defineAction("deactivateMember", z.object({ membershipId: z.string() }), async ({ membershipId }) => {
  const ctx = await actionContext("members.manage");
  await deactivateMember(ctx, membershipId);
  revalidatePath("/settings");
  return { ok: true, message: "Доступ пользователя отключён" };
});

export const updateRolePermissionsAction = defineAction(
  "updateRolePermissions",
  z.object({ roleId: z.string(), permissions: z.union([z.string(), z.array(z.string())]).optional() }),
  async ({ roleId, permissions }) => {
    const ctx = await actionContext("roles.manage");
    await updateRolePermissions(ctx, roleId, toArray(permissions));
    revalidatePath("/settings");
    return { ok: true, message: "Права роли сохранены" };
  },
);
