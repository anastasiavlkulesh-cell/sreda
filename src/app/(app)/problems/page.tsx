import Link from "next/link";
import { SearchCheck } from "lucide-react";
import { requireOrgContext } from "@/server/context";
import { listProblems } from "@/server/services/analysis";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { FindingBadge, PriorityBadge, ConfidenceBadge } from "@/components/sreda/score";
import { DIMENSIONS } from "@/domain/methodology/v1";
import { PROBLEM_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { PriorityCategory } from "@/domain/types";

export const metadata = { title: "Проблемы и причины" };

const PRIORITIES: PriorityCategory[] = ["P1", "P2", "P3", "P4"];

export default async function ProblemsPage({ searchParams }: { searchParams: Promise<{ priority?: string; diagnostic?: string }> }) {
  const ctx = await requireOrgContext("problems.view");
  const sp = await searchParams;
  const priority = PRIORITIES.includes(sp.priority as PriorityCategory) ? (sp.priority as PriorityCategory) : undefined;
  const analyzed = await ctx.db.diagnostic.findMany({
    where: { archivedAt: null, analyses: { some: { kind: "DIAGNOSTIC", status: "COMPLETED" } } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true },
  });
  const diagnosticId = sp.diagnostic === "all" ? undefined : (analyzed.find((d) => d.id === sp.diagnostic)?.id ?? analyzed[0]?.id);
  const problems = await listProblems(ctx, { priority, diagnosticId });
  const dimName = (k: string) => DIMENSIONS.find((d) => d.key === k)!.shortName;
  const q = (p?: string) => {
    const params = new URLSearchParams();
    if (p) params.set("priority", p);
    if (sp.diagnostic) params.set("diagnostic", sp.diagnostic);
    const s = params.toString();
    return `/problems${s ? `?${s}` : ""}`;
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Проблемы и причины"
        badge={ctx.org.isDemo ? <DemoBadge /> : undefined}
        description="Каждый вывод имеет статус: подтверждено, частично подтверждено или гипотеза. Приоритет — по пяти параметрам, реализуемость оценена отдельно."
      />
      {analyzed.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {[...analyzed.map((d) => ({ id: d.id, title: d.title })), { id: "all", title: "Все диагностики" }].map((d) => {
            const isActive = d.id === "all" ? sp.diagnostic === "all" : d.id === diagnosticId && sp.diagnostic !== "all";
            return (
              <Link key={d.id} href={`/problems?diagnostic=${d.id}`} className={cn("rounded-xl border px-3 py-1.5 text-sm", isActive ? "border-lavender-500 bg-lavender-50 font-semibold text-lavender-700" : "border-line bg-white text-muted hover:text-ink")}>
                {d.title}
              </Link>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {[undefined, ...PRIORITIES].map((p) => (
          <Link key={p ?? "all"} href={q(p)} className={cn("rounded-full border px-3 py-1 text-sm font-semibold", priority === p ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white text-muted hover:text-ink")}>
            {p ?? "Все"}
          </Link>
        ))}
      </div>
      {problems.length === 0 ? (
        <EmptyState icon={<SearchCheck className="size-6" />} title="Активных проблем нет" description="Проблемы появляются после AI-анализа завершённой диагностики." />
      ) : (
        <div className="space-y-3">
          {problems.map((p) => (
            <Link key={p.id} href={`/problems/${p.id}`} className="block">
              <Card className="transition-shadow hover:shadow-lg">
                <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2 sm:w-24"><PriorityBadge value={p.priority} /><span className="text-xs text-muted">{p.priorityScore.toFixed(2)}</span></div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-semibold">{p.title}</p>
                    <p className="line-clamp-2 text-sm text-muted">{p.description}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                    <Badge variant="outline">{dimName(p.dimension)}</Badge>
                    <FindingBadge value={p.findingStatus} />
                    <ConfidenceBadge value={p.confidence} />
                    <Badge variant="neutral">{PROBLEM_STATUS_LABELS[p.status]}</Badge>
                    <span className="text-xs text-muted">Причин: {p._count.causes}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
