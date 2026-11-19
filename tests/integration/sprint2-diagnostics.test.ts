import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { decrypt } from "@/server/crypto";
import {
  createDiagnostic, launchDiagnostic, getDiagnosticDetail, submitPublicResponse, submitInAppResponse, completeCollection,
  createSurveyInvites, addCustomCriterion, getPublicSurvey,
} from "@/server/services/diagnostics";
import { addMetric, importMetricsCsv } from "@/server/services/metrics";
import { inviteMember, acceptInvitation } from "@/server/services/organizations";
import { newOwner, newUser, ctxFor } from "./helpers";

async function tokenFor(surveyId: string) {
  const s = await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } });
  return decrypt(s.publicTokenEnc!);
}

async function fill(token: string, value: number, extra: { invite?: string; text?: string; departmentId?: string } = {}) {
  const { survey } = (await getPublicSurvey(token))!;
  const answers = survey.questions.map((q) => (q.type === "SCALE" ? { questionId: q.id, value } : { questionId: q.id, text: extra.text ?? "" }));
  await submitPublicResponse(token, { answers, inviteToken: extra.invite, departmentId: extra.departmentId });
}

describe("Спринт 2: диагностика SERVICE 5D", () => {
  it("полный цикл: создание → запуск → сбор ответов → расчёт SSI", async () => {
    const { ctx } = await newOwner();
    const d = await createDiagnostic(ctx, {
      title: "Тестовая диагностика",
      sources: ["OWNER", "EMPLOYEE", "CUSTOMER", "MYSTERY_SHOPPER", "MANAGER"],
      targets: { EMPLOYEE: 3, CUSTOMER: 3, MYSTERY_SHOPPER: 1, MANAGER: 1 },
    });
    expect(d.status).toBe("DRAFT");
    const surveys = await prisma.survey.findMany({ where: { diagnosticId: d.id }, include: { questions: true } });
    expect(surveys).toHaveLength(5);
    expect(surveys.find((s) => s.sourceType === "EMPLOYEE")!.isAnonymous).toBe(true);
    expect(surveys.find((s) => s.sourceType === "OWNER")!.questions.some((q) => q.type === "TEXT")).toBe(true);

    await launchDiagnostic(ctx, d.id);
    await expect(launchDiagnostic(ctx, d.id)).rejects.toThrow(/уже запущена/);
    const owner = surveys.find((s) => s.sourceType === "OWNER")!;
    expect(owner.publicTokenHash).toBeNull();

    const byType = (t: string) => surveys.find((s) => s.sourceType === t)!;
    const emp = await tokenFor(byType("EMPLOYEE").id);
    const cust = await tokenFor(byType("CUSTOMER").id);
    const mys = await tokenFor(byType("MYSTERY_SHOPPER").id);
    const mgr = await tokenFor(byType("MANAGER").id);
    for (let i = 0; i < 3; i++) await fill(emp, 2, { text: i === 0 ? "Пишите мне ivan@mail.ru" : "" });
    for (let i = 0; i < 3; i++) await fill(cust, 4);
    await fill(mys, 3);
    await fill(mgr, 4);

    const ownerQ = await prisma.surveyQuestion.findMany({ where: { surveyId: owner.id } });
    await submitInAppResponse(ctx, owner.id, ownerQ.filter((q) => q.type === "SCALE").map((q) => ({ questionId: q.id, value: 5 })));
    await expect(
      submitInAppResponse(ctx, owner.id, ownerQ.filter((q) => q.type === "SCALE").map((q) => ({ questionId: q.id, value: 5 }))),
    ).rejects.toThrow(/уже заполнили/);

    const detail = await getDiagnosticDetail(ctx, d.id);
    expect(detail.sources.find((s) => s.type === "EMPLOYEE")!.responses).toBe(3);
    expect(detail.sources.find((s) => s.type === "EMPLOYEE")!.link).toContain("/s/");
    expect(detail.completeness).toBe(1);

    const { result } = await completeCollection(ctx, d.id);
    expect(result.ssi).not.toBeNull();
    const team = result.dimensions.find((x) => x.key === "TEAM")!;
    // Сотрудники ставят 2, руководитель 4, собственник 5 → TEAM между 25 и 100
    expect(team.score!).toBeGreaterThan(25);
    expect(team.score!).toBeLessThan(100);
    const t1 = team.criteria.find((c) => c.code === "T1")!;
    expect(t1.bySource.EMPLOYEE!.mean).toBe(2);
    expect(t1.spread).toBe(3);

    // Анонимность: ответы сотрудников не связаны с пользователем и округлены до суток
    const empResponses = await prisma.surveyResponse.findMany({ where: { surveyId: byType("EMPLOYEE").id } });
    expect(empResponses.every((r) => r.respondentUserId === null)).toBe(true);
    expect(empResponses.every((r) => r.submittedAt.getUTCHours() === 0 && r.submittedAt.getUTCMinutes() === 0)).toBe(true);

    // После завершения анкеты закрыты
    await expect(fill(emp, 3)).rejects.toThrow(/завершён/);
    const d2 = await prisma.diagnostic.findUniqueOrThrow({ where: { id: d.id } });
    expect(d2.status).toBe("COMPLETED");
  });

  it("обязательные вопросы и диапазон шкалы проверяются на сервере", async () => {
    const { ctx } = await newOwner();
    const d = await createDiagnostic(ctx, { title: "Проверка", sources: ["EMPLOYEE"], targets: {} });
    await launchDiagnostic(ctx, d.id);
    const s = await prisma.survey.findFirstOrThrow({ where: { diagnosticId: d.id }, include: { questions: true } });
    const token = await tokenFor(s.id);
    await expect(submitPublicResponse(token, { answers: [] })).rejects.toThrow(/обязательные/);
    const scale = s.questions.filter((q) => q.type === "SCALE");
    await expect(
      submitPublicResponse(token, { answers: scale.map((q) => ({ questionId: q.id, value: 7 })) }),
    ).rejects.toThrow(/от 1 до 5/);
  });

  it("индивидуальная ссылка работает один раз и не связывается с ответом", async () => {
    const { ctx } = await newOwner();
    const d = await createDiagnostic(ctx, { title: "Ссылки", sources: ["EMPLOYEE"], targets: {} });
    await launchDiagnostic(ctx, d.id);
    const s = await prisma.survey.findFirstOrThrow({ where: { diagnosticId: d.id } });
    const [invite] = await createSurveyInvites(ctx, s.id, 1);
    const token = await tokenFor(s.id);
    await fill(token, 4, { invite });
    await expect(fill(token, 4, { invite })).rejects.toThrow(/уже использована/);
    const inv = await prisma.surveyInvite.findFirstOrThrow({ where: { surveyId: s.id } });
    expect(inv.usedAt).not.toBeNull();
    // У ответа нет ссылки на приглашение
    const resp = await prisma.surveyResponse.findFirstOrThrow({ where: { surveyId: s.id } });
    expect(Object.keys(resp)).not.toContain("inviteId");
  });

  it("недостаток данных: SSI не рассчитывается и перечисляются ограничения", async () => {
    const { ctx } = await newOwner();
    const d = await createDiagnostic(ctx, { title: "Мало данных", sources: ["OWNER", "CUSTOMER"], targets: { CUSTOMER: 10 } });
    await launchDiagnostic(ctx, d.id);
    const cust = await prisma.survey.findFirstOrThrow({ where: { diagnosticId: d.id, sourceType: "CUSTOMER" } });
    await fill(await tokenFor(cust.id), 4);
    const { result } = await completeCollection(ctx, d.id);
    expect(result.ssi).toBeNull();
    expect(result.dimensions.find((x) => x.key === "TEAM")!.score).toBeNull();
    expect(result.limitations.join(" ")).toMatch(/1 из 10/);
    const a = await prisma.assessment.findFirstOrThrow({ where: { diagnosticId: d.id } });
    expect(a.ssi).toBeNull();
    expect(a.confidence).toBe("INSUFFICIENT");
  });

  it("бизнес-показатели: факт влияет на B1, прогноз — нет; импорт CSV с ошибками по строкам", async () => {
    const { ctx } = await newOwner();
    const csv = [
      "месяц;показатель;значение;тип",
      ...Array.from({ length: 15 }, (_, i) => {
        const dt = new Date(Date.UTC(2025, i, 1));
        return `${dt.toISOString().slice(0, 7)};Выручка;${i >= 12 ? "1 200 000" : "1000000"};факт`;
      }),
      "2026-05;Неизвестно;5;факт",
      "2026-05;Средний чек;abc;факт",
      "2026-07;Выручка;5000000;прогноз",
    ].join("\n");
    const res = await importMetricsCsv(ctx, csv);
    expect(res.imported).toBe(16);
    expect(res.errors).toHaveLength(2);
    // Повторный ввод того же месяца обновляет, а не дублирует
    const again = await addMetric(ctx, { key: "REVENUE", kind: "FACT", month: "2026-03", value: 1_250_000 });
    expect(again.updated).toBe(true);

    const d = await createDiagnostic(ctx, { title: "С метриками", sources: ["OWNER", "BUSINESS_METRICS"], targets: {} });
    await launchDiagnostic(ctx, d.id);
    const { result } = await completeCollection(ctx, d.id);
    const b1 = result.dimensions.find((x) => x.key === "BUSINESS_RESULTS")!.criteria.find((c) => c.code === "B1")!;
    expect(b1.bySource.BUSINESS_METRICS!.mean).toBe(5); // +20%+ год к году
  });

  it("индивидуальный критерий компании попадает в анкету собственника и не виден другой компании", async () => {
    const a = await newOwner("a");
    const b = await newOwner("b");
    await addCustomCriterion(a.ctx, { dimension: "STANDARDS", title: "Предзаказы", description: "Предзаказы выдаются вовремя.", weight: 2 });
    const da = await createDiagnostic(a.ctx, { title: "A", sources: ["OWNER"], targets: {} });
    const db = await createDiagnostic(b.ctx, { title: "B", sources: ["OWNER"], targets: {} });
    const qa = await prisma.surveyQuestion.count({ where: { survey: { diagnosticId: da.id }, text: "Предзаказы выдаются вовремя." } });
    const qb = await prisma.surveyQuestion.count({ where: { survey: { diagnosticId: db.id }, text: "Предзаказы выдаются вовремя." } });
    expect(qa).toBe(1);
    expect(qb).toBe(0);
  });

  it("права: менеджер заполняет анкету руководителя, но не управляет диагностикой; чужую диагностику не видно", async () => {
    const { org, ctx } = await newOwner();
    const u = await newUser("mgr");
    const { token } = await inviteMember(ctx, { email: u.email, roleKey: "MANAGER", locationIds: [] });
    await acceptInvitation(u, token);
    const m = await ctxFor(u.id, org.id);
    await expect(createDiagnostic(m, { title: "x", sources: ["OWNER"], targets: {} })).rejects.toThrow(/прав/);
    const d = await createDiagnostic(ctx, { title: "Руководители", sources: ["MANAGER"], targets: {} });
    await launchDiagnostic(ctx, d.id);
    const s = await prisma.survey.findFirstOrThrow({ where: { diagnosticId: d.id }, include: { questions: true } });
    await submitInAppResponse(m, s.id, s.questions.filter((q) => q.type === "SCALE").map((q) => ({ questionId: q.id, value: 3 })));
    // собственник не может заполнить анкету руководителя
    await expect(submitInAppResponse(ctx, s.id, [])).rejects.toThrow(/другой роли/);

    const other = await newOwner("other");
    await expect(getDiagnosticDetail(other.ctx, d.id)).rejects.toThrow(/не найдена/);
  });
});
