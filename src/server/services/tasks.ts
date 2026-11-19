import "server-only";
import type { OrgContext } from "../context-core";
import { audit } from "../audit";
import { AppError, forbidden, notFound } from "../errors";
import { prisma } from "../db/client";
import { nextStatus, reviewEvidence, isOverdue, evaluateOutcome, type TaskAction, type TaskStatus } from "@/domain/tasks";
import { METHODOLOGY_VERSION, DIMENSIONS } from "@/domain/methodology/v1";
import { saveFile } from "../storage";
import { notifyUsers } from "./notifications";
import { parseDimensions } from "./assessment";
import type { Prisma } from "@/generated/prisma/client";
import type { PriorityCategory } from "@/generated/prisma/enums";
import { TASK_STATUS_LABELS } from "@/lib/labels";

/** Видимость задач: сотрудник — только свои; руководитель — все в своей области. */
export function taskVisibilityWhere(ctx: OrgContext): Prisma.TaskWhereInput {
  const own: Prisma.TaskWhereInput = { OR: [{ assigneeUserId: ctx.user.id }, { coAssigneeIds: { has: ctx.user.id } }] };
  if (!ctx.can("tasks.view_all")) return own;
  if (ctx.locationScope) return { OR: [own, { locationId: { in: ctx.locationScope } }, { locationId: null }] };
  return {};
}

export async function listTasks(ctx: OrgContext, filter: { scope?: "mine" | "all"; status?: TaskStatus } = {}) {
  if (!ctx.can("tasks.work") && !ctx.can("tasks.view_all")) throw forbidden();
  const mine = filter.scope === "mine" || !ctx.can("tasks.view_all");
  return ctx.db.task.findMany({
    where: {
      archivedAt: null,
      ...(mine ? { OR: [{ assigneeUserId: ctx.user.id }, { coAssigneeIds: { has: ctx.user.id } }] } : taskVisibilityWhere(ctx)),
      ...(filter.status ? { status: filter.status } : {}),
      // Черновики плана видят только те, кто управляет планом
      ...(ctx.can("plan.manage") ? {} : { status: { notIn: ["NEW", "PENDING_APPROVAL"], ...(filter.status ? { equals: filter.status } : {}) } }),
    },
    orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
    include: { checklist: { select: { isDone: true } }, _count: { select: { evidence: true, comments: true } } },
  });
}

async function loadTask(ctx: OrgContext, id: string) {
  const t = await ctx.db.task.findFirst({ where: { id, archivedAt: null, ...taskVisibilityWhere(ctx) } });
  if (!t) throw notFound("Задача не найдена");
  if (!ctx.can("plan.manage") && (t.status === "NEW" || t.status === "PENDING_APPROVAL")) throw notFound("Задача не найдена");
  return t;
}

const isPerformer = (ctx: OrgContext, t: { assigneeUserId: string | null; coAssigneeIds: string[] }) =>
  t.assigneeUserId === ctx.user.id || t.coAssigneeIds.includes(ctx.user.id);

export async function getTask(ctx: OrgContext, id: string) {
  const t = await loadTask(ctx, id);
  const full = await ctx.db.task.findFirstOrThrow({
    where: { id: t.id },
    include: {
      checklist: { orderBy: { sortOrder: "asc" } },
      comments: { orderBy: { createdAt: "asc" } },
      evidence: { orderBy: { createdAt: "asc" }, include: { file: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } } } },
      plan: { select: { id: true, title: true, status: true } },
      problem: { select: { id: true, title: true, findingStatus: true, criterionCode: true, status: true } },
    },
  });
  const userIds = [...new Set([full.assigneeUserId, ...full.coAssigneeIds, ...full.comments.map((c) => c.authorUserId), ...full.evidence.map((e) => e.addedByUserId)].filter(Boolean))] as string[];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const history = await ctx.db.auditLog.findMany({ where: { entityType: "Task", entityId: id }, orderBy: { createdAt: "asc" } });
  const historyUsers = await prisma.user.findMany({ where: { id: { in: history.map((h) => h.actorUserId!).filter(Boolean) } }, select: { id: true, name: true } });
  return {
    task: full,
    users: new Map([...users, ...historyUsers].map((u) => [u.id, u.name])),
    history,
    can: {
      edit: ctx.can("tasks.manage") || ctx.can("plan.manage"),
      work: isPerformer(ctx, full),
      review: ctx.can("tasks.manage") && full.assigneeUserId !== ctx.user.id,
    },
  };
}

async function transition(ctx: OrgContext, id: string, action: TaskAction, extra: Prisma.TaskUncheckedUpdateInput = {}, meta: Record<string, unknown> = {}) {
  const t = await loadTask(ctx, id);
  const to = nextStatus(t.status as TaskStatus, action);
  if (!to) throw new AppError(`Действие недоступно в статусе «${TASK_STATUS_LABELS[t.status]}»`);
  const updated = await ctx.db.task.update({ where: { id }, data: { status: to, ...extra } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, `task.${action}`, "Task", id, { from: t.status, to, ...meta });
  return { before: t, task: updated };
}

export async function updateTask(
  ctx: OrgContext,
  id: string,
  input: { title?: string; solution?: string; assigneeUserId?: string | null; coAssigneeIds?: string[]; dueDate?: Date | null; priority?: PriorityCategory },
) {
  if (!ctx.can("tasks.manage") && !ctx.can("plan.manage")) throw forbidden();
  const t = await loadTask(ctx, id);
  if (t.status === "DONE") throw new AppError("Выполненную задачу нельзя изменить");
  const ids = [input.assigneeUserId, ...(input.coAssigneeIds ?? [])].filter(Boolean) as string[];
  if (ids.length) {
    const members = await ctx.db.organizationMembership.count({ where: { userId: { in: ids }, archivedAt: null, role: { permissions: { has: "tasks.work" } } } });
    if (members !== new Set(ids).size) throw new AppError("Ответственный должен быть участником компании с доступом к задачам");
  }
  if (input.dueDate && input.dueDate.getTime() < Date.now() - 86400_000) throw new AppError("Срок не может быть в прошлом");
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined && JSON.stringify(v) !== JSON.stringify((t as Record<string, unknown>)[k])) changes[k] = v;
  if (!Object.keys(changes).length) return t;
  const updated = await ctx.db.task.update({
    where: { id },
    data: {
      ...input,
      coAssigneeIds: input.coAssigneeIds ? [...new Set(input.coAssigneeIds.filter((x) => x !== input.assigneeUserId))] : undefined,
      // Если перенесли срок просроченной задачи — возвращаем в работу
      ...(t.status === "OVERDUE" && input.dueDate && input.dueDate > new Date() ? { status: t.startedAt ? "IN_PROGRESS" : "PLANNED" } : {}),
    },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "task.update", "Task", id, { fields: Object.keys(changes) });
  if (input.assigneeUserId && input.assigneeUserId !== t.assigneeUserId && !["NEW", "PENDING_APPROVAL"].includes(t.status)) {
    await notifyUsers({ orgId: ctx.org.id, userIds: [input.assigneeUserId], type: "task.assigned", title: "Вам назначена задача", body: t.title, link: `/tasks/${id}` });
  }
  return updated;
}

export async function createTask(
  ctx: OrgContext,
  input: { title: string; solution: string; problemSummary: string; assigneeUserId: string; dueDate: Date; priority: PriorityCategory; locationId?: string | null },
) {
  if (!ctx.can("tasks.manage")) throw forbidden();
  const member = await ctx.db.organizationMembership.findFirst({ where: { userId: input.assigneeUserId, archivedAt: null } });
  if (!member) throw new AppError("Ответственный должен быть участником компании");
  const t = await ctx.db.task.create({
    data: {
      organizationId: ctx.org.id,
      title: input.title,
      solution: input.solution,
      problemSummary: input.problemSummary,
      assigneeUserId: input.assigneeUserId,
      dueDate: input.dueDate,
      priority: input.priority,
      locationId: input.locationId ?? ctx.locationScope?.[0] ?? null,
      status: "PLANNED",
      createdById: ctx.user.id,
    },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "task.create", "Task", t.id);
  await notifyUsers({ orgId: ctx.org.id, userIds: [input.assigneeUserId], type: "task.assigned", title: "Вам назначена задача", body: t.title, link: `/tasks/${t.id}` });
  return t;
}

export async function startTask(ctx: OrgContext, id: string) {
  const t = await loadTask(ctx, id);
  if (!isPerformer(ctx, t)) throw forbidden("Начать работу может только исполнитель");
  return transition(ctx, id, "start", { startedAt: t.startedAt ?? new Date() });
}

export async function toggleChecklistItem(ctx: OrgContext, taskId: string, itemId: string, isDone: boolean) {
  const t = await loadTask(ctx, taskId);
  if (!isPerformer(ctx, t) && !ctx.can("tasks.manage")) throw forbidden();
  if (["DONE", "NEW", "PENDING_APPROVAL"].includes(t.status)) throw new AppError("Чек-лист сейчас нельзя менять");
  const item = await ctx.db.taskChecklistItem.findFirst({ where: { id: itemId, taskId } });
  if (!item) throw notFound();
  await ctx.db.taskChecklistItem.update({ where: { id: itemId }, data: { isDone, doneAt: isDone ? new Date() : null } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "task.checklist", "Task", taskId, { item: item.text, isDone });
}

export async function addComment(ctx: OrgContext, taskId: string, body: string) {
  const t = await loadTask(ctx, taskId);
  const text = body.trim();
  if (!text) throw new AppError("Комментарий пуст");
  await ctx.db.taskComment.create({ data: { organizationId: ctx.org.id, taskId, authorUserId: ctx.user.id, body: text.slice(0, 4000) } });
  const notify = [t.assigneeUserId, ...t.coAssigneeIds, t.createdById].filter((u): u is string => !!u && u !== ctx.user.id);
  await notifyUsers({ orgId: ctx.org.id, userIds: notify, type: "task.comment", title: `Комментарий к задаче «${t.title.slice(0, 60)}»`, body: text.slice(0, 300), link: `/tasks/${taskId}` });
}

export async function addEvidence(ctx: OrgContext, taskId: string, input: { kind: "FILE" | "LINK" | "TEXT"; description: string; url?: string; file?: File }) {
  const t = await loadTask(ctx, taskId);
  if (!isPerformer(ctx, t) && !ctx.can("tasks.manage")) throw forbidden();
  if (["DONE", "NEW", "PENDING_APPROVAL"].includes(t.status)) throw new AppError("Сейчас нельзя добавлять доказательства");
  if (!input.description.trim()) throw new AppError("Опишите, что подтверждает доказательство");
  let fileId: string | null = null;
  if (input.kind === "FILE") {
    if (!input.file) throw new AppError("Выберите файл");
    fileId = (await saveFile(ctx.db, ctx.org.id, ctx.user.id, input.file)).id;
  }
  if (input.kind === "LINK" && !/^https?:\/\//.test(input.url ?? "")) throw new AppError("Ссылка должна начинаться с http:// или https://");
  const ev = await ctx.db.taskEvidence.create({
    data: {
      organizationId: ctx.org.id,
      taskId,
      kind: input.kind,
      description: input.description.trim().slice(0, 1000),
      url: input.kind === "LINK" ? input.url! : null,
      fileId,
      addedByUserId: ctx.user.id,
    },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "task.evidence_add", "Task", taskId, { kind: input.kind });
  return ev;
}

/** Отправка на проверку: обязательна хотя бы одна запись-доказательство; выполняется AI-проверка доказательств. */
export async function submitForReview(ctx: OrgContext, id: string) {
  const t = await loadTask(ctx, id);
  if (!isPerformer(ctx, t)) throw forbidden("Отправить на проверку может только исполнитель");
  const [evidence, checklist] = await Promise.all([
    ctx.db.taskEvidence.findMany({ where: { taskId: id }, include: { file: { select: { mimeType: true } } } }),
    ctx.db.taskChecklistItem.findMany({ where: { taskId: id } }),
  ]);
  if (evidence.length === 0) throw new AppError("Приложите хотя бы одно доказательство выполнения");
  const review = reviewEvidence({
    evidence: evidence.map((e) => ({ kind: e.kind, description: e.description, mimeType: e.file?.mimeType, createdAt: e.createdAt })),
    checklistTotal: checklist.length,
    checklistDone: checklist.filter((c) => c.isDone).length,
    startedAt: t.startedAt,
    priority: t.priority,
  });
  await ctx.db.aIAnalysis.create({
    data: {
      organizationId: ctx.org.id,
      kind: "TASK_EVIDENCE",
      status: "COMPLETED",
      methodologyVersion: METHODOLOGY_VERSION,
      provider: "rules",
      inputSummary: { taskId: id, evidence: evidence.length, checklist: checklist.length } as object,
      output: review as unknown as object,
      limitations: [review.note],
      requestedById: ctx.user.id,
      completedAt: new Date(),
    },
  });
  const res = await transition(ctx, id, "submit_review", { evidenceReview: review as unknown as object }, { verdict: review.verdict });
  await notifyUsers({
    orgId: ctx.org.id,
    userIds: [t.createdById].filter((u) => u !== ctx.user.id),
    type: "task.review",
    title: "Задача отправлена на проверку",
    body: `${t.title}. Проверка доказательств: ${review.verdict === "SUFFICIENT" ? "достаточно" : review.verdict === "INSUFFICIENT" ? "недостаточно" : "нужна оценка руководителя"}.`,
    link: `/tasks/${id}`,
  });
  return { ...res, review };
}

export async function reviewTask(ctx: OrgContext, id: string, decision: "accept" | "reject", comment: string) {
  if (!ctx.can("tasks.manage")) throw forbidden();
  const t = await loadTask(ctx, id);
  if (t.assigneeUserId === ctx.user.id) throw forbidden("Нельзя принимать собственную задачу — нужна проверка другим руководителем");
  if (decision === "reject" && !comment.trim()) throw new AppError("Укажите, что нужно доработать");
  const res =
    decision === "accept"
      ? await transition(ctx, id, "accept", { completedAt: new Date(), outcome: t.problemId ? "AWAITING_REMEASURE" : "NOT_EVALUATED" })
      : await transition(ctx, id, "reject", {}, { comment });
  if (comment.trim()) await ctx.db.taskComment.create({ data: { organizationId: ctx.org.id, taskId: id, authorUserId: ctx.user.id, body: comment.trim() } });
  if (decision === "accept" && t.problemId) await ctx.db.problem.update({ where: { id: t.problemId }, data: { status: "MONITORING" } });
  await notifyUsers({
    orgId: ctx.org.id,
    userIds: [t.assigneeUserId, ...t.coAssigneeIds].filter((u): u is string => !!u),
    type: decision === "accept" ? "task.accepted" : "task.rejected",
    title: decision === "accept" ? "Задача принята" : "Задача возвращена на доработку",
    body: `${t.title}${comment ? `: ${comment}` : ""}`,
    link: `/tasks/${id}`,
  });
  return res;
}

/** Плановая проверка сроков (вызывается из /api/cron/overdue). */
export async function markOverdueTasks(orgId?: string) {
  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: { archivedAt: null, status: { in: ["PLANNED", "IN_PROGRESS", "NEEDS_REVISION"] }, dueDate: { lt: now }, ...(orgId ? { organizationId: orgId } : {}) },
  });
  for (const t of tasks) {
    if (!isOverdue(t.status as TaskStatus, t.dueDate, now)) continue;
    await prisma.task.update({ where: { id: t.id }, data: { status: "OVERDUE" } });
    await audit({ orgId: t.organizationId, userId: null }, "task.mark_overdue", "Task", t.id, { from: t.status });
    await notifyUsers({
      orgId: t.organizationId,
      userIds: [t.assigneeUserId, t.createdById].filter((u): u is string => !!u),
      type: "task.overdue",
      title: "Задача просрочена",
      body: t.title,
      link: `/tasks/${t.id}`,
    });
  }
  return tasks.length;
}

/**
 * Оценка результата повторным замером: для выполненных задач, связанных с
 * проблемой, сравниваем критерий проблемы в исходной и новой диагностике.
 * Улучшение ≥ 0,3 балла → «улучшение подтверждено»; иначе → «эффект не
 * подтверждён», проблема возвращается в работу.
 */
export async function evaluateTaskOutcomes(ctx: OrgContext, newDiagnosticId: string) {
  const newAssessment = await ctx.db.assessment.findFirst({ where: { diagnosticId: newDiagnosticId }, orderBy: { calculatedAt: "desc" } });
  if (!newAssessment) return { evaluated: 0 };
  const after = new Map(parseDimensions(newAssessment.dimensions).flatMap((d) => d.criteria.map((c) => [c.code, effective(d.key, c)])));
  const tasks = await ctx.db.task.findMany({
    where: { status: "DONE", outcome: "AWAITING_REMEASURE", problem: { diagnosticId: { not: newDiagnosticId } } },
    include: { problem: true },
  });
  let evaluated = 0;
  for (const t of tasks) {
    if (!t.problem?.criterionCode) continue;
    const prevAssessment = await ctx.db.assessment.findFirst({ where: { diagnosticId: t.problem.diagnosticId }, orderBy: { calculatedAt: "desc" } });
    if (!prevAssessment || prevAssessment.calculatedAt > newAssessment.calculatedAt) continue;
    const before = new Map(parseDimensions(prevAssessment.dimensions).flatMap((d) => d.criteria.map((c) => [c.code, effective(d.key, c)])));
    const b = before.get(t.problem.criterionCode) ?? null;
    const a = after.get(t.problem.criterionCode) ?? null;
    const outcome = evaluateOutcome(b, a);
    if (outcome === "AWAITING_REMEASURE") continue;
    const note = `${t.problem.criterionCode}: ${b!.toFixed(1)} → ${a!.toFixed(1)} (повторный замер).`;
    await ctx.db.task.update({ where: { id: t.id }, data: { outcome, outcomeNote: note } });
    await ctx.db.problem.update({
      where: { id: t.problem.id },
      data: { status: outcome === "IMPROVED" && a! > 3 ? "RESOLVED" : outcome === "IMPROVED" ? "MONITORING" : "OPEN" },
    });
    await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "task.outcome", "Task", t.id, { outcome, before: b, after: a });
    evaluated++;
  }
  return { evaluated };
}

/** Эффективная оценка критерия: минимум из итоговой и оценки ключевых источников направления. */
function effective(dim: string, c: { score: number | null; bySource: Partial<Record<string, { mean: number }>> }): number | null {
  if (c.score === null) return null;
  const keys = DIMENSIONS.find((d) => d.key === dim)!.keySources.filter((s) => s !== "OWNER" && s !== "MANAGER");
  const vals = keys.map((k) => c.bySource[k]?.mean).filter((v): v is number => v !== undefined);
  const km = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
  return km === null ? c.score : Math.min(c.score, km);
}
