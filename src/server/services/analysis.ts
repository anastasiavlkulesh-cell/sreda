import "server-only";
import { z } from "zod";
import type { OrgContext } from "../context-core";
import { audit } from "../audit";
import { AppError, forbidden, notFound } from "../errors";
import { collectDiagnosticData, computeFromData } from "./assessment";
import { analyzeDiagnostic, type AnalysisOutput } from "@/domain/analysis";
import { DEFAULT_PRIORITY_SETTINGS, type PrioritySettings } from "@/domain/priority";
import { METHODOLOGY_VERSION } from "@/domain/methodology/v1";
import { getAIProvider, tryComplete, type AIProvider } from "../ai/provider";
import { notifyUsers, usersWithPermission } from "./notifications";
import { diagnosticScopeWhere } from "./dashboard";
import type { ProblemStatus, PriorityCategory } from "@/generated/prisma/enums";

const SYSTEM_PROMPT = `Ты — аналитик методики СРЕДА (SERVICE 5D). Работаешь строго с переданными агрегатами.
Запрещено: придумывать показатели, менять статусы выводов и приоритеты, выдавать гипотезы за факты,
делать выводы о конкретных людях и кадровые рекомендации. Пиши по-русски, кратко и конкретно.
Верни JSON: {"summary": string (до 700 символов), "recommendations": [{"criterionCode": string, "title": string (до 160 символов), "rationale": string (до 400 символов)}]}.
Рекомендации — только для переданных criterionCode.`;

const llmSchema = z.object({
  summary: z.string().min(20).max(1200),
  recommendations: z
    .array(z.object({ criterionCode: z.string().max(10), title: z.string().min(5).max(220), rationale: z.string().min(10).max(600) }))
    .max(30),
});

/** Обезличенный контекст для внешнего провайдера: только агрегаты, без текстов ответов и имён. */
export function buildLlmContext(out: AnalysisOutput) {
  return {
    problems: out.problems.map((p) => ({
      criterionCode: p.criterionCode,
      title: p.title,
      dimension: p.dimension,
      status: p.findingStatus,
      priority: p.priority,
      consequences: p.consequences,
      causes: p.causes.map((c) => ({ title: c.title, status: c.findingStatus })),
      baseSolution: p.recommendation.title,
      metrics: p.recommendation.metricsUsed,
    })),
    contradictions: out.contradictions,
    limitations: out.limitations,
  };
}

async function enhanceWithProvider(provider: AIProvider, out: AnalysisOutput) {
  if (!provider.external || out.problems.length === 0) return { applied: false, error: null as string | null };
  const { value, error } = await tryComplete(provider, {
    system: SYSTEM_PROMPT,
    user: JSON.stringify(buildLlmContext(out)),
    schema: llmSchema,
  });
  if (!value) return { applied: false, error };
  const codes = new Set(out.problems.map((p) => p.criterionCode));
  out.summary = `${value.summary}\n\n(Формулировка подготовлена AI-провайдером на основе расчётов методики.)`;
  for (const r of value.recommendations) {
    if (!codes.has(r.criterionCode)) continue; // провайдер не может добавлять проблемы
    const p = out.problems.find((x) => x.criterionCode === r.criterionCode)!;
    p.recommendation.title = r.title;
    p.recommendation.rationale = r.rationale;
  }
  return { applied: true, error: null };
}

export async function runDiagnosticAnalysis(ctx: OrgContext, diagnosticId: string) {
  if (!ctx.can("analysis.run")) throw forbidden();
  const diagnostic = await ctx.db.diagnostic.findFirst({ where: { id: diagnosticId, archivedAt: null, ...diagnosticScopeWhere(ctx) } });
  if (!diagnostic) throw notFound("Диагностика не найдена");
  if (diagnostic.status === "DRAFT") throw new AppError("Сначала соберите данные");

  const data = await collectDiagnosticData(ctx.db, ctx.org.id, diagnosticId);
  const assessment = computeFromData(data);
  const provider = getAIProvider({ allowExternalAI: ctx.org.settings.allowExternalAI });
  const settings = (ctx.org.settings.priority as PrioritySettings | undefined) ?? DEFAULT_PRIORITY_SETTINGS;

  const analysis = await ctx.db.aIAnalysis.create({
    data: {
      organizationId: ctx.org.id,
      diagnosticId,
      kind: "DIAGNOSTIC",
      methodologyVersion: METHODOLOGY_VERSION,
      provider: provider.name,
      model: provider.model,
      requestedById: ctx.user.id,
      inputSummary: {
        sourceStats: data.sourceStats,
        textAnswers: data.texts.length,
        criteria: assessment.dimensions.flatMap((d) => d.criteria.map((c) => ({ code: c.code, score: c.score, bySource: c.bySource }))),
        prioritySettings: settings,
      } as object,
    },
  });

  try {
    const out = analyzeDiagnostic({
      assessment,
      sourceStats: data.sourceStats,
      texts: data.texts,
      metricNotes: data.metricNotes,
      customCriteria: data.criteria.filter((c) => c.isCustom),
      prioritySettings: settings,
      anonymityMinGroup: ctx.org.settings.anonymityMinGroup ?? 5,
    });
    const enh = await enhanceWithProvider(provider, out);
    if (enh.error) out.limitations.push(`Внешний AI-провайдер недоступен (${enh.error}) — использован встроенный анализ.`);

    const evRows = out.evidence.length
      ? await ctx.db.evidence.createManyAndReturn({
          data: out.evidence.map((e) => ({
            organizationId: ctx.org.id,
            diagnosticId,
            kind: e.kind,
            sourceType: e.sourceType,
            criterionCode: e.criterionCode,
            summary: e.summary,
            data: { ...e.data, key: e.key, analysisId: analysis.id } as object,
          })),
        })
      : [];
    const idByKey = new Map(out.evidence.map((e, i) => [e.key, evRows[i]?.id]));
    const ids = (keys: string[]) => keys.map((k) => idByKey.get(k)).filter((x): x is string => !!x);

    // Предыдущие открытые (не взятые в план) проблемы этой диагностики заменяются новым анализом.
    await ctx.db.problem.updateMany({ where: { diagnosticId, status: "OPEN" }, data: { status: "DISMISSED" } });

    for (const p of out.problems) {
      const existingInPlan = await ctx.db.problem.findFirst({
        where: { diagnosticId, criterionCode: p.criterionCode, status: { in: ["IN_PLAN", "MONITORING"] } },
      });
      if (existingInPlan) continue; // уже в работе — не дублируем
      const problem = await ctx.db.problem.create({
        data: {
          organizationId: ctx.org.id,
          diagnosticId,
          analysisId: analysis.id,
          dimension: p.dimension,
          criterionCode: p.criterionCode,
          title: p.title,
          description: p.description,
          consequences: p.consequences,
          findingStatus: p.findingStatus,
          confidence: p.confidence,
          severity: p.severity,
          businessImpact: p.businessImpact,
          urgency: p.urgency,
          scale: p.scale,
          systemic: p.systemic,
          feasibility: p.feasibility,
          priorityScore: p.priorityScore,
          priority: p.priority,
          evidenceIds: ids(p.evidenceKeys),
          dataSources: p.dataSources,
          causes: {
            create: p.causes.map((c) => ({
              organizationId: ctx.org.id,
              title: c.title,
              explanation: c.explanation,
              findingStatus: c.findingStatus,
              supportingCriteria: c.supportingCriteria,
              evidenceIds: ids(c.evidenceKeys),
            })),
          },
        },
      });
      await ctx.db.aIRecommendation.create({
        data: {
          organizationId: ctx.org.id,
          analysisId: analysis.id,
          problemId: problem.id,
          title: p.recommendation.title,
          rationale: p.recommendation.rationale,
          findingStatus: p.findingStatus,
          confidence: p.confidence,
          dataSources: p.dataSources,
          metricsUsed: p.recommendation.metricsUsed,
          limitations: p.recommendation.limitations,
        },
      });
    }

    await ctx.db.aIAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        limitations: out.limitations,
        output: {
          summary: out.summary,
          contradictions: out.contradictions,
          problems: out.problems.length,
          byPriority: countBy(out.problems.map((p) => p.priority)),
          llmApplied: enh.applied,
          checklists: Object.fromEntries(out.problems.map((p) => [p.criterionCode, p.recommendation.checklist])),
        } as object,
      },
    });
    await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "analysis.run", "AIAnalysis", analysis.id, {
      provider: provider.name,
      problems: out.problems.length,
    });

    const p1 = out.problems.filter((p) => p.priority === "P1").length;
    if (p1 > 0) {
      await notifyUsers({
        orgId: ctx.org.id,
        userIds: await usersWithPermission(ctx.org.id, "plan.approve"),
        type: "analysis.critical",
        title: `Анализ выявил критические проблемы: ${p1}`,
        body: out.summary.slice(0, 400),
        link: `/problems`,
      });
    }
    return { analysisId: analysis.id, output: out };
  } catch (e) {
    await ctx.db.aIAnalysis.update({
      where: { id: analysis.id },
      data: { status: "FAILED", error: e instanceof Error ? e.message : String(e), completedAt: new Date() },
    });
    throw e;
  }
}

function countBy(xs: string[]) {
  return xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});
}

export async function latestAnalysis(ctx: OrgContext, diagnosticId: string) {
  return ctx.db.aIAnalysis.findFirst({
    where: { diagnosticId, kind: "DIAGNOSTIC" },
    orderBy: { createdAt: "desc" },
  });
}

export async function listProblems(
  ctx: OrgContext,
  filter: { priority?: PriorityCategory; status?: ProblemStatus | "ACTIVE"; diagnosticId?: string } = {},
) {
  if (!ctx.can("problems.view")) throw forbidden();
  const statusWhere =
    !filter.status || filter.status === "ACTIVE" ? { status: { in: ["OPEN", "IN_PLAN", "MONITORING"] as ProblemStatus[] } } : { status: filter.status };
  return ctx.db.problem.findMany({
    where: {
      ...statusWhere,
      ...(filter.priority ? { priority: filter.priority } : {}),
      ...(filter.diagnosticId ? { diagnosticId: filter.diagnosticId } : {}),
      diagnostic: { archivedAt: null, ...diagnosticScopeWhere(ctx) },
    },
    orderBy: [{ priority: "asc" }, { priorityScore: "desc" }],
    include: { diagnostic: { select: { title: true } }, _count: { select: { causes: true, tasks: true } } },
  });
}

export async function getProblem(ctx: OrgContext, id: string) {
  if (!ctx.can("problems.view")) throw forbidden();
  const p = await ctx.db.problem.findFirst({
    where: { id, diagnostic: diagnosticScopeWhere(ctx) },
    include: {
      causes: true,
      recommendations: { orderBy: { createdAt: "desc" } },
      tasks: { select: { id: true, title: true, status: true, outcome: true } },
      diagnostic: { select: { id: true, title: true } },
      analysis: { select: { id: true, provider: true, model: true, methodologyVersion: true, createdAt: true, limitations: true, output: true } },
    },
  });
  if (!p) throw notFound("Проблема не найдена");
  const evIds = [...new Set([...p.evidenceIds, ...p.causes.flatMap((c) => c.evidenceIds)])];
  const evidence = await ctx.db.evidence.findMany({ where: { id: { in: evIds } } });
  return { problem: p, evidence };
}

export async function setProblemStatus(ctx: OrgContext, id: string, status: "DISMISSED" | "OPEN", reason?: string) {
  if (!ctx.can("plan.manage")) throw forbidden();
  const p = await ctx.db.problem.findFirst({ where: { id } });
  if (!p) throw notFound("Проблема не найдена");
  if (p.status === "IN_PLAN" && status === "DISMISSED") throw new AppError("Проблема уже в плане — сначала уберите задачи из плана");
  await ctx.db.problem.update({ where: { id }, data: { status } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "problem.status", "Problem", id, { status, reason });
}
