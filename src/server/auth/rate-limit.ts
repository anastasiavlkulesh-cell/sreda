import "server-only";
import { prisma } from "../db/client";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

/** Ограничение перебора паролей: не более 5 неудачных попыток за 15 минут на e-mail. */
export async function isLoginBlocked(email: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const failures = await prisma.loginAttempt.count({
    where: { key: email, success: false, createdAt: { gte: since } },
  });
  return failures >= MAX_FAILURES;
}

export async function recordLoginAttempt(email: string, success: boolean) {
  await prisma.loginAttempt.create({ data: { key: email, success } });
  if (success) {
    await prisma.loginAttempt.deleteMany({ where: { key: email, success: false } });
  }
}
