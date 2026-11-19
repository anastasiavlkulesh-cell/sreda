import "server-only";
import type { OrgContext } from "../context-core";
import { parseDimensions, type StoredDimension } from "./assessment";
import { revenueChange, type MetricKey } from "@/domain/metrics";

export function diagnosticScopeWhere(ctx: OrgContext) {
  return ctx.locationScope ? { OR: [{ locationId: null }, { locationId: { in: ctx.locationScope } }] } : {};
}

export async function getDashboard(ctx: OrgContext) {
  const db = ctx.db;
  const assessments = await db.assessment.findMany({
    where: { diagnostic: { archivedAt: null, ...diagnosticScopeWhere(ctx) } },
    orderBy: { calculatedAt: "asc" },
    include: { diagnostic: { select: { id: true, title: true, status: true } } },
  });
  // Последний расчёт по каждой диагностике
  const latestByDiagnostic = new Map<string, (typeof assessments)[number]>();
  for (const a of assessments) latestByDiagnostic.set(a.diagnosticId, a);
  const series = [...latestByDiagnostic.values()].sort((a, b) => a.calculatedAt.getTime() - b.calculatedAt.getTime());
  const latest = series.at(-1) ?? null;
  const previous = series.length > 1 ? series.at(-2)! : null;

  const dims: StoredDimension[] = latest ? parseDimensions(latest.dimensions) : [];
  const prevDims: StoredDimension[] = previous ? parseDimensions(previous.dimensions) : [];

  const [problems, problemCounts, taskGroups, overdue, plan, recommendations, activeDiagnostics] = await Promise.all([
    db.problem.findMany({
      where: { status: { in: ["OPEN", "IN_PLAN"] }, priority: { in: ["P1", "P2"] } },
      orderBy: [{ priority: "asc" }, { priorityScore: "desc" }],
      take: 5,
    }),
    db.problem.groupBy({ by: ["priority"], where: { status: { in: ["OPEN", "IN_PLAN", "MONITORING"] } }, _count: true }),
    db.task.groupBy({
      by: ["status"],
      where: { archivedAt: null, ...(ctx.locationScope ? { OR: [{ locationId: null }, { locationId: { in: ctx.locationScope } }] } : {}) },
      _count: true,
    }),
    db.task.count({ where: { archivedAt: null, status: { notIn: ["DONE"] }, dueDate: { lt: new Date() } } }),
    db.improvementPlan.findFirst({ where: { status: { in: ["APPROVED", "PENDING_APPROVAL", "DRAFT"] } }, orderBy: { createdAt: "desc" } }),
    db.aIRecommendation.findMany({ orderBy: { createdAt: "desc" }, take: 3, include: { problem: { select: { priority: true } } } }),
    db.diagnostic.count({ where: { status: { in: ["DRAFT", "COLLECTING"] }, archivedAt: null } }),
  ]);

  const tasksTotal = taskGroups.reduce((a, g) => a + g._count, 0);
  const tasksDone = taskGroups.find((g) => g.status === "DONE")?._count ?? 0;

  // Бизнес-показатели: последние 13 месяцев факта + прогнозы отдельно
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 16, 1));
  const metrics = await db.businessMetric.findMany({
    where: { periodStart: { gte: since }, ...(ctx.locationScope ? { OR: [{ locationId: null }, { locationId: { in: ctx.locationScope } }] } : {}) },
    orderBy: { periodStart: "asc" },
  });
  const lastFact = (key: MetricKey) => metrics.filter((m) => m.key === key && m.kind === "FACT").at(-1) ?? null;
  const revenueSeries = aggregateMonthly(metrics.filter((m) => m.key === "REVENUE"));
  const rc = revenueChange(metrics.map((m) => ({ key: m.key as MetricKey, kind: m.kind, periodStart: m.periodStart, value: m.value })));

  return {
    latest: latest
      ? {
          id: latest.id,
          diagnosticId: latest.diagnosticId,
          diagnosticTitle: latest.diagnostic.title,
          calculatedAt: latest.calculatedAt,
          ssi: latest.ssi,
          confidence: latest.confidence,
          limitations: latest.limitations,
          criticalRisks: latest.criticalRisks,
        }
      : null,
    previousSsi: previous?.ssi ?? null,
    dimensions: dims.map((d) => ({
      key: d.key,
      score: d.score,
      confidence: d.confidence,
      coverage: d.coverage,
      previous: prevDims.find((p) => p.key === d.key)?.score ?? null,
      criteria: d.criteria,
    })),
    history: series.map((a) => ({
      date: a.calculatedAt.toISOString(),
      title: a.diagnostic.title,
      ssi: a.ssi,
      dims: Object.fromEntries(parseDimensions(a.dimensions).map((d) => [d.key, d.score])),
    })),
    problems,
    problemCounts: Object.fromEntries(problemCounts.map((p) => [p.priority, p._count])) as Record<string, number>,
    tasks: { total: tasksTotal, done: tasksDone, overdue, byStatus: Object.fromEntries(taskGroups.map((g) => [g.status, g._count])) },
    plan,
    recommendations,
    activeDiagnostics,
    metrics: {
      revenue: lastFact("REVENUE"),
      averageCheck: lastFact("AVERAGE_CHECK"),
      customers: lastFact("CUSTOMERS"),
      repeatSales: lastFact("REPEAT_SALES"),
      errorCost: lastFact("ERROR_COST"),
      revenueChange: rc,
      revenueSeries,
    },
  };
}

function aggregateMonthly(rows: { periodStart: Date; value: number; kind: string }[]) {
  const map = new Map<string, { month: string; fact: number | null; forecast: number | null }>();
  for (const r of rows) {
    const k = r.periodStart.toISOString().slice(0, 7);
    const e = map.get(k) ?? { month: k, fact: null, forecast: null };
    if (r.kind === "FACT") e.fact = (e.fact ?? 0) + r.value;
    if (r.kind === "FORECAST") e.forecast = (e.forecast ?? 0) + r.value;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
