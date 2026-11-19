import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createDemoOrganization } from "@/server/services/demo";
import { runDiagnosticAnalysis, listProblems, getProblem } from "@/server/services/analysis";
import { inviteMember, acceptInvitation } from "@/server/services/organizations";
import { newUser, ctxFor, newOwner } from "./helpers";

describe("Спринт 3: AI-аналитика", () => {
  it("демо-анализ: проблемы с причинами, приоритетами, статусами и журналом анализа", async () => {
    const u = await newUser("an");
    const org = await createDemoOrganization(u.id);
    const ctx = await ctxFor(u.id, org.id);
    const problems = await listProblems(ctx);
    expect(problems.length).toBeGreaterThan(3);
    expect(problems.some((p) => p.priority === "P1" || p.priority === "P2")).toBe(true);
    // Каждый вывод имеет статус, достоверность, источники и доказательства
    for (const p of problems) {
      expect(["CONFIRMED", "PARTIALLY_CONFIRMED", "HYPOTHESIS"]).toContain(p.findingStatus);
      expect(p.dataSources.length).toBeGreaterThan(0);
      expect(p.evidenceIds.length).toBeGreaterThan(0);
    }
    const speed = problems.find((p) => p.criterionCode === "C1")!;
    expect(speed).toBeDefined();
    const { problem, evidence } = await getProblem(ctx, speed.id);
    expect(problem.causes.length).toBeGreaterThan(0);
    expect(problem.recommendations[0].metricsUsed.length).toBeGreaterThan(0);
    expect(evidence.length).toBeGreaterThan(0);

    const analysis = await prisma.aIAnalysis.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(analysis.status).toBe("COMPLETED");
    expect(analysis.methodologyVersion).toBe("5D-1.0");
    expect(analysis.provider).toBe("rules");
    expect(JSON.stringify(analysis.inputSummary)).not.toMatch(/очередь|не хватает людей/); // тексты не сохраняются во входе
    const out = analysis.output as { contradictions: unknown[]; summary: string };
    expect(out.contradictions.length).toBeGreaterThan(0); // собственник переоценивает
  });

  it("повторный анализ заменяет открытые проблемы, а не дублирует их", async () => {
    const u = await newUser("an2");
    const org = await createDemoOrganization(u.id);
    const ctx = await ctxFor(u.id, org.id);
    const before = (await listProblems(ctx)).length;
    const d = await prisma.diagnostic.findFirstOrThrow({ where: { organizationId: org.id, title: { contains: "текущая" } } });
    await runDiagnosticAnalysis(ctx, d.id);
    const after = await listProblems(ctx);
    expect(after.length).toBe(before);
    expect(await prisma.aIAnalysis.count({ where: { organizationId: org.id } })).toBe(2);
  });

  it("права и изоляция: менеджер не запускает анализ; чужая проблема не открывается", async () => {
    const u = await newUser("an3");
    const org = await createDemoOrganization(u.id);
    const owner = await ctxFor(u.id, org.id);
    const m = await newUser("mgr3");
    const { token } = await inviteMember(owner, { email: m.email, roleKey: "MANAGER", locationIds: [] });
    await acceptInvitation(m, token);
    const mctx = await ctxFor(m.id, org.id);
    const d = await prisma.diagnostic.findFirstOrThrow({ where: { organizationId: org.id } });
    await expect(runDiagnosticAnalysis(mctx, d.id)).rejects.toThrow(/прав/);
    await expect(listProblems(mctx)).rejects.toThrow(/прав/);

    const other = await newOwner("x");
    const p = await prisma.problem.findFirstOrThrow({ where: { organizationId: org.id } });
    await expect(getProblem(other.ctx, p.id)).rejects.toThrow(/не найдена/);
  });
});
