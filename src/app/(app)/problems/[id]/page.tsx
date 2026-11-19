import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, MessageSquareQuote, Scale, BarChart3 } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { getProblem } from "@/server/services/analysis";
import { AppError } from "@/server/errors";
import { DIMENSIONS, SOURCE_LABELS } from "@/domain/methodology/v1";
import type { SourceType } from "@/domain/types";
import { PageHeader, Alert } from "@/components/ui/misc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/ui/action-form";
import { FindingBadge, PriorityBadge, ConfidenceBadge } from "@/components/sreda/score";
import { problemStatusAction } from "@/app/actions/analysis";
import { PROBLEM_STATUS_LABELS, TASK_STATUS_LABELS, TASK_OUTCOME_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import { isModuleReady } from "@/components/layout/nav";

export const metadata = { title: "Проблема" };

const EV_ICON = { SURVEY_AGGREGATE: BarChart3, TEXT_FEEDBACK: MessageSquareQuote, CONTRADICTION: Scale, METRIC: BarChart3, FILE: FileText, NOTE: FileText } as const;

export default async function ProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext("problems.view");
  const { id } = await params;
  let data;
  try {
    data = await getProblem(ctx, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const { problem: p, evidence } = data;
  const evById = new Map(evidence.map((e) => [e.id, e]));
  const rec = p.recommendations[0];
  const params5 = [
    ["Серьёзность", p.severity], ["Влияние на бизнес", p.businessImpact], ["Срочность", p.urgency], ["Масштаб", p.scale], ["Системность причин", p.systemic],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.title}
        badge={ctx.org.isDemo ? <DemoBadge /> : undefined}
        description={`${DIMENSIONS.find((d) => d.key === p.dimension)!.name} · ${p.diagnostic.title}`}
        actions={
          ctx.can("plan.manage") && p.status !== "IN_PLAN" && (
            <ActionForm action={problemStatusAction} quiet confirm={p.status === "DISMISSED" ? undefined : "Отклонить проблему? Она не попадёт в план улучшений."}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="status" value={p.status === "DISMISSED" ? "OPEN" : "DISMISSED"} />
              <Button type="submit" variant="secondary">{p.status === "DISMISSED" ? "Вернуть в работу" : "Отклонить"}</Button>
            </ActionForm>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <PriorityBadge value={p.priority} />
        <FindingBadge value={p.findingStatus} />
        <ConfidenceBadge value={p.confidence} />
        <Badge variant="neutral">{PROBLEM_STATUS_LABELS[p.status]}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Суть проблемы</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed">
              <p>{p.description}</p>
              <p><b>Последствия:</b> {p.consequences}</p>
              <p className="text-xs text-muted">Источники данных: {p.dataSources.map((s) => SOURCE_LABELS[s as SourceType]).join(", ")}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Первопричины</CardTitle>
              <CardDescription>Связи «проблема → причина» из методики, проверенные данными этой диагностики</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {p.causes.length === 0 && <p className="text-sm text-muted">Данные не подтверждают ни одну из типовых причин — нужен разбор на месте.</p>}
              {p.causes.map((c) => (
                <div key={c.id} className="space-y-1.5 rounded-2xl border border-line p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <FindingBadge value={c.findingStatus} />
                    <p className="font-semibold">{c.title}</p>
                  </div>
                  <p className="text-sm text-muted">{c.explanation}</p>
                  {c.evidenceIds.length > 0 && (
                    <ul className="space-y-1 pt-1 text-xs text-navy-700">
                      {c.evidenceIds.map((eid) => evById.get(eid)).filter(Boolean).map((e) => <li key={e!.id}>• {e!.summary}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Факты и доказательства</CardTitle><CardDescription>На чём основан вывод</CardDescription></CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {p.evidenceIds.map((eid) => evById.get(eid)).filter(Boolean).map((e) => {
                  const Icon = EV_ICON[e!.kind];
                  const d = e!.data as { quotes?: string[]; quotesHidden?: boolean };
                  return (
                    <li key={e!.id} className="flex gap-3 text-sm">
                      <Icon className="mt-0.5 size-4 shrink-0 text-lavender-600" />
                      <div className="space-y-1">
                        <p>{e!.summary}</p>
                        {d.quotes?.map((q) => <blockquote key={q} className="border-l-2 border-lilac-400 pl-3 text-xs italic text-muted">«{q}»</blockquote>)}
                        {d.quotesHidden && <p className="text-xs text-muted">Цитаты скрыты: ответов меньше порога анонимности.</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Приоритет {p.priority}</CardTitle><CardDescription>Итоговый балл {p.priorityScore.toFixed(2)} из 5</CardDescription></CardHeader>
            <CardContent className="space-y-2.5">
              {params5.map(([label, v]) => (
                <div key={label} className="space-y-1">
                  <div className="flex justify-between text-sm"><span>{label}</span><span className="font-semibold">{v}/5</span></div>
                  <div className="h-1.5 rounded-full bg-lavender-100"><div className="h-full rounded-full bg-lavender-500" style={{ width: `${v * 20}%` }} /></div>
                </div>
              ))}
              <div className="mt-3 space-y-1 border-t border-line pt-3">
                <div className="flex justify-between text-sm"><span>Реализуемость (отдельно)</span><span className="font-semibold">{p.feasibility}/5</span></div>
                <div className="h-1.5 rounded-full bg-peach-100"><div className="h-full rounded-full bg-peach-400" style={{ width: `${p.feasibility * 20}%` }} /></div>
              </div>
            </CardContent>
          </Card>

          {rec && (
            <Card className="border-lavender-200">
              <CardHeader>
                <CardTitle>Рекомендация</CardTitle>
                <CardDescription><FindingBadge value={rec.findingStatus} /></CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="font-semibold">{rec.title}</p>
                <p className="text-muted">{rec.rationale}</p>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted">Использованные показатели</p>
                  <ul className="mt-1 space-y-0.5 text-xs">{rec.metricsUsed.map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
                {rec.limitations.length > 0 && (
                  <Alert tone="warning" title="Ограничения"><ul className="list-disc pl-4">{rec.limitations.map((l) => <li key={l}>{l}</li>)}</ul></Alert>
                )}
              </CardContent>
            </Card>
          )}

          {p.tasks.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Задачи</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {p.tasks.map((t) => (
                  <div key={t.id} className="space-y-0.5">
                    {isModuleReady("/tasks") ? <Link href={`/tasks/${t.id}`} className="font-semibold hover:text-lavender-600">{t.title}</Link> : <p className="font-semibold">{t.title}</p>}
                    <p className="text-xs text-muted">{TASK_STATUS_LABELS[t.status]} · {TASK_OUTCOME_LABELS[t.outcome]}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {p.analysis && (
            <p className="text-xs text-muted">
              Анализ от {formatDate(p.analysis.createdAt)}, методика {p.analysis.methodologyVersion},{" "}
              {p.analysis.provider === "rules" ? "встроенный алгоритм" : `провайдер ${p.analysis.model}`}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
