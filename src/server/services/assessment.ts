import "server-only";
import type { TenantDb } from "../db/tenant";
import { calculateAssessment, type Ratings, type SourceStat, type AssessmentResult } from "@/domain/ssi";
import { metricDerivedScores, type MetricPoint, type MetricKey } from "@/domain/metrics";
import { METHODOLOGY_VERSION } from "@/domain/methodology/v1";
import type { SourceType } from "@/domain/types";
import { loadCriteria, toCriterionInputs, type CriterionRow } from "./methodology";
import { notFound } from "../errors";

export interface CollectedData {
  criteria: CriterionRow[];
  ratings: Ratings;
  sourceStats: SourceStat[];
  /** Текстовые ответы по источникам (для анализа; анонимные — без привязки к людям) */
  texts: { source: SourceType; question: string; text: string }[];
  metricNotes: Map<string, string>;
}

/** Собирает все данные диагностики: оценки по критериям и источникам, тексты, метрики. */
export async function collectDiagnosticData(db: TenantDb, orgId: string, diagnosticId: string): Promise<CollectedData> {
  const diagnostic = await db.diagnostic.findFirst({
    where: { id: diagnosticId },
    include: { sources: true },
  });
  if (!diagnostic) throw notFound("Диагностика не найдена");

  const criteria = await loadCriteria(orgId);
  const codeById = new Map(criteria.map((c) => [c.id, c.code]));

  const surveys = await db.survey.findMany({
    where: { diagnosticId, kind: "DIAGNOSTIC" },
    include: {
      questions: true,
      responses: { include: { answers: true } },
    },
  });

  const ratings: Ratings = new Map();
  const texts: CollectedData["texts"] = [];
  const responsesBySource = new Map<SourceType, number>();

  for (const s of surveys) {
    const source = s.sourceType as SourceType;
    responsesBySource.set(source, (responsesBySource.get(source) ?? 0) + s.responses.length);
    const qById = new Map(s.questions.map((q) => [q.id, q]));
    for (const r of s.responses) {
      for (const a of r.answers) {
        const q = qById.get(a.questionId);
        if (!q) continue;
        if (q.type === "SCALE" && q.criterionId && a.value !== null) {
          const code = codeById.get(q.criterionId);
          if (!code) continue;
          const bySource = ratings.get(code) ?? new Map<SourceType, number[]>();
          bySource.set(source, [...(bySource.get(source) ?? []), a.value]);
          ratings.set(code, bySource);
        }
        if (q.type === "TEXT" && a.text?.trim()) texts.push({ source, question: q.text, text: a.text.trim() });
      }
    }
  }

  // Бизнес-показатели как источник
  const metricNotes = new Map<string, string>();
  const metricsSource = diagnostic.sources.find((x) => x.type === "BUSINESS_METRICS" && x.isEnabled);
  let metricResponses = 0;
  if (metricsSource) {
    const metrics = await db.businessMetric.findMany({
      where: {
        kind: "FACT",
        ...(diagnostic.locationId ? { OR: [{ locationId: diagnostic.locationId }, { locationId: null }] } : {}),
      },
    });
    const points: MetricPoint[] = metrics.map((m) => ({
      key: m.key as MetricKey,
      kind: m.kind,
      periodStart: m.periodStart,
      value: m.value,
    }));
    for (const [code, { score, explanation }] of metricDerivedScores(points)) {
      const bySource = ratings.get(code) ?? new Map<SourceType, number[]>();
      bySource.set("BUSINESS_METRICS", [score]);
      ratings.set(code, bySource);
      metricNotes.set(code, explanation);
      metricResponses = 1;
    }
  }

  const sourceStats: SourceStat[] = diagnostic.sources.map((src) => ({
    type: src.type as SourceType,
    enabled: src.isEnabled,
    target: src.targetResponses,
    responses: src.type === "BUSINESS_METRICS" ? metricResponses : (responsesBySource.get(src.type as SourceType) ?? 0),
  }));

  return { criteria, ratings, sourceStats, texts, metricNotes };
}

export function computeFromData(data: CollectedData): AssessmentResult {
  return calculateAssessment(toCriterionInputs(data.criteria), data.ratings, data.sourceStats);
}

/** Рассчитывает SERVICE 5D и сохраняет снимок (Assessment). */
export async function calculateAndStoreAssessment(db: TenantDb, orgId: string, diagnosticId: string) {
  const data = await collectDiagnosticData(db, orgId, diagnosticId);
  const result = computeFromData(data);
  const assessment = await db.assessment.create({
    data: {
      organizationId: orgId,
      diagnosticId,
      methodologyVersion: METHODOLOGY_VERSION,
      ssi: result.ssi,
      confidence: result.confidence,
      dimensions: result.dimensions as unknown as object,
      limitations: result.limitations,
      criticalRisks: result.criticalRisks,
      sourceStats: data.sourceStats as unknown as object,
    },
  });
  return { assessment, result, data };
}

export type StoredDimension = AssessmentResult["dimensions"][number];

export function parseDimensions(json: unknown): StoredDimension[] {
  return (json as StoredDimension[]) ?? [];
}
