/**
 * Приоритизация проблем.
 * Пять параметров (серьёзность, влияние на бизнес, срочность, масштаб,
 * системность причин) формируют приоритет. Возможность исправления
 * (реализуемость) оценивается отдельно и на категорию не влияет.
 * Веса и пороги — настраиваемые (Organization.settings.priority), стартовые
 * значения ниже калибруются на пилотах.
 */
import type { PriorityCategory } from "./types";

export interface PriorityParams {
  severity: number;
  businessImpact: number;
  urgency: number;
  scale: number;
  systemic: number;
}

export interface PrioritySettings {
  weights: PriorityParams;
  thresholds: { P1: number; P2: number; P3: number };
}

export const DEFAULT_PRIORITY_SETTINGS: PrioritySettings = {
  weights: { severity: 0.3, businessImpact: 0.25, urgency: 0.2, scale: 0.1, systemic: 0.15 },
  thresholds: { P1: 3.8, P2: 3.2, P3: 2.6 },
};

const clamp = (x: number) => Math.max(1, Math.min(5, Math.round(x)));

export function validatePrioritySettings(s: PrioritySettings): string[] {
  const errors: string[] = [];
  const sum = Object.values(s.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.001) errors.push("Сумма весов параметров должна быть равна 1.");
  if (Object.values(s.weights).some((w) => w < 0)) errors.push("Веса не могут быть отрицательными.");
  const { P1, P2, P3 } = s.thresholds;
  if (!(P1 > P2 && P2 > P3)) errors.push("Пороги должны убывать: P1 > P2 > P3.");
  if ([P1, P2, P3].some((t) => t < 1 || t > 5)) errors.push("Пороги должны быть в диапазоне 1–5.");
  return errors;
}

export function priorityScore(p: PriorityParams, s: PrioritySettings = DEFAULT_PRIORITY_SETTINGS): number {
  const w = s.weights;
  const score =
    p.severity * w.severity +
    p.businessImpact * w.businessImpact +
    p.urgency * w.urgency +
    p.scale * w.scale +
    p.systemic * w.systemic;
  return Math.round(score * 100) / 100;
}

export function priorityCategory(score: number, s: PrioritySettings = DEFAULT_PRIORITY_SETTINGS): PriorityCategory {
  if (score >= s.thresholds.P1) return "P1";
  if (score >= s.thresholds.P2) return "P2";
  if (score >= s.thresholds.P3) return "P3";
  return "P4";
}

/** Серьёзность по оценке критерия 1..5 (чем ниже оценка, тем серьёзнее). */
export function severityFromScore(score: number): number {
  if (score <= 1.5) return 5;
  if (score <= 2) return 4;
  if (score <= 2.5) return 3;
  if (score <= 3) return 2;
  return 1;
}

/** Масштаб: доля источников, отметивших проблему (оценка ≤ 3). */
export function scaleFromSources(lowSources: number, totalSources: number): number {
  if (totalSources <= 1) return 2;
  const r = lowSources / totalSources;
  if (r >= 0.75) return 5;
  if (r >= 0.5) return 4;
  if (r >= 0.34) return 3;
  return 2;
}

/** Системность: сколько причин подтверждено данными (полностью или частично). */
export function systemicFromCauses(supportedCauses: number): number {
  if (supportedCauses <= 0) return 1;
  if (supportedCauses === 1) return 3;
  if (supportedCauses === 2) return 4;
  return 5;
}

export function normalizeParam(x: number): number {
  return clamp(x);
}

export const PRIORITY_LABELS: Record<PriorityCategory, string> = {
  P1: "P1 — критично, действовать сейчас",
  P2: "P2 — высокий приоритет",
  P3: "P3 — средний приоритет",
  P4: "P4 — низкий приоритет",
};
