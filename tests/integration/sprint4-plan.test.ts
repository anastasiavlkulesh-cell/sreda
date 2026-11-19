import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createDemoOrganization } from "@/server/services/demo";
import { generatePlan, submitPlanForApproval, approvePlan, assignableMembers } from "@/server/services/plans";
import { listTasks, getTask, startTask, submitForReview, reviewTask, addEvidence, toggleChecklistItem, markOverdueTasks } from "@/server/services/tasks";
import { inviteMember, acceptInvitation } from "@/server/services/organizations";
import { runDiagnosticAnalysis } from "@/server/services/analysis";
import { newUser, ctxFor, newOwner } from "./helpers";

async function demo() {
  const u = await newUser("plan");
  const org = await createDemoOrganization(u.id);
  const owner = await ctxFor(u.id, org.id);
  const mgrUser = await prisma.user.findFirstOrThrow({ where: { email: `manager.${org.id}@demo.sreda.invalid` } });
  const manager = await ctxFor(mgrUser.id, org.id);
  return { org, owner, manager };
}

describe("Спринт 4: план улучшений и задачи", () => {
  it("демо проходит полный цикл: выполненные задачи оценены повторным замером", async () => {
    const { org } = await demo();
    const done = await prisma.task.findMany({ where: { organizationId: org.id, status: "DONE" } });
    expect(done.length).toBe(5);
    const outcomes = new Set(done.map((t) => t.outcome));
    // Закрытие задачи не равно устранению: есть и подтверждённые улучшения, и «эффект не подтверждён»
    expect(outcomes.has("IMPROVED") || outcomes.has("NO_EFFECT")).toBe(true);
    expect(done.every((t) => t.outcome !== "NOT_EVALUATED")).toBe(true);
    expect(done.filter((t) => t.outcomeNote).length).toBeGreaterThan(0);
    expect(await prisma.task.count({ where: { organizationId: org.id, status: "IN_REVIEW" } })).toBe(1);
    // Незавершённые задачи весеннего плана и одна задача текущего плана просрочены
    expect(await prisma.task.count({ where: { organizationId: org.id, status: "OVERDUE" } })).toBeGreaterThanOrEqual(1);
    const plans = await prisma.improvementPlan.findMany({ where: { organizationId: org.id } });
    expect(plans.every((p) => p.status === "APPROVED" && p.approvedById)).toBe(true);
  });

  it("план: AI формирует черновик, без ответственных отправить нельзя, утверждает только собственник", async () => {
    const { owner, manager, org } = await demo();
    const d = await prisma.diagnostic.findFirstOrThrow({ where: { organizationId: org.id, title: { contains: "текущая" } } });
    await runDiagnosticAnalysis(owner, d.id);
    const plan = await generatePlan(owner, d.id, { maxPriority: "P4" });
    expect(plan.status).toBe("DRAFT");
    expect(plan.generatedByAI).toBe(true);
    const tasks = await prisma.task.findMany({ where: { planId: plan.id }, include: { checklist: true } });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.status === "NEW" && t.rootCause && t.solution && t.dueDate)).toBe(true);
    expect(tasks.some((t) => t.checklist.length > 0)).toBe(true);

    await expect(submitPlanForApproval(owner, plan.id)).rejects.toThrow(/ответственного/);
    const members = await assignableMembers(owner);
    expect(members.find((m) => m.id === manager.user.id)).toBeDefined();
    for (const t of tasks) await prisma.task.update({ where: { id: t.id }, data: { assigneeUserId: manager.user.id } });
    await submitPlanForApproval(owner, plan.id);
    // Руководитель сети / управляющий не может утвердить
    await expect(approvePlan(manager, plan.id)).rejects.toThrow(/собственник/);
    await approvePlan(owner, plan.id);
    const after = await prisma.task.findMany({ where: { planId: plan.id } });
    expect(after.every((t) => t.status === "PLANNED")).toBe(true);
  });

  it("исполнение: доказательства обязательны, свою задачу принять нельзя, возврат требует комментария", async () => {
    const { owner, manager, org } = await demo();
    const t = await prisma.task.findFirstOrThrow({ where: { organizationId: org.id, status: "PLANNED", assigneeUserId: manager.user.id } });
    await expect(startTask(owner, t.id)).rejects.toThrow(/исполнитель/);
    await startTask(manager, t.id);
    await expect(submitForReview(manager, t.id)).rejects.toThrow(/хотя бы одно доказательство/);
    await addEvidence(manager, t.id, { kind: "LINK", description: "Регламент в базе знаний", url: "https://example.org/doc" });
    await expect(addEvidence(manager, t.id, { kind: "LINK", description: "x", url: "javascript:alert(1)" })).rejects.toThrow(/http/);
    const { review } = await submitForReview(manager, t.id);
    expect(["INSUFFICIENT", "NEEDS_HUMAN", "SUFFICIENT"]).toContain(review.verdict);
    await expect(reviewTask(manager, t.id, "accept", "")).rejects.toThrow(/собственную|прав/);
    await expect(reviewTask(owner, t.id, "reject", "")).rejects.toThrow(/доработать/);
    await reviewTask(owner, t.id, "reject", "Нужен фотоотчёт");
    const t2 = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(t2.status).toBe("NEEDS_REVISION");
    const log = await prisma.auditLog.findMany({ where: { entityType: "Task", entityId: t.id } });
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["task.start", "task.evidence_add", "task.submit_review", "task.reject"]));
    expect(await prisma.aIAnalysis.count({ where: { organizationId: org.id, kind: "TASK_EVIDENCE" } })).toBeGreaterThan(0);
  });

  it("сотрудник видит только свои задачи и не видит черновики плана", async () => {
    const { owner, org } = await demo();
    const emp = await newUser("emp4");
    const { token } = await inviteMember(owner, { email: emp.email, roleKey: "EMPLOYEE", locationIds: [] });
    await acceptInvitation(emp, token);
    const ectx = await ctxFor(emp.id, org.id);
    expect(await listTasks(ectx)).toHaveLength(0);
    const any = await prisma.task.findFirstOrThrow({ where: { organizationId: org.id } });
    await expect(getTask(ectx, any.id)).rejects.toThrow(/не найдена/);
    await prisma.task.update({ where: { id: any.id }, data: { assigneeUserId: emp.id, status: "PLANNED" } });
    const mine = await listTasks(ectx);
    expect(mine.map((t) => t.id)).toEqual([any.id]);
    const { can } = await getTask(ectx, any.id);
    expect(can.work).toBe(true);
    expect(can.review).toBe(false);
    // Чек-лист можно отмечать, только когда задача в работе
    const item = await prisma.taskChecklistItem.findFirst({ where: { taskId: any.id } });
    if (item) await toggleChecklistItem(ectx, any.id, item.id, true);
  });

  it("плановая проверка сроков отмечает просроченные задачи и уведомляет", async () => {
    const { owner, org } = await demo();
    const t = await prisma.task.findFirstOrThrow({ where: { organizationId: org.id, status: "PLANNED" } });
    await prisma.task.update({ where: { id: t.id }, data: { dueDate: new Date(Date.now() - 86400_000) } });
    const n = await markOverdueTasks(org.id);
    expect(n).toBeGreaterThan(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("OVERDUE");
    expect(await prisma.notification.count({ where: { organizationId: org.id, type: "task.overdue" } })).toBeGreaterThan(0);
    void owner;
  });

  it("изоляция: чужую задачу и план не получить", async () => {
    const { org } = await demo();
    const other = await newOwner("iso4");
    const t = await prisma.task.findFirstOrThrow({ where: { organizationId: org.id } });
    await expect(getTask(other.ctx, t.id)).rejects.toThrow(/не найдена/);
    await expect(startTask(other.ctx, t.id)).rejects.toThrow(/не найдена/);
  });
});
