import "server-only";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "../db/client";
import { dummyHash, verifyPassword } from "./password";
import { isLoginBlocked, recordLoginAttempt } from "./rate-limit";
import { log } from "../logger";

class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

/**
 * Auth.js v5 (версия закреплена). Провайдер — e-mail и пароль.
 * Стратегия — JWT с коротким сроком; в токене только id пользователя и
 * sessionVersion. На каждом запросе пользователь перечитывается из БД
 * (см. session.ts): смена пароля или блокировка сразу инвалидируют сессии.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        if (await isLoginBlocked(email)) throw new RateLimited();

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.disabledAt) {
          await dummyHash().then((h) => verifyPassword(h, password));
          await recordLoginAttempt(email, false);
          return null;
        }
        const ok = await verifyPassword(user.passwordHash, password);
        await recordLoginAttempt(email, ok);
        if (!ok) return null;

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        log.info("auth.login", { userId: user.id });
        return { id: user.id, email: user.email, name: user.name, sv: user.sessionVersion };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.sv = (user as { sv?: number }).sv ?? 1;
      }
      return token;
    },
    session({ session, token }) {
      session.uid = token.uid as string;
      session.sv = token.sv as number;
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    uid: string;
    sv: number;
  }
}
