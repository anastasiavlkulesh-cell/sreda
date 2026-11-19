/**
 * Жизненный цикл задач плана улучшений и проверка доказательств.
 * Принцип: формальное закрытие задачи не означает устранения проблемы —
 * эффект подтверждается только повторным замером критерия.
 */
export type TaskStatus =
  | "NEW" | "PENDING_APPROVAL" | "PLANNED" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "OVERDUE" | "NEEDS_REVISION";

export type TaskAction = "submit_plan" | "approve" | "return_to_draft" | "start" | "submit_review" | "accept" | "reject" | "mark_overdue";

const TRANSITIONS: Record<TaskAction, { from: TaskStatus[]; to: TaskStatus }> = {
  submit_plan: { from: ["NEW"], to: "PENDING_APPROVAL" },
  approve: { from: ["PENDING_APPROVAL"], to: "PLANNED" },
  return_to_draft: { from: ["PENDING_APPROVAL"], to: "NEW" },
  start: { from: ["PLANNED", "NEEDS_REVISION", "OVERDUE"], to: "IN_PROGRESS" },
  submit_review: { from: ["IN_PROGRESS", "OVERDUE", "NEEDS_REVISION"], to: "IN_REVIEW" },
  accept: { from: ["IN_REVIEW"], to: "DONE" },
  reject: { from: ["IN_REVIEW"], to: "NEEDS_REVISION" },
  mark_overdue: { from: ["PLANNED", "IN_PROGRESS", "NEEDS_REVISION"], to: "OVERDUE" },
};

export function nextStatus(current: TaskStatus, action: TaskAction): TaskStatus | null {
  const t = TRANSITIONS[action];
  return t.from.includes(current) ? t.to : null;
}

export function isOverdue(status: TaskStatus, dueDate: Date | null, now = new Date()): boolean {
  return !!dueDate && dueDate.getTime() < now.getTime() && ["PLANNED", "IN_PROGRESS", "NEEDS_REVISION", "OVERDUE"].includes(status);
}

export const DUE_DAYS_BY_PRIORITY = { P1: 14, P2: 30, P3: 60, P4: 90 } as const;

// ---------------------------------------------------------------------------
// Проверка доказательств
// ---------------------------------------------------------------------------

export interface EvidenceItem {
  kind: "FILE" | "LINK" | "TEXT";
  description: string;
  mimeType?: string | null;
  createdAt: Date;
}

export interface EvidenceReview {
  verdict: "SUFFICIENT" | "INSUFFICIENT" | "NEEDS_HUMAN";
  score: number;
  findings: { ok: boolean; text: string }[];
  note: string;
  reviewedAt: string;
}

export function reviewEvidence(input: {
  evidence: EvidenceItem[];
  checklistTotal: number;
  checklistDone: number;
  startedAt: Date | null;
  priority: "P1" | "P2" | "P3" | "P4";
}): EvidenceReview {
  const findings: EvidenceReview["findings"] = [];
  let score = 0;

  const n = input.evidence.length;
  findings.push({ ok: n > 0, text: n > 0 ? `Приложено доказательств: ${n}.` : "Доказательства не приложены." });
  if (n > 0) score += 1;

  const docs = input.evidence.filter((e) => e.kind === "FILE");
  const photos = docs.filter((e) => e.mimeType?.startsWith("image/"));
  if (docs.length) {
    score += 1;
    findings.push({ ok: true, text: `Есть файлы-подтверждения${photos.length ? ` (фото: ${photos.length})` : ""}.` });
  } else {
    findings.push({ ok: false, text: "Нет файлов (документ, фото, отчёт) — только текстовые описания или ссылки." });
  }

  const weak = input.evidence.filter((e) => e.description.trim().length < 15);
  if (weak.length) findings.push({ ok: false, text: `Слишком краткое описание у ${weak.length} доказательств — непонятно, что именно подтверждается.` });
  else if (n) score += 1;

  if (input.checklistTotal > 0) {
    const pct = Math.round((input.checklistDone / input.checklistTotal) * 100);
    const ok = input.checklistDone === input.checklistTotal;
    findings.push({ ok, text: `Чек-лист выполнен на ${pct}% (${input.checklistDone} из ${input.checklistTotal}).` });
    if (ok) score += 1;
  }

  if (input.startedAt) {
    const before = input.evidence.filter((e) => e.createdAt.getTime() < input.startedAt!.getTime());
    if (before.length) findings.push({ ok: false, text: `${before.length} доказательств добавлены до начала работы над задачей.` });
  }

  const maxScore = input.checklistTotal > 0 ? 4 : 3;
  const ratio = score / maxScore;
  let verdict: EvidenceReview["verdict"];
  if (n === 0 || ratio < 0.5) verdict = "INSUFFICIENT";
  else if (ratio >= 0.99 && (input.priority === "P3" || input.priority === "P4" || docs.length > 0)) verdict = "SUFFICIENT";
  else verdict = "NEEDS_HUMAN";

  return {
    verdict,
    score: Math.round(ratio * 100) / 100,
    findings,
    note: "Проверка подтверждает факт выполнения работ, но не устранение проблемы. Эффект оценивается повторным замером критерия в следующей диагностике.",
    reviewedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Оценка результата повторным замером
// ---------------------------------------------------------------------------

export const IMPROVEMENT_DELTA = 0.3;

export function evaluateOutcome(before: number | null, after: number | null): "IMPROVED" | "NO_EFFECT" | "AWAITING_REMEASURE" {
  if (before === null || after === null) return "AWAITING_REMEASURE";
  return after - before >= IMPROVEMENT_DELTA ? "IMPROVED" : "NO_EFFECT";
}
