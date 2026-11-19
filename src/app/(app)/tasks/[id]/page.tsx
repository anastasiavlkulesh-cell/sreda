import Link from "next/link";
import { notFound } from "next/navigation";
import { Paperclip, Link2, FileText, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { getTask, taskVisibilityWhere } from "@/server/services/tasks";
import { assignableMembers } from "@/server/services/plans";
import { AppError } from "@/server/errors";
import { isOverdue, type EvidenceReview, type TaskStatus } from "@/domain/tasks";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { PriorityBadge, FindingBadge } from "@/components/sreda/score";
import {
  startTaskAction, checklistAction, commentAction, submitReviewAction, reviewTaskAction, updateTaskAction,
} from "@/app/actions/plan";
import { TASK_STATUS_LABELS, TASK_STATUS_VARIANT, TASK_OUTCOME_LABELS } from "@/lib/labels";
import { formatDate, cn } from "@/lib/utils";
import { EvidenceForm } from "./evidence-form";

export const metadata = { title: "Задача" };

const HISTORY_LABELS: Record<string, string> = {
  "task.create": "Задача создана", "task.update": "Изменены параметры", "task.start": "Начата работа", "task.checklist": "Отмечен пункт чек-листа",
  "task.evidence_add": "Добавлено доказательство", "task.submit_review": "Отправлена на проверку", "task.accept": "Принята",
  "task.reject": "Возвращена на доработку", "task.mark_overdue": "Отмечена как просроченная", "task.outcome": "Оценён результат по повторному замеру",
  "task.submit_plan": "Отправлена на согласование", "task.approve": "Утверждена",
};

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  let data;
  try {
    data = await getTask(ctx, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  void taskVisibilityWhere;
  const { task: t, users, history, can } = data;
  const members = can.edit ? await assignableMembers(ctx) : [];
  const review = t.evidenceReview as EvidenceReview | null;
  const status = t.status as TaskStatus;
  const late = isOverdue(status, t.dueDate);
  const active = ["PLANNED", "IN_PROGRESS", "OVERDUE", "NEEDS_REVISION"].includes(status);
  const done = t.checklist.filter((c) => c.isDone).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        badge={ctx.org.isDemo ? <DemoBadge /> : undefined}
        description={t.plan ? `Из плана «${t.plan.title}»` : "Задача вне плана"}
        actions={
          can.work && (
            <>
              {["PLANNED", "NEEDS_REVISION", "OVERDUE"].includes(status) && !t.startedAt && (
                <ActionForm action={startTaskAction} quiet><input type="hidden" name="id" value={t.id} /><SubmitButton>Начать работу</SubmitButton></ActionForm>
              )}
              {["IN_PROGRESS", "OVERDUE", "NEEDS_REVISION"].includes(status) && (t.startedAt || status === "IN_PROGRESS") && (
                <ActionForm action={submitReviewAction}><input type="hidden" name="id" value={t.id} /><SubmitButton>Отправить на проверку</SubmitButton></ActionForm>
              )}
            </>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <PriorityBadge value={t.priority} />
        <Badge variant={TASK_STATUS_VARIANT[t.status]}>{TASK_STATUS_LABELS[t.status]}</Badge>
        {t.status === "DONE" && <Badge variant={t.outcome === "IMPROVED" ? "good" : t.outcome === "NO_EFFECT" ? "critical" : "outline"}>{TASK_OUTCOME_LABELS[t.outcome]}</Badge>}
        {late && <Badge variant="critical">Срок истёк</Badge>}
      </div>

      {t.status === "DONE" && t.outcome === "AWAITING_REMEASURE" && (
        <Alert tone="info" title="Задача выполнена, проблема на контроле">Устранение проблемы подтвердится только повторной диагностикой: система сравнит оценку критерия до и после.</Alert>
      )}
      {t.outcomeNote && <Alert tone={t.outcome === "IMPROVED" ? "success" : "warning"} title={TASK_OUTCOME_LABELS[t.outcome]}>{t.outcomeNote}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Описание</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed">
              <p><b>Проблема.</b> {t.problemSummary}</p>
              {t.rootCause && <p><b>Первопричина.</b> {t.rootCause}</p>}
              <p className="whitespace-pre-line"><b>Рекомендуемое решение.</b> {t.solution}</p>
              {t.problem && ctx.can("problems.view") && (
                <p className="flex items-center gap-2">
                  <Link href={`/problems/${t.problem.id}`} className="font-semibold text-lavender-600 hover:underline">Проблема: {t.problem.title}</Link>
                  <FindingBadge value={t.problem.findingStatus} />
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Чек-лист</CardTitle><CardDescription>Выполнено {done} из {t.checklist.length}</CardDescription></CardHeader>
            <CardContent className="space-y-1">
              {t.checklist.length === 0 && <p className="text-sm text-muted">Пунктов нет.</p>}
              {t.checklist.map((c) => (
                <ActionForm key={c.id} action={checklistAction} quiet className="space-y-0">
                  <input type="hidden" name="taskId" value={t.id} />
                  <input type="hidden" name="itemId" value={c.id} />
                  <input type="hidden" name="done" value={c.isDone ? "0" : "1"} />
                  <button
                    type="submit"
                    disabled={!(active && (can.work || can.edit))}
                    className="flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-lavender-50 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border", c.isDone ? "border-level-good bg-level-good text-white" : "border-line")}>
                      {c.isDone && "✓"}
                    </span>
                    <span className={c.isDone ? "text-muted line-through" : ""}>{c.text}</span>
                  </button>
                </ActionForm>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Доказательства выполнения</CardTitle><CardDescription>Фото, документы, ссылки или описание результата</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {t.evidence.length === 0 && <p className="text-sm text-muted">Доказательств пока нет.</p>}
              <ul className="space-y-2">
                {t.evidence.map((e) => (
                  <li key={e.id} className="flex gap-3 rounded-xl border border-line p-3 text-sm">
                    {e.kind === "FILE" ? <Paperclip className="mt-0.5 size-4 text-lavender-600" /> : e.kind === "LINK" ? <Link2 className="mt-0.5 size-4 text-lavender-600" /> : <FileText className="mt-0.5 size-4 text-lavender-600" />}
                    <div className="min-w-0 space-y-0.5">
                      <p>{e.description}</p>
                      {e.file && <a href={`/api/files/${e.file.id}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-lavender-600 hover:underline">{e.file.fileName}</a>}
                      {e.url && <a href={e.url} target="_blank" rel="noreferrer noopener" className="break-all text-xs font-semibold text-lavender-600 hover:underline">{e.url}</a>}
                      <p className="text-xs text-muted">{users.get(e.addedByUserId) ?? "—"} · {formatDate(e.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {active && (can.work || can.edit) && <EvidenceForm taskId={t.id} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Комментарии</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {t.comments.map((c) => (
                <div key={c.id} className="rounded-xl bg-lavender-50/60 p-3 text-sm">
                  <p className="text-xs font-semibold text-muted">{users.get(c.authorUserId) ?? "—"} · {formatDate(c.createdAt)}</p>
                  <p className="mt-1 whitespace-pre-line">{c.body}</p>
                </div>
              ))}
              <ActionForm action={commentAction} resetOnSuccess quiet>
                <input type="hidden" name="taskId" value={t.id} />
                <Textarea name="body" placeholder="Написать комментарий" required aria-label="Комментарий" />
                <SubmitButton size="sm" variant="secondary">Отправить</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Параметры</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Ответственный: <b>{t.assigneeUserId ? users.get(t.assigneeUserId) : "не назначен"}</b></p>
              {t.coAssigneeIds.length > 0 && <p>Соисполнители: {t.coAssigneeIds.map((u) => users.get(u)).join(", ")}</p>}
              <p className={late ? "font-semibold text-level-critical" : ""}>Срок: {formatDate(t.dueDate)}</p>
              {t.startedAt && <p>Начата: {formatDate(t.startedAt)}</p>}
              {t.completedAt && <p>Принята: {formatDate(t.completedAt)}</p>}
              {can.edit && t.status !== "DONE" && (
                <ActionForm action={updateTaskAction} className="space-y-2 border-t border-line pt-3">
                  <input type="hidden" name="id" value={t.id} />
                  <Label className="text-xs">Ответственный</Label>
                  <Select name="assigneeUserId" defaultValue={t.assigneeUserId ?? ""} className="h-9">
                    <option value="">Не назначен</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                  <Label className="text-xs">Соисполнители</Label>
                  <Select name="coAssigneeIds" multiple defaultValue={t.coAssigneeIds} className="h-20">
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                  <Label className="text-xs">Срок</Label>
                  <Input type="date" name="dueDate" defaultValue={t.dueDate?.toISOString().slice(0, 10)} className="h-9" />
                  <SubmitButton size="sm" variant="secondary">Сохранить</SubmitButton>
                </ActionForm>
              )}
            </CardContent>
          </Card>

          {review && (
            <Card className={review.verdict === "INSUFFICIENT" ? "border-level-critical/40" : "border-lavender-200"}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-lavender-600" />AI-проверка доказательств</CardTitle>
                <CardDescription>
                  {review.verdict === "SUFFICIENT" ? "Доказательств достаточно" : review.verdict === "INSUFFICIENT" ? "Доказательств недостаточно" : "Нужна оценка руководителя"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {review.findings.map((f) => (
                  <p key={f.text} className="flex gap-2">
                    {f.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-level-good" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-level-critical" />}
                    {f.text}
                  </p>
                ))}
                <p className="text-xs text-muted">{review.note}</p>
              </CardContent>
            </Card>
          )}

          {status === "IN_REVIEW" && can.review && (
            <Card>
              <CardHeader><CardTitle>Проверка выполнения</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <ActionForm action={reviewTaskAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <Textarea name="comment" placeholder="Комментарий (обязателен при возврате)" aria-label="Комментарий к проверке" />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" name="decision" value="accept">Принять</Button>
                    <Button type="submit" name="decision" value="reject" variant="danger">Вернуть на доработку</Button>
                  </div>
                </ActionForm>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>История изменений</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2 border-l border-line pl-4 text-sm">
                {history.map((h) => (
                  <li key={h.id}>
                    <p>{HISTORY_LABELS[h.action] ?? h.action}</p>
                    <p className="text-xs text-muted">{h.actorUserId ? users.get(h.actorUserId) : "Система"} · {formatDate(h.createdAt)}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
