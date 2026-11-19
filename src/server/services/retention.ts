import "server-only";
import { prisma } from "../db/client";
import { audit } from "../audit";

/**
 * Политика хранения: исходные ответы анкет удаляются по истечении срока,
 * заданного компанией (по умолчанию 36 месяцев). Расчёты SERVICE 5D, выводы
 * и доказательства в агрегированном виде сохраняются — в них нет персональных
 * данных. Служебные журналы: попытки входа — 30 дней, уведомления — 12 месяцев.
 */
export async function applyRetention(now = new Date()) {
  const orgs = await prisma.organization.findMany({ select: { id: true, settings: true } });
  let responses = 0;
  for (const o of orgs) {
    const months = Number((o.settings as { retentionMonths?: number })?.retentionMonths ?? 36);
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const res = await prisma.surveyResponse.deleteMany({ where: { organizationId: o.id, submittedAt: { lt: cutoff } } });
    if (res.count) {
      responses += res.count;
      await audit({ orgId: o.id, userId: null }, "retention.survey_responses_deleted", "SurveyResponse", null, { count: res.count, months });
    }
  }
  const attempts = await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86400_000) } } });
  const notifCutoff = new Date(now);
  notifCutoff.setUTCMonth(notifCutoff.getUTCMonth() - 12);
  const notifications = await prisma.notification.deleteMany({ where: { createdAt: { lt: notifCutoff } } });
  return { responses, loginAttempts: attempts.count, notifications: notifications.count };
}
