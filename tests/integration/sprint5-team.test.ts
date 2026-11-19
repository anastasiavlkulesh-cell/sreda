import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import { createDemoOrganization } from "@/server/services/demo";
import { pulseResults, listEmployees, saveEmployee, archiveEmployee, createPulseSurvey, listPulseSurveys } from "@/server/services/team";
import { generatePdfReport } from "@/server/services/reports";
import { storage } from "@/server/storage";
import { listNotifications, markRead, unreadCount } from "@/server/services/notifications";
import { inviteMember, acceptInvitation } from "@/server/services/organizations";
import { getPublicSurvey, submitPublicResponse } from "@/server/services/diagnostics";
import { decrypt } from "@/server/crypto";
import { newUser, ctxFor, newOwner } from "./helpers";

describe("Спринт 5: команда, анонимность, отчёты, уведомления", () => {
  it("пульс-опрос: только агрегаты, малые группы скрыты, комментарии обезличены, риски рассчитаны", async () => {
    const u = await newUser("t5");
    const org = await createDemoOrganization(u.id);
    const ctx = await ctxFor(u.id, org.id);
    const [pulse] = await listPulseSurveys(ctx);
    const res = await pulseResults(ctx, pulse.id);
    expect(res.n).toBe(14);
    expect(res.enough).toBe(true);
    const workload = res.metrics.find((m) => m.metricKey === "workload")!;
    expect(workload.overall).not.toBeNull();
    const barista = workload.groups.find((g) => g.group === "Бариста")!;
    const kitchen = workload.groups.find((g) => g.group === "Кухня")!;
    expect(barista.hidden).toBe(false);
    expect(kitchen.hidden).toBe(true);
    expect(kitchen.mean).toBeNull();
    expect(res.risks.find((r) => r.key === "overload")!.level).toBe("high");
    expect(res.comments!.length).toBeGreaterThan(0);
    // В результатах нет идентификаторов ответов
    expect(JSON.stringify(res)).not.toMatch(/responseId|respondentUserId/);
  });

  it("при малом числе ответов результаты скрыты полностью; управляющий без права аналитики их не видит", async () => {
    const { org, ctx } = await newOwner("t5b");
    const s = await createPulseSurvey(ctx, "Малый опрос");
    const token = decrypt((await prisma.survey.findUniqueOrThrow({ where: { id: s.id } })).publicTokenEnc!);
    const { survey } = (await getPublicSurvey(token))!;
    for (let i = 0; i < 3; i++) {
      await submitPublicResponse(token, { answers: survey.questions.filter((q) => q.type === "SCALE").map((q) => ({ questionId: q.id, value: 2 })) });
    }
    const res = await pulseResults(ctx, s.id);
    expect(res.enough).toBe(false);
    expect(res.metrics.every((m) => m.overall === null)).toBe(true);
    expect(res.comments).toBeNull();

    const m = await newUser("mgr5");
    const { token: inv } = await inviteMember(ctx, { email: m.email, roleKey: "MANAGER", locationIds: [] });
    await acceptInvitation(m, inv);
    const mctx = await ctxFor(m.id, org.id);
    await expect(pulseResults(mctx, s.id)).rejects.toThrow(/руководителям/);
  });

  it("сотрудники: контакт шифруется, при архивировании удаляется", async () => {
    const { ctx } = await newOwner("t5c");
    const e = await saveEmployee(ctx, { fullName: "Иван Иванов", position: "Бариста", contact: "+7 900 000-00-00" });
    const raw = await prisma.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(raw.contactEnc).not.toContain("900");
    expect((await listEmployees(ctx))[0].contact).toBe("+7 900 000-00-00");
    await archiveEmployee(ctx, e.id);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: e.id } })).contactEnc).toBeNull();
  });

  it("PDF-отчёт формируется, сохраняется в хранилище и помечен как демо", async () => {
    const u = await newUser("t5d");
    const org = await createDemoOrganization(u.id);
    const ctx = await ctxFor(u.id, org.id);
    const d = await prisma.diagnostic.findFirstOrThrow({ where: { organizationId: org.id, title: { contains: "текущая" } } });
    const { file, size } = await generatePdfReport(ctx, d.id);
    expect(size).toBeGreaterThan(5000);
    const buf = await storage().get(file.storageKey);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(file.storageKey.startsWith(org.id)).toBe(true);
  });

  it("уведомления: создаются по событиям, читаются и отмечаются", async () => {
    const u = await newUser("t5e");
    const org = await createDemoOrganization(u.id);
    const items = await listNotifications(u.id, org.id);
    expect(items.length).toBeGreaterThan(0);
    expect(await unreadCount(u.id, org.id)).toBeGreaterThan(0);
    await markRead(u.id, org.id);
    expect(await unreadCount(u.id, org.id)).toBe(0);
  });
});
