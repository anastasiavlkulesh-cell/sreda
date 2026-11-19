import Link from "next/link";
import { ListChecks } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { listTasks } from "@/server/services/tasks";
import { isOverdue, type TaskStatus } from "@/domain/tasks";
import { PageHeader, EmptyState, Progress } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PriorityBadge } from "@/components/sreda/score";
import { TASK_STATUS_LABELS, TASK_STATUS_VARIANT, TASK_OUTCOME_LABELS } from "@/lib/labels";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Задачи" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ scope?: string; status?: string }> }) {
  const ctx = await requireOrgContext();
  if (!ctx.can("tasks.work") && !ctx.can("tasks.view_all")) {
    const { redirect } = await import("next/navigation");
    redirect("/forbidden");
  }
  const sp = await searchParams;
  const all = ctx.can("tasks.view_all");
  const scope = all && sp.scope !== "mine" ? "all" : "mine";
  const status = Object.keys(TASK_STATUS_LABELS).includes(sp.status ?? "") ? (sp.status as TaskStatus) : undefined;
  const tasks = await listTasks(ctx, { scope, status });
  const link = (o: { scope?: string; status?: string }) => {
    const p = new URLSearchParams();
    const s = o.scope ?? scope;
    if (s === "mine") p.set("scope", "mine");
    if (o.status ?? status) p.set("status", (o.status ?? status)!);
    if (o.status === "") p.delete("status");
    return `/tasks${p.toString() ? `?${p}` : ""}`;
  };
  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-sm font-semibold", active ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white text-muted hover:text-ink");
  return (
    <div className="space-y-6">
      <PageHeader
        title={all ? "Задачи" : "Мои задачи"}
        badge={ctx.org.isDemo ? <DemoBadge /> : undefined}
        description="Закрытие задачи подтверждается доказательствами и проверкой руководителя; устранение проблемы — повторным замером."
        actions={ctx.can("tasks.manage") && <Link href="/tasks/new" className={buttonVariants()}>Новая задача</Link>}
      />
      <div className="flex flex-wrap gap-2">
        {all && (
          <>
            <Link href={link({ scope: "all" })} className={chip(scope === "all")}>Все</Link>
            <Link href={link({ scope: "mine" })} className={chip(scope === "mine")}>Мои</Link>
            <span className="mx-1 w-px bg-line" />
          </>
        )}
        {(["", "PLANNED", "IN_PROGRESS", "IN_REVIEW", "OVERDUE", "NEEDS_REVISION", "DONE"] as const).map((s) => (
          <Link key={s || "any"} href={link({ status: s })} className={chip((status ?? "") === s)}>{s ? TASK_STATUS_LABELS[s] : "Любой статус"}</Link>
        ))}
      </div>
      {tasks.length === 0 ? (
        <EmptyState icon={<ListChecks className="size-6" />} title="Задач нет" description="Задачи появляются после утверждения плана улучшений." />
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => {
            const done = t.checklist.filter((c) => c.isDone).length;
            const late = isOverdue(t.status as TaskStatus, t.dueDate);
            return (
              <Link key={t.id} href={`/tasks/${t.id}`} className="block">
                <Card className="transition-shadow hover:shadow-lg">
                  <CardContent className="flex flex-col gap-3 pt-5 md:flex-row md:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <PriorityBadge value={t.priority} />
                      <div className="min-w-0">
                        <p className="font-semibold leading-snug">{t.title}</p>
                        <p className={cn("text-xs", late ? "font-semibold text-level-critical" : "text-muted")}>Срок: {formatDate(t.dueDate)}{late ? " — просрочено" : ""}</p>
                      </div>
                    </div>
                    {t.checklist.length > 0 && (
                      <div className="w-40 space-y-1">
                        <p className="text-xs text-muted">Чек-лист {done}/{t.checklist.length}</p>
                        <Progress value={(done / t.checklist.length) * 100} />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5 md:w-72 md:justify-end">
                      <Badge variant={TASK_STATUS_VARIANT[t.status]}>{TASK_STATUS_LABELS[t.status]}</Badge>
                      {t.status === "DONE" && <Badge variant={t.outcome === "IMPROVED" ? "good" : t.outcome === "NO_EFFECT" ? "critical" : "outline"}>{TASK_OUTCOME_LABELS[t.outcome]}</Badge>}
                      <span className="text-xs text-muted">Доказательств: {t._count.evidence}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
