import "server-only";
import { prisma } from "./client";

/**
 * Модели, принадлежащие компании (имеют organizationId).
 * Для них tenantDb() принудительно добавляет organizationId в каждый запрос:
 * чтение/изменение/удаление — в where, создание — в data. Это вторая линия
 * защиты поверх проверок прав в сервисах: даже ошибка в коде сервиса не
 * позволит прочитать или изменить запись другой компании по её id.
 */
export const TENANT_MODELS = new Set([
  "Role",
  "OrganizationMembership",
  "Invitation",
  "Location",
  "Department",
  "Employee",
  "Diagnostic",
  "Survey",
  "SurveyInvite",
  "SurveyResponse",
  "Assessment",
  "Evidence",
  "Problem",
  "ProblemCause",
  "AIAnalysis",
  "AIRecommendation",
  "ImprovementPlan",
  "Task",
  "TaskChecklistItem",
  "TaskComment",
  "TaskEvidence",
  "TrainingCourse",
  "TrainingProgress",
  "Standard",
  "StandardVersion",
  "Checklist",
  "CustomerFeedback",
  "Complaint",
  "BusinessMetric",
  "Report",
  "Notification",
  "StoredFile",
  "AuditLog",
]);

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

type Args = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
};

export function scopeArgs(orgId: string, model: string, operation: string, rawArgs: unknown): Args {
  const args = { ...((rawArgs as Args) ?? {}) };
  if (!TENANT_MODELS.has(model)) return args;

  if (WHERE_OPS.has(operation)) {
    args.where = { ...(args.where ?? {}), organizationId: orgId };
  }
  if (operation === "create") {
    args.data = withOrg(args.data, orgId);
  }
  if (operation === "createMany" || operation === "createManyAndReturn") {
    const data = args.data;
    args.data = Array.isArray(data) ? data.map((d) => withOrg(d, orgId)) : withOrg(data, orgId);
  }
  if (operation === "upsert") {
    args.where = { ...(args.where ?? {}), organizationId: orgId };
    args.create = withOrg(args.create, orgId) as Record<string, unknown>;
  }
  if ((operation === "update" || operation === "updateMany") && args.data && typeof args.data === "object") {
    // Запрет переноса записи в другую компанию
    const d = args.data as Record<string, unknown>;
    if ("organizationId" in d && d.organizationId !== orgId) {
      throw new Error("Нельзя менять принадлежность записи компании");
    }
  }
  return args;
}

function withOrg(data: unknown, orgId: string) {
  const d = (data ?? {}) as Record<string, unknown>;
  if ("organizationId" in d && d.organizationId !== orgId) {
    throw new Error("Попытка записи в чужую компанию");
  }
  return { ...d, organizationId: orgId };
}

export function tenantDb(orgId: string) {
  if (!orgId) throw new Error("tenantDb: не указана компания");
  return prisma.$extends({
    name: `tenant:${orgId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(orgId, model, operation, args) as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
