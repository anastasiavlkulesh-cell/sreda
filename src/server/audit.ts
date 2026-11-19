import "server-only";
import { prisma } from "./db/client";
import { log, errorMeta } from "./logger";

export interface AuditActor {
  orgId: string | null;
  userId: string | null;
}

/**
 * Журнал аудита. Пишется для всех значимых действий: вход, изменения прав,
 * утверждения, изменения задач, доступ экспертов, экспорт, AI-анализ.
 * Ошибка записи аудита логируется, но не прерывает основное действие.
 */
export async function audit(
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId?: string | null,
  meta: Record<string, unknown> = {},
) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: actor.orgId,
        actorUserId: actor.userId,
        action,
        entityType,
        entityId: entityId ?? null,
        meta: meta as object,
      },
    });
  } catch (e) {
    log.error("audit.write_failed", { action, entityType, ...errorMeta(e) });
  }
}

export const actorOf = (ctx: { org: { id: string }; user: { id: string } }): AuditActor => ({
  orgId: ctx.org.id,
  userId: ctx.user.id,
});
