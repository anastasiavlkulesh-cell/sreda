import { describe, it, expect } from "vitest";
import { nextStatus, reviewEvidence, evaluateOutcome, isOverdue } from "@/domain/tasks";

describe("жизненный цикл задачи", () => {
  it("разрешает только допустимые переходы", () => {
    expect(nextStatus("NEW", "submit_plan")).toBe("PENDING_APPROVAL");
    expect(nextStatus("PENDING_APPROVAL", "approve")).toBe("PLANNED");
    expect(nextStatus("PLANNED", "start")).toBe("IN_PROGRESS");
    expect(nextStatus("IN_PROGRESS", "submit_review")).toBe("IN_REVIEW");
    expect(nextStatus("IN_REVIEW", "accept")).toBe("DONE");
    expect(nextStatus("IN_REVIEW", "reject")).toBe("NEEDS_REVISION");
    expect(nextStatus("NEW", "accept")).toBeNull();
    expect(nextStatus("DONE", "start")).toBeNull();
    expect(nextStatus("PLANNED", "accept")).toBeNull();
  });
  it("просрочка", () => {
    const past = new Date(Date.now() - 1000);
    expect(isOverdue("IN_PROGRESS", past)).toBe(true);
    expect(isOverdue("DONE", past)).toBe(false);
    expect(isOverdue("IN_PROGRESS", null)).toBe(false);
  });
});

describe("AI-проверка доказательств", () => {
  const now = new Date();
  it("без доказательств — недостаточно", () => {
    expect(reviewEvidence({ evidence: [], checklistTotal: 3, checklistDone: 3, startedAt: null, priority: "P3" }).verdict).toBe("INSUFFICIENT");
  });
  it("файл + полный чек-лист + внятное описание — достаточно", () => {
    const r = reviewEvidence({
      evidence: [{ kind: "FILE", description: "Фото графика смен, утверждён управляющим", mimeType: "image/jpeg", createdAt: now }],
      checklistTotal: 2, checklistDone: 2, startedAt: new Date(now.getTime() - 1000), priority: "P1",
    });
    expect(r.verdict).toBe("SUFFICIENT");
    expect(r.note).toMatch(/не устранение проблемы/);
  });
  it("только текст по P1 — требуется решение руководителя; доказательство до начала работ отмечается", () => {
    const r = reviewEvidence({
      evidence: [{ kind: "TEXT", description: "Сделали всё по плану, проверили", createdAt: new Date(now.getTime() - 5000) }],
      checklistTotal: 2, checklistDone: 1, startedAt: now, priority: "P1",
    });
    expect(r.verdict).not.toBe("SUFFICIENT");
    expect(r.findings.some((f) => /до начала работы/.test(f.text))).toBe(true);
  });
});

describe("оценка результата повторным замером", () => {
  it("улучшение на 0,3 и более — подтверждено, меньше — эффект не подтверждён", () => {
    expect(evaluateOutcome(2.5, 2.9)).toBe("IMPROVED");
    expect(evaluateOutcome(2.5, 2.7)).toBe("NO_EFFECT");
    expect(evaluateOutcome(2.5, 2.2)).toBe("NO_EFFECT");
    expect(evaluateOutcome(null, 3)).toBe("AWAITING_REMEASURE");
  });
});
