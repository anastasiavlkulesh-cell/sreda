import { describe, it, expect, vi } from "vitest";
import { analyzeDiagnostic, TEXT_THEMES } from "@/domain/analysis";
import { calculateAssessment, type CriterionInput, type Ratings, type SourceStat } from "@/domain/ssi";
import { CRITERIA } from "@/domain/methodology/v1";
import type { SourceType } from "@/domain/types";
import { OpenAICompatibleProvider } from "@/server/ai/provider";
import { buildLlmContext } from "@/server/services/analysis";
import { z } from "zod";

const criteria: CriterionInput[] = CRITERIA.map((c) => ({
  code: c.code, dimension: c.dimension, title: c.title, weight: c.weight, applicableSources: Object.keys(c.questions) as SourceType[],
}));
const ALL: SourceType[] = ["OWNER", "MANAGER", "EMPLOYEE", "CUSTOMER", "MYSTERY_SHOPPER"];
const stats: SourceStat[] = ALL.map((t) => ({ type: t, responses: 10, target: 1, enabled: true }));

function build(profile: (code: string, s: SourceType) => number | undefined) {
  const r: Ratings = new Map();
  for (const c of CRITERIA) {
    const m = new Map<SourceType, number[]>();
    for (const s of Object.keys(c.questions) as SourceType[]) {
      const v = profile(c.code, s);
      if (v !== undefined) m.set(s, [v, v, v]);
    }
    r.set(c.code, m);
  }
  return calculateAssessment(criteria, r, stats);
}

const base = { sourceStats: stats, metricNotes: new Map(), customCriteria: [] };

describe("AI-анализ диагностики (доменный анализатор)", () => {
  it("высокая самооценка руководства не маскирует низкую оценку клиентов", () => {
    const out = analyzeDiagnostic({ ...base, assessment: build((code, s) => (code === "C1" ? (s === "CUSTOMER" || s === "MYSTERY_SHOPPER" ? 2.5 : 4) : 4)), texts: [] });
    expect(out.problems.find((p) => p.criterionCode === "C1")).toBeDefined();
  });

  it("всё хорошо → проблем нет, гипотезы не выдумываются", () => {
    const out = analyzeDiagnostic({ ...base, assessment: build(() => 4), texts: [] });
    expect(out.problems).toHaveLength(0);
    expect(out.contradictions).toHaveLength(0);
    expect(out.summary).toMatch(/не выявлено/);
  });

  it("низкая оценка у двух источников → «подтверждено», причина с данными → подтверждена", () => {
    const out = analyzeDiagnostic({
      ...base,
      assessment: build((code, s) => (code === "C1" && (s === "CUSTOMER" || s === "MYSTERY_SHOPPER") ? 2 : code === "T4" && s === "EMPLOYEE" ? 2 : code === "T4" ? 2 : 4)),
      texts: [],
    });
    const c1 = out.problems.find((p) => p.criterionCode === "C1")!;
    expect(c1.findingStatus).toBe("CONFIRMED");
    const overload = c1.causes.find((c) => c.supportingCriteria.includes("T4"))!;
    expect(overload.findingStatus).toBe("CONFIRMED");
    // S1 оценён на 4 → данными не подтверждён и в причины не попадает
    expect(c1.causes.some((c) => c.supportingCriteria.includes("S1"))).toBe(false);
    expect(c1.systemic).toBeGreaterThan(1);
  });

  it("низкая оценка одного источника → «частично подтверждено»", () => {
    // C6: клиенты 1, остальные 4 → среднее 3,25 > 3, но ключевые источники (клиенты 1 и тайный покупатель 4) = 2,5 ≤ 3
    const out = analyzeDiagnostic({ ...base, assessment: build((code, s) => (code === "C6" && s === "CUSTOMER" ? 1 : 4)), texts: [] });
    const c6 = out.problems.find((p) => p.criterionCode === "C6")!;
    expect(c6.title).toMatch(/Низкий уровень/);
    expect(c6.findingStatus).toBe("PARTIALLY_CONFIRMED");
    expect(c6.description).toMatch(/Ключевой источник/);
    const out2 = analyzeDiagnostic({ ...base, assessment: build((code, s) => (code === "C6" && s === "CUSTOMER" ? 1 : code === "C6" ? 3.5 : 4)), texts: [] });
    expect(out2.problems.find((p) => p.criterionCode === "C6")!.findingStatus).toBe("PARTIALLY_CONFIRMED");
  });

  it("выявляет противоречие «руководство завышает оценку»", () => {
    const out = analyzeDiagnostic({ ...base, assessment: build((code, s) => (code === "L1" ? (s === "EMPLOYEE" ? 2 : 5) : 4)), texts: [] });
    const c = out.contradictions.find((x) => x.criterionCode === "L1")!;
    expect(c.gap).toBe(3);
    expect(out.summary).toMatch(/переоценивает/);
    expect(out.problems.find((p) => p.criterionCode === "L1")!.findingStatus).toBe("PARTIALLY_CONFIRMED");
    expect(out.evidence.some((e) => e.kind === "CONTRADICTION" && e.criterionCode === "L1")).toBe(true);
  });

  it("открытые ответы подтверждают тему; цитаты анонимных источников скрываются при малой группе и очищаются от контактов", () => {
    const small = stats.map((s) => (s.type === "EMPLOYEE" ? { ...s, responses: 3 } : s));
    const out = analyzeDiagnostic({
      ...base,
      sourceStats: small,
      assessment: build((code, s) => (code === "T4" ? 2 : 4)),
      texts: [{ source: "EMPLOYEE", text: "Не хватает людей, звоните +7 912 345 67 89" }, { source: "CUSTOMER", text: "Долго ждал заказ, пишите a@b.ru" }],
    });
    const emp = out.evidence.find((e) => e.key === "text:T4:EMPLOYEE")!;
    expect((emp.data as { quotesHidden: boolean }).quotesHidden).toBe(true);
    const cust = out.evidence.find((e) => e.key === "text:C1:CUSTOMER")!;
    expect(JSON.stringify(cust.data)).not.toMatch(/a@b\.ru/);
  });

  it("причина без данных помечается гипотезой", () => {
    // S1 оценивают только собственник и руководитель; исключим их — данных по S1 нет
    const out = analyzeDiagnostic({ ...base, assessment: build((code, s) => (code === "C4" ? 2 : code === "S1" ? undefined : 4)), texts: [] });
    const c4 = out.problems.find((p) => p.criterionCode === "C4")!;
    const s1 = c4.causes.find((c) => c.title.startsWith("Стандарты описаны"))!;
    expect(s1.findingStatus).toBe("HYPOTHESIS");
  });

  it("для бизнес-результатов рекомендация содержит оговорку о внешних факторах", () => {
    const out = analyzeDiagnostic({ ...base, assessment: build((code) => (code === "B1" ? 2 : 4)), texts: [] });
    expect(out.problems.find((p) => p.criterionCode === "B1")!.recommendation.limitations.join(" ")).toMatch(/внешними факторами/);
  });

  it("лексикон тем покрывает ключевые формулировки", () => {
    expect(TEXT_THEMES.find((t) => t.code === "S4")!.pattern.test("Новичков учим на ходу")).toBe(true);
  });
});

describe("AI service layer: внешний провайдер", () => {
  it("в контекст для внешнего AI не попадают тексты ответов и цитаты", () => {
    const out = analyzeDiagnostic({
      ...base,
      assessment: build((code) => (code === "T4" ? 2 : 4)),
      texts: [{ source: "EMPLOYEE", text: "Иван Петров на кухне постоянно не хватает людей" }],
    });
    const ctx = JSON.stringify(buildLlmContext(out));
    expect(ctx).not.toMatch(/Иван|Петров|кухне/);
  });

  it("ответ провайдера проверяется схемой; неверный ответ отклоняется", async () => {
    const fetchOk = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"ok"}' } }] })));
    const p = new OpenAICompatibleProvider("https://ai.example", "key", "m", fetchOk as unknown as typeof fetch);
    await expect(p.completeJson({ system: "s", user: "u", schema: z.object({ summary: z.string(), x: z.number() }) })).rejects.toThrow(/схемы/);
    const body = JSON.parse((fetchOk.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[0].role).toBe("system");
  });
});
