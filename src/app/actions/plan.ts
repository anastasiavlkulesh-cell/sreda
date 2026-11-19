"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { actionContext } from "@/server/context";
import { generatePlan, submitPlanForApproval, approvePlan, returnPlanToDraft, removeTaskFromPlan } from "@/server/services/plans";
import {
  updateTask, createTask, startTask, toggleChecklistItem, addComment, addEvidence, submitForReview, reviewTask,
} from "@/server/services/tasks";
import { toArray } from "@/lib/validation";

const id = z.object({ id: z.string().min(1) });
const prio = z.enum(["P1", "P2", "P3", "P4"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату").transform((v) => new Date(`${v}T23:59:59`));

function refresh() {
  revalidatePath("/plan", "layout");
  revalidatePath("/tasks", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/problems", "layout");
}

export const generatePlanAction = defineAction(
  "generatePlan",
  z.object({ diagnosticId: z.string(), maxPriority: prio.optional() }),
  async ({ diagnosticId, maxPriority }) => {
    const ctx = await actionContext("plan.manage");
    const plan = await generatePlan(ctx, diagnosticId, { maxPriority });
    refresh();
    redirect(`/plan/${plan.id}`);
  },
);

export const submitPlanAction = defineAction("submitPlan", id, async ({ id }) => {
  const ctx = await actionContext("plan.manage");
  await submitPlanForApproval(ctx, id);
  refresh();
  return { ok: true, message: "План отправлен на утверждение собственнику" };
});

export const approvePlanAction = defineAction("approvePlan", id, async ({ id }) => {
  const ctx = await actionContext("plan.approve");
  await approvePlan(ctx, id);
  refresh();
  return { ok: true, message: "План утверждён. Ответственные получили задачи." };
});

export const returnPlanAction = defineAction("returnPlan", z.object({ id: z.string(), reason: z.string().max(1000).optional() }), async ({ id, reason }) => {
  const ctx = await actionContext("plan.approve");
  await returnPlanToDraft(ctx, id, reason ?? "");
  refresh();
  return { ok: true, message: "План возвращён на доработку" };
});

export const removeTaskAction = defineAction("removeTask", id, async ({ id }) => {
  const ctx = await actionContext("plan.manage");
  await removeTaskFromPlan(ctx, id);
  refresh();
  return { ok: true };
});

export const updateTaskAction = defineAction(
  "updateTask",
  z.object({
    id: z.string(),
    title: z.string().trim().min(3).max(300).optional(),
    solution: z.string().trim().max(4000).optional(),
    assigneeUserId: z.string().optional(),
    coAssigneeIds: z.union([z.string(), z.array(z.string())]).optional(),
    dueDate: date.optional(),
    priority: prio.optional(),
  }),
  async (i) => {
    const ctx = await actionContext(["tasks.manage", "plan.manage"]);
    await updateTask(ctx, i.id, {
      title: i.title,
      solution: i.solution,
      assigneeUserId: i.assigneeUserId === undefined ? undefined : i.assigneeUserId || null,
      coAssigneeIds: i.coAssigneeIds === undefined ? undefined : toArray(i.coAssigneeIds),
      dueDate: i.dueDate,
      priority: i.priority,
    });
    refresh();
    return { ok: true, message: "Сохранено" };
  },
);

export const createTaskAction = defineAction(
  "createTask",
  z.object({
    title: z.string().trim().min(3).max(300),
    problemSummary: z.string().trim().min(3).max(2000),
    solution: z.string().trim().min(3).max(4000),
    assigneeUserId: z.string().min(1, "Выберите ответственного"),
    dueDate: date,
    priority: prio,
  }),
  async (i) => {
    const ctx = await actionContext("tasks.manage");
    const t = await createTask(ctx, i);
    refresh();
    redirect(`/tasks/${t.id}`);
  },
);

export const startTaskAction = defineAction("startTask", id, async ({ id }) => {
  const ctx = await actionContext("tasks.work");
  await startTask(ctx, id);
  refresh();
  return { ok: true, message: "Задача в работе" };
});

export const checklistAction = defineAction(
  "checklist",
  z.object({ taskId: z.string(), itemId: z.string(), done: z.enum(["0", "1"]) }),
  async ({ taskId, itemId, done }) => {
    const ctx = await actionContext(["tasks.work", "tasks.manage"]);
    await toggleChecklistItem(ctx, taskId, itemId, done === "1");
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  },
);

export const commentAction = defineAction("comment", z.object({ taskId: z.string(), body: z.string().min(1, "Введите комментарий").max(4000) }), async ({ taskId, body }) => {
  const ctx = await actionContext(["tasks.work", "tasks.view_all"]);
  await addComment(ctx, taskId, body);
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
});

export const evidenceAction = defineAction(
  "evidence",
  z.object({
    taskId: z.string(),
    kind: z.enum(["FILE", "LINK", "TEXT"]),
    description: z.string().trim().min(3, "Опишите доказательство").max(1000),
    url: z.string().max(2000).optional(),
    file: z.any().optional(),
  }),
  async ({ taskId, kind, description, url, file }) => {
    const ctx = await actionContext(["tasks.work", "tasks.manage"]);
    await addEvidence(ctx, taskId, { kind, description, url, file: file instanceof File && file.size > 0 ? file : undefined });
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true, message: "Доказательство добавлено" };
  },
);

export const submitReviewAction = defineAction("submitReview", id, async ({ id }) => {
  const ctx = await actionContext("tasks.work");
  const { review } = await submitForReview(ctx, id);
  refresh();
  return { ok: true, message: review.verdict === "INSUFFICIENT" ? "Отправлено на проверку. AI отметил, что доказательств недостаточно." : "Отправлено на проверку" };
});

export const reviewTaskAction = defineAction(
  "reviewTask",
  z.object({ id: z.string(), decision: z.enum(["accept", "reject"]), comment: z.string().max(2000).optional() }),
  async ({ id, decision, comment }) => {
    const ctx = await actionContext("tasks.manage");
    await reviewTask(ctx, id, decision, comment ?? "");
    refresh();
    return { ok: true, message: decision === "accept" ? "Задача принята. Эффект будет проверен повторным замером." : "Задача возвращена на доработку" };
  },
);
