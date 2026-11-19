import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { prisma } from "../db/client";

import type { SessionUser } from "./types";
export type { SessionUser };

/** Текущий пользователь (проверка в БД: не заблокирован, версия сессии актуальна). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  if (!session?.uid) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.uid },
    select: { id: true, email: true, name: true, isPlatformStaff: true, disabledAt: true, sessionVersion: true },
  });
  if (!user || user.disabledAt || user.sessionVersion !== session.sv) return null;
  return { id: user.id, email: user.email, name: user.name, isPlatformStaff: user.isPlatformStaff };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
