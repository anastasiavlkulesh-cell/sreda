import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "./auth/session";
import type { Permission } from "@/domain/rbac";
import { AppError, forbidden } from "./errors";
import { loadOrgContext, type OrgContext } from "./context-core";

export * from "./context-core";
export const ORG_COOKIE = "sreda_org";

export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const store = await cookies();
  return loadOrgContext(user, store.get(ORG_COOKIE)?.value);
});

/** Для страниц: перенаправляет на вход, онбординг или страницу «нет доступа». */
export async function requireOrgContext(permission?: Permission): Promise<OrgContext> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await getOrgContext();
  if (!ctx) redirect("/onboarding");
  if (permission && !ctx.can(permission)) redirect("/forbidden");
  return ctx;
}

/** Для серверных действий: бросает AppError вместо перенаправления. */
export async function actionContext(permission?: Permission | Permission[]): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) throw new AppError("Требуется вход в систему", "UNAUTHORIZED");
  const perms = Array.isArray(permission) ? permission : permission ? [permission] : [];
  if (perms.length && !perms.some((p) => ctx.can(p))) throw forbidden();
  return ctx;
}
