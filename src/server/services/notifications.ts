import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "../db/client";
import { decrypt } from "../crypto";
import { log, errorMeta } from "../logger";

/**
 * Уведомления: в приложении (всегда), e-mail (если задан SMTP_URL),
 * Telegram (если задан TELEGRAM_BOT_TOKEN и пользователь указал chat id).
 * Если канал не настроен, уведомление сохраняется только в приложении —
 * это явно показывается в настройках («канал не подключён»).
 */

let transporter: Transporter | null | undefined;
function mailer() {
  if (transporter !== undefined) return transporter;
  transporter = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
  return transporter;
}

export const channelStatus = () => ({
  email: !!process.env.SMTP_URL,
  telegram: !!process.env.TELEGRAM_BOT_TOKEN,
});

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const t = mailer();
  if (!t) return false;
  try {
    await t.sendMail({ from: process.env.SMTP_FROM ?? "СРЕДА <no-reply@localhost>", to, subject, text });
    return true;
  } catch (e) {
    log.error("notify.email_failed", errorMeta(e));
    return false;
  }
}

export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch (e) {
    log.error("notify.telegram_failed", errorMeta(e));
    return false;
  }
}

export async function notifyInvitation(email: string, orgName: string, link: string) {
  return sendEmail(
    email,
    `Приглашение в «${orgName}» на платформе СРЕДА`,
    `Здравствуйте!\n\nВас пригласили в компанию «${orgName}» на платформе СРЕДА.\nПринять приглашение: ${link}\n\nСсылка действует ограниченное время.`,
  );
}

export interface NotifyInput {
  orgId: string;
  userIds: string[];
  type: string;
  title: string;
  body: string;
  link?: string;
}

/** Создаёт уведомления в приложении и рассылает по подключённым каналам. */
export async function notifyUsers(input: NotifyInput) {
  const ids = [...new Set(input.userIds)].filter(Boolean);
  if (!ids.length) return;
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, disabledAt: null, memberships: { some: { organizationId: input.orgId, archivedAt: null } } },
  });
  const base = process.env.APP_URL ?? "http://localhost:3000";
  for (const u of users) {
    const n = await prisma.notification.create({
      data: { organizationId: input.orgId, userId: u.id, type: input.type, title: input.title, body: input.body, link: input.link ?? null },
    });
    const text = `${input.title}\n\n${input.body}${input.link ? `\n\n${base}${input.link}` : ""}`;
    const updates: { emailSentAt?: Date; telegramSentAt?: Date } = {};
    if (u.notifyEmail && (await sendEmail(u.email, `СРЕДА: ${input.title}`, text))) updates.emailSentAt = new Date();
    if (u.notifyTelegram && u.telegramChatIdEnc) {
      let chat: string | null = null;
      try {
        chat = decrypt(u.telegramChatIdEnc);
      } catch {
        chat = null;
      }
      if (chat && (await sendTelegram(chat, text))) updates.telegramSentAt = new Date();
    }
    if (Object.keys(updates).length) await prisma.notification.update({ where: { id: n.id }, data: updates });
  }
}

export async function usersWithPermission(orgId: string, permission: string): Promise<string[]> {
  const ms = await prisma.organizationMembership.findMany({
    where: { organizationId: orgId, archivedAt: null, role: { permissions: { has: permission } } },
    select: { userId: true, expiresAt: true },
  });
  const now = new Date();
  return ms.filter((m) => !m.expiresAt || m.expiresAt > now).map((m) => m.userId);
}

// ---------------------------------------------------------------------------
// Уведомления в приложении
// ---------------------------------------------------------------------------

export async function listNotifications(userId: string, orgId: string, take = 50) {
  return prisma.notification.findMany({ where: { userId, organizationId: orgId }, orderBy: { createdAt: "desc" }, take });
}

export async function unreadCount(userId: string, orgId: string) {
  return prisma.notification.count({ where: { userId, organizationId: orgId, readAt: null } });
}

export async function markRead(userId: string, orgId: string, id?: string) {
  await prisma.notification.updateMany({
    where: { userId, organizationId: orgId, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  });
}
