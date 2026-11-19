/**
 * Расчёт SERVICE 5D и SSI.
 *
 *   D = 25 × Σ((s − 1) × w) / Σw        (s — оценка критерия 1..5, w — вес)
 *   SSI = среднее пяти направлений (вес каждого 20%) — только если по всем
 *         пяти направлениям данных достаточно. Иначе SSI = null.
 *
 * Фиктивные значения никогда не подставляются: критерий без данных
 * исключается из расчёта и снижает покрытие (coverage) направления.
 */
import { DIMENSIONS } from "./methodology/v1";
import { DIMENSION_ORDER, type Confidence, type DimensionKey, type SourceType } from "./types";

export interface CriterionInput {
  code: string;
  dimension: DimensionKey;
  title: string;
  weight: number;
  /** Источники, которые в принципе могут оценить критерий (есть вопрос). */
  applicableSources: SourceType[];
}

/** Оценки 1..5 по критерию от источника (каждое значение — один ответ). */
export type Ratings = Map<string, Map<SourceType, number[]>>;

export interface SourceStat {
  type: SourceType;
  responses: number;
  target: number;
  enabled: boolean;
}

export interface CriterionResult {
  code: string;
  title: string;
  weight: number;
  /** Средняя оценка по источнику */
  bySource: Partial<Record<SourceType, { mean: number; n: number }>>;
  /** Итоговая оценка критерия: среднее средних по источникам. null — нет данных. */
  score: number | null;
  /** Максимальный разрыв между источниками */
  spread: number | null;
}

export interface DimensionResult {
  key: DimensionKey;
  score: number | null;
  rawScore: number | null;
  coverage: number;
  confidence: Confidence;
  sourcesUsed: SourceType[];
  criteria: CriterionResult[];
  limitations: string[];
}

export interface AssessmentResult {
  ssi: number | null;
  confidence: Confidence;
  dimensions: DimensionResult[];
  limitations: string[];
  criticalRisks: string[];
}

export interface CalcOptions {
  /** Минимальная доля веса критериев с данными, при которой направление оценивается. */
  minCoverage?: number;
  /** Порог критического значения критерия */
  criticalCriterionScore?: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function dimensionScore(items: { score: number; weight: number }[]): number {
  if (items.length === 0) throw new Error("Нет критериев с данными");
  let num = 0;
  let den = 0;
  for (const { score, weight } of items) {
    if (score < 1 || score > 5) throw new RangeError(`Оценка вне шкалы 1..5: ${score}`);
    if (weight <= 0) throw new RangeError(`Вес должен быть положительным: ${weight}`);
    num += (score - 1) * weight;
    den += weight;
  }
  return (25 * num) / den;
}

export function scoreLevel(d: number): { key: string; label: string } {
  if (d < 25) return { key: "critical", label: "Критическое состояние" };
  if (d < 50) return { key: "low", label: "Низкий уровень" };
  if (d < 75) return { key: "basic", label: "Базовый уровень" };
  if (d < 90) return { key: "good", label: "Хороший уровень" };
  return { key: "high", label: "Высокий уровень" };
}

function sourceIsReliable(stat: SourceStat | undefined): boolean {
  return !!stat && stat.enabled && stat.responses >= stat.target;
}

export function calculateAssessment(
  criteria: CriterionInput[],
  ratings: Ratings,
  sourceStats: SourceStat[],
  opts: CalcOptions = {},
): AssessmentResult {
  const minCoverage = opts.minCoverage ?? 0.6;
  const criticalScore = opts.criticalCriterionScore ?? 1.8;
  const statByType = new Map(sourceStats.map((s) => [s.type, s]));
  const enabled = new Set(sourceStats.filter((s) => s.enabled).map((s) => s.type));

  const dimensions: DimensionResult[] = [];
  const criticalRisks: string[] = [];

  for (const key of DIMENSION_ORDER) {
    const def = DIMENSIONS.find((d) => d.key === key)!;
    const dimCriteria = criteria.filter((c) => c.dimension === key);
    const limitations: string[] = [];

    // Применимые критерии: те, что может оценить хотя бы один включённый источник.
    const applicable = dimCriteria.filter((c) => c.applicableSources.some((s) => enabled.has(s)));
    const results: CriterionResult[] = dimCriteria.map((c) => {
      const bySourceRaw = ratings.get(c.code) ?? new Map<SourceType, number[]>();
      const bySource: CriterionResult["bySource"] = {};
      for (const [src, vals] of bySourceRaw) {
        const valid = vals.filter((v) => Number.isFinite(v) && v >= 1 && v <= 5);
        if (valid.length && enabled.has(src)) bySource[src] = { mean: round2(mean(valid)), n: valid.length };
      }
      const means = Object.values(bySource).map((x) => x!.mean);
      return {
        code: c.code,
        title: c.title,
        weight: c.weight,
        bySource,
        score: means.length ? round2(mean(means)) : null,
        spread: means.length > 1 ? round2(Math.max(...means) - Math.min(...means)) : null,
      };
    });

    const withData = results.filter((r) => r.score !== null && applicable.some((a) => a.code === r.code));
    const totalW = applicable.reduce((a, c) => a + c.weight, 0);
    const dataW = withData.reduce((a, c) => a + c.weight, 0);
    const coverage = totalW > 0 ? round2(dataW / totalW) : 0;

    const sourcesUsed = [
      ...new Set(withData.flatMap((r) => Object.keys(r.bySource) as SourceType[])),
    ];
    const keySourceAvailable = def.keySources.some((s) => sourcesUsed.includes(s));
    const keySourceReliable = def.keySources.some((s) => sourcesUsed.includes(s) && sourceIsReliable(statByType.get(s)));

    if (applicable.length === 0) limitations.push("Ни один включённый источник не оценивает это направление.");
    if (coverage < minCoverage)
      limitations.push(`Покрытие критериев ${Math.round(coverage * 100)}% — ниже минимума ${Math.round(minCoverage * 100)}%.`);
    if (!keySourceAvailable) {
      const names = def.keySources.map((s) => SOURCE_NAMES[s]).join(" или ");
      limitations.push(`Нет данных ключевого источника: ${names}.`);
    } else if (!keySourceReliable) {
      limitations.push("Ключевой источник не набрал минимального числа ответов — вывод предварительный.");
    }

    const sufficient = applicable.length > 0 && coverage >= minCoverage && keySourceAvailable && withData.length > 0;
    let score: number | null = null;
    let rawScore: number | null = null;
    let confidence: Confidence = "INSUFFICIENT";
    if (sufficient) {
      rawScore = dimensionScore(withData.map((r) => ({ score: r.score!, weight: r.weight })));
      score = round1(rawScore);
      if (sourcesUsed.length >= 2 && coverage >= 0.9 && keySourceReliable) confidence = "HIGH";
      else if (sourcesUsed.length >= 2 && keySourceReliable) confidence = "MEDIUM";
      else confidence = "LOW";
      if (sourcesUsed.length < 2) limitations.push("Оценка основана на одном источнике.");
    }

    for (const r of withData) {
      if (r.score! <= criticalScore) criticalRisks.push(`${def.shortName}: «${r.title}» — критическое состояние (${r.score}).`);
    }
    if (score !== null && score < 25) criticalRisks.push(`Направление «${def.shortName}» в критическом состоянии (${score}).`);

    dimensions.push({ key, score, rawScore, coverage, confidence, sourcesUsed, criteria: results, limitations });
  }

  const insufficient = dimensions.filter((d) => d.score === null);
  const limitations: string[] = [];
  let ssi: number | null = null;
  let confidence: Confidence = "INSUFFICIENT";
  if (insufficient.length === 0) {
    ssi = round1(mean(dimensions.map((d) => d.rawScore!)));
    const order: Confidence[] = ["INSUFFICIENT", "LOW", "MEDIUM", "HIGH"];
    confidence = dimensions.map((d) => d.confidence).reduce((a, b) => (order.indexOf(a) < order.indexOf(b) ? a : b));
  } else {
    const names = insufficient.map((d) => DIMENSIONS.find((x) => x.key === d.key)!.shortName).join(", ");
    limitations.push(`SSI не рассчитан: недостаточно данных по направлениям — ${names}.`);
  }
  for (const s of sourceStats) {
    if (s.enabled && s.responses < s.target)
      limitations.push(`${SOURCE_NAMES[s.type]}: ${s.responses} из ${s.target} необходимых ответов.`);
  }

  return { ssi, confidence, dimensions, limitations, criticalRisks };
}

const SOURCE_NAMES: Record<SourceType, string> = {
  OWNER: "Собственник",
  MANAGER: "Руководитель",
  EMPLOYEE: "Сотрудники",
  CUSTOMER: "Клиенты",
  MYSTERY_SHOPPER: "Тайный покупатель",
  BUSINESS_METRICS: "Бизнес-показатели",
};
