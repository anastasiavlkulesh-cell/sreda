/**
 * Пилот: матрица прав. Для каждой роли проверяется доступ к ключевым
 * операциям на реальных сервисах (а не только скрытие кнопок в интерфейсе).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/server/db/client";
import { createDemoOrganization } from "@/server/services/demo";
import { inviteMember, acceptInvitation, updateRolePermissions } from "@/server/services/organizations";
import { createDiagnostic, getDiagnosticDetail } from "@/server/services/diagnostics";
import { runDiagnosticAnalysis, listProblems } from "@/server/services/analysis";
import { listPlans, approvePlan } from "@/server/services/plans";
import { listTasks } from "@/server/services/tasks";
import { listEmployees, pulseResults, listPulseSurveys } from "@/server/services/team";
import { listMetrics, addMetric } from "@/server/services/metrics";
import { generatePdfReport } from "@/server/services/reports";
import { applyRetention } from "@/server/services/retention";
import type { OrgContext } from "@/server/context-core";
import type { RoleKey } from "@/domain/rbac";
import { newUser, ctxFor } from "./helpers";

const ROLES: RoleKey[] = ["OWNER", "NETWORK_MANAGER", "LOCATION_MANAGER", "MANAGER", "EMPLOYEE", "PLATFORM_EXPERT"];
const ctxs = {} as Record<RoleKey, OrgContext>;
let orgId = "";
let diagnosticId = "";

async function allowed(fn: () => Promise<unknown>) {
  try {
    await fn();
    return true;
  } catch (e) {
    if (e instanceof Error && /прав|собственник|руководител|предназначена|Недостаточно/.test(e.message)) return false;
    throw e;
  }
}

beforeAll(async () => {
  const owner = await newUser("perm");
  const org = await createDemoOrganization(owner.id);
  orgId = org.id;
  ctxs.OWNER = await ctxFor(owner.id, org.id);
  const loc = await prisma.location.findFirstOrThrow({ where: { organizationId: org.id } });
  for (const role of ROLES.filter((r) => r !== "OWNER")) {
    const u = await newUser(role.toLowerCase());
    const { token } = await inviteMember(ctxs.OWNER, { email: u.email, roleKey: role, locationIds: role === "LOCATION_MANAGER" ? [loc.id] : [] });
    await acceptInvitation(u, token);
    ctxs[role] = await ctxFor(u.id, org.id);
  }
  diagnosticId = (await prisma.diagnostic.findFirstOrThrow({ where: { organizationId: org.id, title: { contains: "текущая" } } })).id;
}, 120_000);

describe("Спринт 6: матрица прав по ролям", () => {
  const cases: [string, (c: OrgContext) => Promise<unknown>, RoleKey[]][] = [
    ["создание диагностики", (c) => createDiagnostic(c, { title: "x", sources: ["OWNER"], targets: {} }), ["OWNER", "NETWORK_MANAGER"]],
    ["просмотр результатов диагностики", (c) => getDiagnosticDetail(c, diagnosticId), ["OWNER", "NETWORK_MANAGER", "LOCATION_MANAGER", "PLATFORM_EXPERT"]],
    ["запуск AI-анализа", (c) => runDiagnosticAnalysis(c, diagnosticId), ["OWNER", "NETWORK_MANAGER"]],
    ["просмотр проблем", (c) => listProblems(c), ["OWNER", "NETWORK_MANAGER", "LOCATION_MANAGER", "PLATFORM_EXPERT"]],
    ["просмотр плана", (c) => listPlans(c), ["OWNER", "NETWORK_MANAGER", "LOCATION_MANAGER", "MANAGER", "PLATFORM_EXPERT"]],
    ["задачи", (c) => listTasks(c), ROLES],
    ["список сотрудников", (c) => listEmployees(c), ["OWNER", "NETWORK_MANAGER", "LOCATION_MANAGER", "MANAGER"]],
    ["бизнес-показатели: просмотр", (c) => listMetrics(c), ["OWNER", "NETWORK_MANAGER", "LOCATION_MANAGER", "PLATFORM_EXPERT"]],
    ["бизнес-показатели: ввод", (c) => addMetric(c, { key: "REVENUE", kind: "FORECAST", month: "2027-01", value: 1, locationId: c.locationScope?.[0] }), ["OWNER", "NETWORK_MANAGER", "LOCATION_MANAGER"]],
    ["PDF-отчёт", (c) => generatePdfReport(c, diagnosticId), ["OWNER", "NETWORK_MANAGER", "LOCATION_MANAGER", "PLATFORM_EXPERT"]],
  ];

  for (const [name, fn, expected] of cases) {
    it(name, async () => {
      const result: Partial<Record<RoleKey, boolean>> = {};
      for (const r of ROLES) result[r] = await allowed(() => fn(ctxs[r]));
      const granted = ROLES.filter((r) => result[r]);
      expect(granted.sort()).toEqual([...expected].sort());
    });
  }

  it("утвердить план может только собственник", async () => {
    const plan = await prisma.improvementPlan.findFirstOrThrow({ where: { organizationId: orgId } });
    await prisma.improvementPlan.update({ where: { id: plan.id }, data: { status: "PENDING_APPROVAL" } });
    for (const r of ROLES.filter((x) => x !== "OWNER")) await expect(approvePlan(ctxs[r], plan.id)).rejects.toThrow();
  });

  it("результаты анонимных опросов: только при праве аналитики, эксперт и менеджер — нет", async () => {
    const [p] = await listPulseSurveys(ctxs.OWNER);
    for (const r of ["MANAGER", "PLATFORM_EXPERT", "EMPLOYEE"] as RoleKey[]) {
      await expect(pulseResults(ctxs[r], p.id)).rejects.toThrow();
    }
    const res = await pulseResults(ctxs.LOCATION_MANAGER, p.id);
    expect(res.metrics.length).toBe(6);
  });

  it("эксперт: даже при ручной выдаче не получает права управления", async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: orgId, key: "PLATFORM_EXPERT" } });
    await updateRolePermissions(ctxs.OWNER, role.id, ["members.invite", "members.manage", "org.manage", "dashboard.view"]);
    const expert = await ctxFor(ctxs.PLATFORM_EXPERT.user.id, orgId);
    expect(expert.can("members.invite")).toBe(false);
    expect(expert.can("members.manage")).toBe(false);
    expect(expert.can("org.manage")).toBe(false);
    expect(expert.can("dashboard.view")).toBe(true);
  });

  it("истёкший доступ эксперта отключается автоматически", async () => {
    await prisma.organizationMembership.updateMany({
      where: { organizationId: orgId, userId: ctxs.PLATFORM_EXPERT.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const { loadOrgContext } = await import("@/server/context-core");
    const u = ctxs.PLATFORM_EXPERT.user;
    expect(await loadOrgContext(u, orgId)).toBeNull();
  });
});

describe("Спринт 6: политика хранения", () => {
  it("удаляет ответы анкет старше срока хранения компании, агрегаты остаются", async () => {
    const before = await prisma.surveyResponse.count({ where: { organizationId: orgId } });
    const assessments = await prisma.assessment.count({ where: { organizationId: orgId } });
    await prisma.organization.update({ where: { id: orgId }, data: { settings: { retentionMonths: 3 } } });
    await applyRetention();
    const after = await prisma.surveyResponse.count({ where: { organizationId: orgId } });
    expect(after).toBeLessThan(before);
    expect(await prisma.assessment.count({ where: { organizationId: orgId } })).toBe(assessments);
  });
});
