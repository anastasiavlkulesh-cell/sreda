"use server";
import { cookieOptions } from "@/server/cookies";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut } from "@/server/auth/auth";
import { defineAction } from "@/server/action";
import { loginSchema, registerSchema } from "@/lib/validation";
import { registerUser, acceptInvitation } from "@/server/services/organizations";
import { getSessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { ORG_COOKIE } from "@/server/context";
import { AppError } from "@/server/errors";

function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export const loginAction = defineAction("login", loginSchema, async ({ email, password, next }) => {
  try {
    await signIn("credentials", { email, password, redirectTo: safeNext(next) });
  } catch (e) {
    if (e instanceof AuthError) {
      const code = (e as AuthError & { code?: string }).code;
      if (code === "rate_limited") return { ok: false, error: "Слишком много неудачных попыток. Попробуйте через 15 минут." };
      return { ok: false, error: "Неверный e-mail или пароль" };
    }
    throw e;
  }
});

export const registerAction = defineAction("register", registerSchema, async (input) => {
  const user = await registerUser(input);
  let joinedOrg: string | null = null;
  if (input.inviteToken) {
    try {
      joinedOrg = await acceptInvitation(user, input.inviteToken);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
  }
  if (joinedOrg) (await cookies()).set(ORG_COOKIE, joinedOrg, cookieOptions());
  await signIn("credentials", { email: input.email, password: input.password, redirectTo: joinedOrg ? "/" : "/onboarding" });
});

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

export const switchOrgAction = defineAction("switchOrg", z.object({ orgId: z.string().min(1) }), async ({ orgId }) => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const m = await prisma.organizationMembership.findFirst({ where: { userId: user.id, organizationId: orgId, archivedAt: null } });
  if (!m) return { ok: false, error: "Нет доступа к этой компании" };
  (await cookies()).set(ORG_COOKIE, orgId, cookieOptions());
  redirect("/");
});

export const acceptInviteAction = defineAction("acceptInvite", z.object({ token: z.string().min(10) }), async ({ token }) => {
  const user = await getSessionUser();
  if (!user) redirect(`/register?invite=${encodeURIComponent(token)}`);
  const orgId = await acceptInvitation(user, token);
  (await cookies()).set(ORG_COOKIE, orgId, cookieOptions());
  redirect("/");
});
