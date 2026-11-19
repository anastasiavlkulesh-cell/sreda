import "server-only";
import { prisma } from "../db/client";
import { CRITERIA, DIMENSIONS, METHODOLOGY_VERSION, OPEN_QUESTIONS } from "@/domain/methodology/v1";
import type { CriterionInput } from "@/domain/ssi";
import type { DimensionKey, SourceType } from "@/domain/types";
import { METRIC_DERIVED_CRITERIA } from "@/domain/metrics";

let ensured: Promise<void> | null = null;

/** Идемпотентно записывает справочники методики текущей версии в БД. */
export function ensureMethodology(): Promise<void> {
  ensured ??= (async () => {
    for (const [i, d] of DIMENSIONS.entries()) {
      const dim = await prisma.serviceDimension.upsert({
        where: { key_methodologyVersion: { key: d.key, methodologyVersion: METHODOLOGY_VERSION } },
        update: { name: d.name, description: d.description, sortOrder: i },
        create: { key: d.key, methodologyVersion: METHODOLOGY_VERSION, name: d.name, description: d.description, sortOrder: i, weight: 20 },
      });
      for (const c of CRITERIA.filter((x) => x.dimension === d.key)) {
        const existing = await prisma.assessmentCriterion.findFirst({
          where: { dimensionId: dim.id, code: c.code, organizationId: null },
        });
        const data = {
          title: c.title,
          description: c.description,
          weight: c.weight,
          businessImpact: c.businessImpact,
          urgency: c.urgency,
          feasibility: c.feasibility,
        };
        if (existing) await prisma.assessmentCriterion.update({ where: { id: existing.id }, data });
        else await prisma.assessmentCriterion.create({ data: { ...data, dimensionId: dim.id, code: c.code, scope: "UNIVERSAL" } });
      }
    }
  })().catch((e) => {
    ensured = null;
    throw e;
  });
  return ensured;
}

export interface CriterionRow {
  id: string;
  code: string;
  dimension: DimensionKey;
  title: string;
  description: string;
  weight: number;
  businessImpact: number;
  urgency: number;
  feasibility: number;
  isCustom: boolean;
  questions: Partial<Record<SourceType, string>>;
}

/** Критерии методики + индивидуальные критерии компании. */
export async function loadCriteria(orgId: string): Promise<CriterionRow[]> {
  await ensureMethodology();
  const rows = await prisma.assessmentCriterion.findMany({
    where: {
      isActive: true,
      dimension: { methodologyVersion: METHODOLOGY_VERSION },
      OR: [{ organizationId: null }, { organizationId: orgId }],
    },
    include: { dimension: true },
    orderBy: [{ dimension: { sortOrder: "asc" } }, { code: "asc" }],
  });
  return rows.map((r) => {
    const def = CRITERIA.find((c) => c.code === r.code && r.organizationId === null);
    const custom = r.organizationId !== null;
    return {
      id: r.id,
      code: r.code,
      dimension: r.dimension.key,
      title: r.title,
      description: r.description,
      weight: r.weight,
      businessImpact: r.businessImpact,
      urgency: r.urgency,
      feasibility: r.feasibility,
      isCustom: custom,
      // Индивидуальный критерий оценивают собственник и руководитель по его описанию.
      questions: def?.questions ?? { OWNER: r.description, MANAGER: r.description },
    };
  });
}

export function toCriterionInputs(rows: CriterionRow[]): CriterionInput[] {
  return rows.map((r) => {
    const sources = Object.keys(r.questions) as SourceType[];
    if (METRIC_DERIVED_CRITERIA.includes(r.code)) sources.push("BUSINESS_METRICS");
    return { code: r.code, dimension: r.dimension, title: r.title, weight: r.weight, applicableSources: sources };
  });
}

export interface QuestionDraft {
  criterionId: string | null;
  type: "SCALE" | "TEXT";
  text: string;
  isRequired: boolean;
  sortOrder: number;
}

export function buildQuestions(rows: CriterionRow[], source: SourceType): QuestionDraft[] {
  const out: QuestionDraft[] = [];
  for (const r of rows) {
    const text = r.questions[source];
    if (text) out.push({ criterionId: r.id, type: "SCALE", text, isRequired: true, sortOrder: out.length });
  }
  for (const q of OPEN_QUESTIONS[source] ?? []) {
    out.push({ criterionId: null, type: "TEXT", text: q, isRequired: false, sortOrder: out.length });
  }
  return out;
}
