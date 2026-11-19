import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { OrgContext } from "@/server/context";
import { latestAnalysis, listProblems } from "@/server/services/analysis";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/form";
import { FindingBadge, PriorityBadge } from "@/components/sreda/score";
import { runAnalysisAction } from "@/app/actions/analysis";
import { formatDate } from "@/lib/utils";

interface AnalysisOutputView {
  summary?: string;
  contradictions?: { criterionCode: string; title: string; management: number; field: number; gap: number }[];
  llmApplied?: boolean;
}

export async function DiagnosticAnalysisSection({ ctx, diagnosticId, status }: { ctx: OrgContext; diagnosticId: string; status: string }) {
  if (!ctx.can("problems.view") && !ctx.can("analysis.run")) return null;
  const analysis = await latestAnalysis(ctx, diagnosticId);
  const problems = ctx.can("problems.view") ? await listProblems(ctx, { diagnosticId }) : [];
  const out = (analysis?.output ?? {}) as AnalysisOutputView;
  return (
    <Card id="analysis">
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-lavender-600" />AI-анализ</CardTitle>
          <CardDescription>
            {analysis
              ? `${formatDate(analysis.createdAt)} · методика ${analysis.methodologyVersion} · ${analysis.provider === "rules" ? "встроенный алгоритмический анализ" : `внешний провайдер (${analysis.model})`}`
              : "Сопоставление источников, противоречия, первопричины, приоритеты"}
          </CardDescription>
        </div>
        {ctx.can("analysis.run") && status !== "DRAFT" && (
          <ActionForm action={runAnalysisAction}>
            <input type="hidden" name="id" value={diagnosticId} />
            <SubmitButton variant={analysis ? "secondary" : "primary"} pendingText="Анализируем…">
              {analysis ? "Повторить анализ" : "Запустить AI-анализ"}
            </SubmitButton>
          </ActionForm>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!analysis && <p className="text-sm text-muted">Анализ ещё не выполнялся.</p>}
        {analysis?.status === "FAILED" && <Alert tone="critical" title="Анализ завершился ошибкой">{analysis.error}</Alert>}
        {out.summary && <p className="whitespace-pre-line rounded-2xl bg-lavender-50 p-4 text-sm leading-relaxed">{out.summary}</p>}
        {out.contradictions && out.contradictions.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Противоречия между источниками</p>
            <ul className="space-y-1.5 text-sm">
              {out.contradictions.map((c) => (
                <li key={c.criterionCode} className="flex flex-wrap items-center gap-2">
                  <Badge variant={c.gap > 0 ? "warning" : "lavender"}>Δ {Math.abs(c.gap).toFixed(1)}</Badge>
                  <span>{c.title}: руководство {c.management.toFixed(1)}, сотрудники и клиенты {c.field.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {problems.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Проблемы ({problems.length})</p>
            <ul className="divide-y divide-line">
              {problems.slice(0, 6).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <PriorityBadge value={p.priority} />
                  <Link href={`/problems/${p.id}`} className="font-semibold hover:text-lavender-600">{p.title}</Link>
                  <FindingBadge value={p.findingStatus} />
                </li>
              ))}
            </ul>
            <Link href={`/problems?diagnostic=${diagnosticId}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Все проблемы и причины</Link>
          </div>
        )}
        {analysis && analysis.limitations.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Ограничения анализа ({analysis.limitations.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{analysis.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
