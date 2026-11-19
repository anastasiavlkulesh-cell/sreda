import "server-only";
import type { OrgContext } from "../context-core";
import { audit } from "../audit";
import { AppError, forbidden, notFound } from "../errors";
import { DUE_DAYS_BY_PRIORITY } from "@/domain/tasks";
import { CRITERIA_BY_CODE } from "@/domain/methodology/v1";
import { notifyUsers, usersWithPermission } from "./notifications";
import { diagnosticScopeWhere } from "./dashboard";
import type { PriorityCategory } from "@/generated/prisma/enums";

/**
 * Формирование плана: AI (анализатор) предлагает задачи по открытым
 * проблемам, человек редактирует и отправляет на утверждение, утверждает
 * только собственник (право plan.approve). Программного пути, по которому
 * план утверждается без действия человека, нет.
 */
export async function generatePlan(
  ctx: OrgContext,
  diagnosticId: string,
  opts: { maxPriority?: PriorityCategory; problemIds?: string[] } = {},
) {
  if (!ctx.can("plan.manage")) throw forbidden();
  const diagnostic = await ctx.db.diagnostic.findFirst({ where: { id: diagnosticId, archivedAt: null, ...diagnosticScopeWhere(ctx) } });
  if (!diagnostic) throw notFound("Диагностика не найдена");
  const analysis = await ctx.db.aIAnalysis.findFirst({
    where: { diagnosticId, kind: "DIAGNOSTIC", status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });
  if (!analysis) throw new AppError("Сначала выполните AI-анализ диагностики");
  const allowed: PriorityCategory[] = ["P1", "P2", "P3", "P4"].slice(0, ["P1", "P2", "P3", "P4"].indexOf(opts.maxPriority ?? "P3") + 1) as PriorityCategory[];
  const problems = await ctx.db.problem.findMany({
    where: {
      diagnosticId,
      status: "OPEN",
      ...(opts.problemIds?.length ? { id: { in: opts.problemIds } } : { priority: { in: allowed } }),
    },
    include: { causes: true, recommendations: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: [{ priority: "asc" }, { feasibility: "desc" }, { priorityScore: "desc" }],
  });
  if (problems.length === 0) throw new AppError("Нет открытых проблем для плана");
  const checklists = ((analysis.output as { checklists?: Record<string, string[]> } | null)?.checklists ?? {}) as Record<string, string[]>;

  const plan = await ctx.db.improvementPlan.create({
    data: {
      organizationId: ctx.org.id,
      diagnosticId,
      title: `План улучшений: ${diagnostic.title}`,
      generatedByAI: true,
      createdById: ctx.user.id,
    },
  });
  const now = Date.now();
  for (const p of problems) {
    const rec = p.recommendations[0];
    const supported = p.causes.filter((c) => c.findingStatus !== "HYPOTHESIS");
    const items = checklists[p.criterionCode ?? ""] ?? CRITERIA_BY_CODE.get(p.criterionCode ?? "")?.checklist ?? [];
    await ctx.db.task.create({
      data: {
        organizationId: ctx.org.id,
        planId: plan.id,
        problemId: p.id,
        locationId: diagnostic.locationId,
        title: rec?.title ?? `Устранить: ${p.title}`,
        problemSummary: p.description,
        rootCause: supported.length ? supported.map((c) => c.title.replace(/\.$/, "")).join("; ") : "Причины требуют проверки (гипотеза)",
        solution: rec ? `${rec.title}\n\n${rec.rationale}` : p.title,
        priority: p.priority,
        status: "NEW",
        dueDate: new Date(now + DUE_DAYS_BY_PRIORITY[p.priority] * 86400_000),
        createdById: ctx.user.id,
        checklist: {
          create: items.map((text, i) => ({ organizationId: ctx.org.id, text, sortOrder: i })),
        },
      },
    });
    await ctx.db.problem.update({ where: { id: p.id }, data: { status: "IN_PLAN" } });
  }
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "plan.generate", "ImprovementPlan", plan.id, { tasks: problems.length });
  return plan;
}

async function getPlan(ctx: OrgContext, id: string) {
  const plan = await ctx.db.improvementPlan.findFirst({ where: { id }, include: { tasks: { where: { archivedAt: null } } } });
  if (!plan) throw notFound("План не найден");
  return plan;
}

export async function submitPlanForApproval(ctx: OrgContext, id: string) {
  if (!ctx.can("plan.manage")) throw forbidden();
  const plan = await getPlan(ctx, id);
  if (plan.status !== "DRAFT") throw new AppError("Отправить на утверждение можно только черновик");
  if (plan.tasks.length === 0) throw new AppError("В плане нет задач");
  const missing = plan.tasks.filter((t) => !t.assigneeUserId || !t.dueDate);
  if (missing.length) throw new AppError(`Назначьте ответственного и срок для всех задач (не заполнено: ${missing.length})`);
  await ctx.db.improvementPlan.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
  await ctx.db.task.updateMany({ where: { planId: id, status: "NEW" }, data: { status: "PENDING_APPROVAL" } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "plan.submit", "ImprovementPlan", id);
  await notifyUsers({
    orgId: ctx.org.id,
    userIds: (await usersWithPermission(ctx.org.id, "plan.approve")).filter((u) => u !== ctx.user.id),
    type: "plan.pending",
    title: "План улучшений ожидает утверждения",
    body: `${plan.title}: задач — ${plan.tasks.length}.`,
    link: `/plan/${id}`,
  });
}

export async function approvePlan(ctx: OrgContext, id: string) {
  if (!ctx.can("plan.approve")) throw forbidden("Утвердить план может только собственник");
  const plan = await getPlan(ctx, id);
  if (plan.status !== "PENDING_APPROVAL") throw new AppError("План не находится на утверждении");
  await ctx.db.improvementPlan.update({ where: { id }, data: { status: "APPROVED", approvedById: ctx.user.id, approvedAt: new Date() } });
  await ctx.db.task.updateMany({ where: { planId: id, status: "PENDING_APPROVAL" }, data: { status: "PLANNED" } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "plan.approve", "ImprovementPlan", id);
  const byUser = new Map<string, number>();
  for (const t of plan.tasks) for (const u of [t.assigneeUserId, ...t.coAssigneeIds]) if (u) byUser.set(u, (byUser.get(u) ?? 0) + 1);
  for (const [userId, n] of byUser) {
    await notifyUsers({
      orgId: ctx.org.id,
      userIds: [userId],
      type: "task.assigned",
      title: "Вам назначены задачи плана улучшений",
      body: `${plan.title}: задач — ${n}.`,
      link: "/tasks",
    });
  }
}

export async function returnPlanToDraft(ctx: OrgContext, id: string, reason: string) {
  if (!ctx.can("plan.approve")) throw forbidden();
  const plan = await getPlan(ctx, id);
  if (plan.status !== "PENDING_APPROVAL") throw new AppError("План не находится на утверждении");
  await ctx.db.improvementPlan.update({ where: { id }, data: { status: "DRAFT" } });
  await ctx.db.task.updateMany({ where: { planId: id, status: "PENDING_APPROVAL" }, data: { status: "NEW" } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "plan.return", "ImprovementPlan", id, { reason });
  await notifyUsers({
    orgId: ctx.org.id,
    userIds: [plan.createdById],
    type: "plan.returned",
    title: "План возвращён на доработку",
    body: reason || "Без комментария.",
    link: `/plan/${id}`,
  });
}

export async function removeTaskFromPlan(ctx: OrgContext, taskId: string) {
  if (!ctx.can("plan.manage")) throw forbidden();
  const t = await ctx.db.task.findFirst({ where: { id: taskId, archivedAt: null }, include: { plan: true } });
  if (!t || !t.plan) throw notFound("Задача не найдена");
  if (t.plan.status !== "DRAFT") throw new AppError("Задачи можно убирать только из черновика плана");
  await ctx.db.task.update({ where: { id: taskId }, data: { archivedAt: new Date() } });
  if (t.problemId) await ctx.db.problem.update({ where: { id: t.problemId }, data: { status: "OPEN" } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "plan.task_remove", "Task", taskId);
}

export async function listPlans(ctx: OrgContext) {
  if (!ctx.can("plan.view")) throw forbidden();
  return ctx.db.improvementPlan.findMany({
    where: { status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    include: {
      diagnostic: { select: { title: true } },
      tasks: { where: { archivedAt: null }, select: { status: true, outcome: true } },
    },
  });
}

export async function getPlanDetail(ctx: OrgContext, id: string) {
  if (!ctx.can("plan.view")) throw forbidden();
  const plan = await ctx.db.improvementPlan.findFirst({
    where: { id },
    include: {
      diagnostic: { select: { id: true, title: true } },
      tasks: {
        where: { archivedAt: null },
        orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
        include: { checklist: { select: { isDone: true } }, problem: { select: { id: true, findingStatus: true } } },
      },
    },
  });
  if (!plan) throw notFound("План не найден");
  return plan;
}

/** Участники, которых можно назначать ответственными. */
export async function assignableMembers(ctx: OrgContext) {
  const ms = await ctx.db.organizationMembership.findMany({
    where: { archivedAt: null, role: { permissions: { has: "tasks.work" } } },
    include: { user: { select: { id: true, name: true } }, role: { select: { name: true, key: true } } },
  });
  return ms
    .filter((m) => m.role.key !== "PLATFORM_EXPERT")
    .filter((m) => !ctx.locationScope || m.locationIds.length === 0 || m.locationIds.some((l) => ctx.locationScope!.includes(l)))
    .map((m) => ({ id: m.user.id, name: m.user.name, role: m.role.name }));
}
