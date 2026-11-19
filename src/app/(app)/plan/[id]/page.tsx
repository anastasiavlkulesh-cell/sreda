import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/context";
import { getPlanDetail, assignableMembers } from "@/server/services/plans";
import { AppError } from "@/server/errors";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { PriorityBadge, FindingBadge } from "@/components/sreda/score";
import { submitPlanAction, approvePlanAction, returnPlanAction, updateTaskAction, removeTaskAction } from "@/app/actions/plan";
import { PLAN_STATUS_LABELS, TASK_STATUS_LABELS, TASK_STATUS_VARIANT, TASK_OUTCOME_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "План улучшений" };

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext("plan.view");
  const { id } = await params;
  let plan;
  try {
    plan = await getPlanDetail(ctx, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const members = await assignableMembers(ctx);
  const editable = plan.status === "DRAFT" && ctx.can("plan.manage");
  const name = (uid: string | null) => members.find((m) => m.id === uid)?.name ?? "Не назначен";

  return (
    <div className="space-y-6">
      <PageHeader
        title={plan.title}
        badge={<><Badge variant={plan.status === "APPROVED" ? "good" : "peach"}>{PLAN_STATUS_LABELS[plan.status]}</Badge>{ctx.org.isDemo && <DemoBadge />}</>}
        description={`${plan.generatedByAI ? "Сформирован AI по результатам анализа" : "Создан вручную"} · ${formatDate(plan.createdAt)}${plan.approvedAt ? ` · утверждён ${formatDate(plan.approvedAt)}` : ""}`}
        actions={
          <>
            {editable && (
              <ActionForm action={submitPlanAction} quiet>
                <input type="hidden" name="id" value={plan.id} />
                <SubmitButton>Отправить на утверждение</SubmitButton>
              </ActionForm>
            )}
            {plan.status === "PENDING_APPROVAL" && ctx.can("plan.approve") && (
              <ActionForm action={approvePlanAction} quiet confirm="Утвердить план? Ответственные получат задачи.">
                <input type="hidden" name="id" value={plan.id} />
                <SubmitButton>Утвердить план</SubmitButton>
              </ActionForm>
            )}
          </>
        }
      />
      {plan.status === "DRAFT" && <Alert tone="info">Черновик сформирован AI. Проверьте задачи, назначьте ответственных и сроки — затем отправьте собственнику на утверждение. AI не утверждает план сам.</Alert>}
      {plan.status === "PENDING_APPROVAL" && ctx.can("plan.approve") && (
        <Card>
          <CardContent className="pt-5">
            <ActionForm action={returnPlanAction} className="flex flex-wrap items-end gap-2 space-y-0">
              <input type="hidden" name="id" value={plan.id} />
              <Textarea name="reason" placeholder="Что доработать (необязательно)" className="min-h-10 flex-1" aria-label="Комментарий" />
              <SubmitButton variant="secondary">Вернуть на доработку</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        {plan.tasks.map((t) => {
          const done = t.checklist.filter((c) => c.isDone).length;
          return (
            <Card key={t.id}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <PriorityBadge value={t.priority} />
                    <Link href={`/tasks/${t.id}`} className="font-semibold hover:text-lavender-600">{t.title}</Link>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {t.problem && <FindingBadge value={t.problem.findingStatus} />}
                    <Badge variant={TASK_STATUS_VARIANT[t.status]}>{TASK_STATUS_LABELS[t.status]}</Badge>
                    {t.status === "DONE" && <Badge variant={t.outcome === "IMPROVED" ? "good" : t.outcome === "NO_EFFECT" ? "critical" : "outline"}>{TASK_OUTCOME_LABELS[t.outcome]}</Badge>}
                  </div>
                </div>
                <p className="text-sm text-muted"><b className="text-ink">Первопричина:</b> {t.rootCause}</p>
                {editable ? (
                  <ActionForm action={updateTaskAction} className="flex flex-wrap items-center gap-2 space-y-0">
                    <input type="hidden" name="id" value={t.id} />
                    <Select name="assigneeUserId" defaultValue={t.assigneeUserId ?? ""} className="h-9 w-auto" aria-label="Ответственный">
                      <option value="">Ответственный…</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
                    </Select>
                    <Input type="date" name="dueDate" defaultValue={t.dueDate?.toISOString().slice(0, 10)} className="h-9 w-auto" aria-label="Срок" />
                    <Select name="priority" defaultValue={t.priority} className="h-9 w-auto" aria-label="Приоритет">
                      {["P1", "P2", "P3", "P4"].map((p) => <option key={p}>{p}</option>)}
                    </Select>
                    <SubmitButton size="sm" variant="secondary">Сохранить</SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="text-sm">Ответственный: <b>{name(t.assigneeUserId)}</b> · срок {formatDate(t.dueDate)} · чек-лист {done}/{t.checklist.length}</p>
                )}
                {editable && (
                  <ActionForm action={removeTaskAction} quiet confirm="Убрать задачу из плана? Проблема вернётся в список открытых.">
                    <input type="hidden" name="id" value={t.id} />
                    <Button type="submit" variant="link" size="sm" className="h-auto text-xs text-muted">Убрать из плана</Button>
                  </ActionForm>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
