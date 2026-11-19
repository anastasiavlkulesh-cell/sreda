import { describe, it, expect } from "vitest";
import { calculateAssessment, dimensionScore, scoreLevel, type CriterionInput, type Ratings, type SourceStat } from "@/domain/ssi";
import type { SourceType } from "@/domain/types";

describe("формула направления D = 25 × Σ((s−1)·w)/Σw", () => {
  it("все пятёрки → 100, все единицы → 0", () => {
    expect(dimensionScore([{ score: 5, weight: 1 }, { score: 5, weight: 3 }])).toBe(100);
    expect(dimensionScore([{ score: 1, weight: 2 }])).toBe(0);
  });
  it("учитывает веса", () => {
    // (3-1)*1 + (5-1)*3 = 14; Σw = 4 → 25*14/4 = 87.5
    expect(dimensionScore([{ score: 3, weight: 1 }, { score: 5, weight: 3 }])).toBe(87.5);
  });
  it("оценка 4 = 75 (хороший уровень)", () => {
    expect(dimensionScore([{ score: 4, weight: 1 }])).toBe(75);
    expect(scoreLevel(75).key).toBe("good");
    expect(scoreLevel(24.9).key).toBe("critical");
  });
  it("отклоняет значения вне шкалы", () => {
    expect(() => dimensionScore([{ score: 6, weight: 1 }])).toThrow();
    expect(() => dimensionScore([{ score: 3, weight: 0 }])).toThrow();
    expect(() => dimensionScore([])).toThrow();
  });
});

const criteria: CriterionInput[] = [
  { code: "C1", dimension: "CUSTOMER", title: "c1", weight: 2, applicableSources: ["CUSTOMER", "OWNER"] },
  { code: "C2", dimension: "CUSTOMER", title: "c2", weight: 1, applicableSources: ["CUSTOMER"] },
  { code: "T1", dimension: "TEAM", title: "t1", weight: 1, applicableSources: ["EMPLOYEE"] },
  { code: "L1", dimension: "LEADERSHIP", title: "l1", weight: 1, applicableSources: ["EMPLOYEE", "OWNER"] },
  { code: "S1", dimension: "STANDARDS", title: "s1", weight: 1, applicableSources: ["OWNER"] },
  { code: "B1", dimension: "BUSINESS_RESULTS", title: "b1", weight: 1, applicableSources: ["OWNER"] },
];

function ratings(entries: [string, SourceType, number[]][]): Ratings {
  const r: Ratings = new Map();
  for (const [code, src, vals] of entries) {
    const m = r.get(code) ?? new Map();
    m.set(src, vals);
    r.set(code, m);
  }
  return r;
}

const stats = (o: Partial<Record<SourceType, number>>): SourceStat[] =>
  (["OWNER", "EMPLOYEE", "CUSTOMER"] as SourceType[]).map((t) => ({ type: t, responses: o[t] ?? 0, target: t === "OWNER" ? 1 : 5, enabled: true }));

describe("расчёт SERVICE 5D и SSI", () => {
  it("рассчитывает SSI как среднее пяти направлений при достаточных данных", () => {
    const r = ratings([
      ["C1", "CUSTOMER", [4, 4, 4, 4, 4]], ["C1", "OWNER", [4]], ["C2", "CUSTOMER", [2, 2, 2, 2, 2]],
      ["T1", "EMPLOYEE", [3, 3, 3, 3, 3]], ["L1", "EMPLOYEE", [5, 5, 5, 5, 5]], ["L1", "OWNER", [5]],
      ["S1", "OWNER", [1]], ["B1", "OWNER", [3]],
    ]);
    const res = calculateAssessment(criteria, r, stats({ OWNER: 1, EMPLOYEE: 5, CUSTOMER: 5 }));
    const byKey = Object.fromEntries(res.dimensions.map((d) => [d.key, d.score]));
    // CUSTOMER: (4-1)*2 + (2-1)*1 = 7, Σw=3 → 58.3
    expect(byKey.CUSTOMER).toBe(58.3);
    expect(byKey.TEAM).toBe(50);
    expect(byKey.LEADERSHIP).toBe(100);
    expect(byKey.STANDARDS).toBe(0);
    expect(byKey.BUSINESS_RESULTS).toBe(50);
    // SSI — среднее неокруглённых значений: (58.333+50+100+0+50)/5 = 51.67 → 51.7
    expect(res.ssi).toBe(51.7);
    expect(res.criticalRisks.some((x) => x.includes("s1"))).toBe(true);
  });

  it("не подставляет значения: без данных направления SSI = null", () => {
    const r = ratings([["C1", "CUSTOMER", [4, 4, 4, 4, 4]], ["C2", "CUSTOMER", [4, 4, 4, 4, 4]], ["S1", "OWNER", [3]], ["B1", "OWNER", [3]]]);
    const res = calculateAssessment(criteria, r, stats({ OWNER: 1, CUSTOMER: 5 }));
    expect(res.ssi).toBeNull();
    expect(res.confidence).toBe("INSUFFICIENT");
    const team = res.dimensions.find((d) => d.key === "TEAM")!;
    expect(team.score).toBeNull();
    expect(team.limitations.join(" ")).toMatch(/ключевого источника/);
    expect(res.limitations.join(" ")).toMatch(/SSI не рассчитан/);
  });

  it("направление без ключевого источника не оценивается, даже если покрытие есть", () => {
    // L1 оценил только собственник — ключевой источник LEADERSHIP — сотрудники
    const r = ratings([["L1", "OWNER", [5]]]);
    const res = calculateAssessment(criteria, r, stats({ OWNER: 1 }));
    expect(res.dimensions.find((d) => d.key === "LEADERSHIP")!.score).toBeNull();
  });

  it("низкое покрытие критериев блокирует оценку направления", () => {
    // CUSTOMER: оценён только C2 (вес 1 из 3) → покрытие 33% < 60%
    const r = ratings([["C2", "CUSTOMER", [5, 5, 5, 5, 5]]]);
    const res = calculateAssessment(criteria, r, stats({ CUSTOMER: 5 }));
    const c = res.dimensions.find((d) => d.key === "CUSTOMER")!;
    expect(c.coverage).toBe(0.33);
    expect(c.score).toBeNull();
  });

  it("достоверность: один источник → LOW, источник ниже нормы ответов → не HIGH", () => {
    const r = ratings([["T1", "EMPLOYEE", [4, 4]]]);
    const res = calculateAssessment(criteria, r, stats({ EMPLOYEE: 2 }));
    const team = res.dimensions.find((d) => d.key === "TEAM")!;
    expect(team.score).toBe(75);
    expect(team.confidence).toBe("LOW");
    expect(res.limitations.join(" ")).toMatch(/2 из 5/);
  });

  it("игнорирует значения вне шкалы и выключенные источники", () => {
    const r = ratings([["C1", "CUSTOMER", [9, -1, 4]], ["C1", "OWNER", [1]], ["C2", "CUSTOMER", [4]]]);
    const s = stats({ CUSTOMER: 5 }).map((x) => (x.type === "OWNER" ? { ...x, enabled: false } : x));
    const res = calculateAssessment(criteria, r, s);
    const c1 = res.dimensions.find((d) => d.key === "CUSTOMER")!.criteria.find((c) => c.code === "C1")!;
    expect(c1.score).toBe(4);
    expect(c1.bySource.OWNER).toBeUndefined();
  });
});
