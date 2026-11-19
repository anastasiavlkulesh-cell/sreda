import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { listPlans } from "@/server/services/plans";
import { diagnosticScopeWhere } from "@/server/services/dashboard";
import { PageHeader, EmptyState, Progress } from "@/components/ui/misc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { generatePlanAction } from "@/app/actions/plan";
import { PLAN_STATUS_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "План улучшений" };

export default async function PlansPage() {
  const ctx = await requireOrgContext("plan.view");
  const plans = await listPlans(ctx);
  const candidates = ctx.can("plan.manage")
    ? await ctx.db.diagnostic.findMany({
        where: { archivedAt: null, ...diagnosticScopeWhere(ctx), analyses: { some: { status: "COMPLETED", kind: "DIAGNOSTIC" } }, problems: { some: { status: "OPEN" } } },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, _count: { select: { problems: { where: { status: "OPEN" } } } } },
      })
    : [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="План улучшений"
        badge={ctx.org.isDemo ? <DemoBadge /> : undefined}
        description="AI формирует план по выявленным проблемам, руководитель назначает ответственных и сроки, собственник утверждает."
      />
      {candidates.length > 0 && (
        <Card className="border-lavender-200 bg-lavender-50/50">
          <CardHeader>
            <CardTitle>Сформировать план по диагностике</CardTitle>
            <CardDescription>Задачи создаются из открытых проблем с рекомендациями, первопричинами и чек-листами</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={generatePlanAction} className="flex flex-wrap items-end gap-3 space-y-0">
              <Select name="diagnosticId" className="w-auto min-w-64" aria-label="Диагностика">
                {candidates.map((d) => <option key={d.id} value={d.id}>{d.title} — открытых проблем: {d._count.problems}</option>)}
              </Select>
              <Select name="maxPriority" defaultValue="P2" className="w-auto" aria-label="Приоритеты">
                <option value="P1">Только P1</option><option value="P2">P1–P2</option><option value="P3">P1–P3</option><option value="P4">Все</option>
              </Select>
              <SubmitButton pendingText="Формируем…">Сформировать план</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
      {plans.length === 0 ? (
        <EmptyState icon={<ClipboardList className="size-6" />} title="Планов пока нет" description="План формируется после AI-анализа завершённой диагностики." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {plans.map((p) => {
            const done = p.tasks.filter((t) => t.status === "DONE").length;
            const improved = p.tasks.filter((t) => t.outcome === "IMPROVED").length;
            return (
              <Link key={p.id} href={`/plan/${p.id}`}>
                <Card className="h-full transition-shadow hover:shadow-lg">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle>{p.title}</CardTitle>
                      <Badge variant={p.status === "APPROVED" ? "good" : p.status === "PENDING_APPROVAL" ? "peach" : "outline"}>{PLAN_STATUS_LABELS[p.status]}</Badge>
                    </div>
                    <CardDescription>Создан {formatDate(p.createdAt)}{p.generatedByAI ? " · сформирован AI" : ""}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm"><span>Выполнено задач</span><span className="font-semibold">{done} из {p.tasks.length}</span></div>
                    <Progress value={p.tasks.length ? (done / p.tasks.length) * 100 : 0} />
                    <p className="text-xs text-muted">Улучшение подтверждено замером: {improved} из {done}</p>
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
