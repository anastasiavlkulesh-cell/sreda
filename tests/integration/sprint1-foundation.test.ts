import { describe, it, expect } from "vitest";
import { prisma } from "@/server/db/client";
import {
  inviteMember, acceptInvitation, changeMemberRole, deactivateMember, updateRolePermissions, createLocation, archiveLocation, registerUser,
} from "@/server/services/organizations";
import { createDemoOrganization } from "@/server/services/demo";
import { getDashboard } from "@/server/services/dashboard";
import { verifyPassword } from "@/server/auth/password";
import { scopeArgs } from "@/server/db/tenant";
import { newOwner, ctxFor, newUser } from "./helpers";

describe("Спринт 1: регистрация, компания, роли", () => {
  it("регистрация хранит только хэш пароля argon2id и не допускает дубликатов", async () => {
    const u = await registerUser({ name: "Анна", email: `anna.${Date.now()}@test.local`, password: "Password12345" });
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(u.passwordHash, "Password12345")).toBe(true);
    expect(await verifyPassword(u.passwordHash, "wrong")).toBe(false);
    await expect(registerUser({ name: "Анна", email: u.email, password: "Password12345" })).rejects.toThrow(/уже зарегистрирован/);
  });

  it("создание компании: 6 системных ролей, собственник, точка, подписка, аудит", async () => {
    const { org, ctx } = await newOwner();
    const roles = await prisma.role.findMany({ where: { organizationId: org.id } });
    expect(roles.map((r) => r.key).sort()).toEqual(["EMPLOYEE", "LOCATION_MANAGER", "MANAGER", "NETWORK_MANAGER", "OWNER", "PLATFORM_EXPERT"]);
    expect(ctx.membership.roleKey).toBe("OWNER");
    expect(ctx.can("plan.approve")).toBe(true);
    expect(await prisma.location.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await prisma.subscription.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: org.id, action: "org.create" } })).toBe(1);
  });

  it("приглашение: только на e-mail адресата, однократно, с ролью и областью", async () => {
    const { org, ctx } = await newOwner();
    const loc = await createLocation(ctx, { name: "Вторая точка" });
    const invited = await newUser("manager");
    const { token } = await inviteMember(ctx, { email: invited.email, roleKey: "LOCATION_MANAGER", locationIds: [loc.id] });

    const stranger = await newUser("stranger");
    await expect(acceptInvitation(stranger, token)).rejects.toThrow(/другой e-mail/);

    await acceptInvitation(invited, token);
    const mctx = await ctxFor(invited.id, org.id);
    expect(mctx.membership.roleKey).toBe("LOCATION_MANAGER");
    expect(mctx.locationScope).toEqual([loc.id]);
    expect(mctx.can("members.manage")).toBe(false);
    await expect(acceptInvitation(invited, token)).rejects.toThrow(/недействительно/);
  });

  it("назначение ролей: нельзя выдать роль выше своей и изменить свою роль", async () => {
    const { org, ctx } = await newOwner();
    const netUser = await newUser("net");
    const { token } = await inviteMember(ctx, { email: netUser.email, roleKey: "NETWORK_MANAGER", locationIds: [] });
    await acceptInvitation(netUser, token);
    const net = await ctxFor(netUser.id, org.id);

    await expect(inviteMember(net, { email: "x@test.local", roleKey: "OWNER", locationIds: [] })).rejects.toThrow(/не можете назначить/);
    await expect(inviteMember(net, { email: "x@test.local", roleKey: "PLATFORM_EXPERT", locationIds: [] })).rejects.toThrow(/не можете назначить/);
    // У руководителя сети нет права members.manage
    const ownerMembership = await prisma.organizationMembership.findFirstOrThrow({ where: { organizationId: org.id, userId: ctx.user.id } });
    await expect(changeMemberRole(net, { membershipId: ownerMembership.id, roleKey: "EMPLOYEE", locationIds: [] })).rejects.toThrow(/прав/);
    await expect(changeMemberRole(ctx, { membershipId: ownerMembership.id, roleKey: "EMPLOYEE", locationIds: [] })).rejects.toThrow(/собственную роль/);
  });

  it("отключение пользователя мгновенно лишает его доступа; последний собственник защищён", async () => {
    const { org, ctx } = await newOwner();
    const u = await newUser("emp");
    const { token } = await inviteMember(ctx, { email: u.email, roleKey: "EMPLOYEE", locationIds: [] });
    await acceptInvitation(u, token);
    const m = await prisma.organizationMembership.findFirstOrThrow({ where: { organizationId: org.id, userId: u.id } });
    await deactivateMember(ctx, m.id);
    expect(await ctxFor(u.id, org.id)).toBeNull();
    const own = await prisma.organizationMembership.findFirstOrThrow({ where: { organizationId: org.id, userId: ctx.user.id } });
    await expect(deactivateMember(ctx, own.id)).rejects.toThrow(/самого себя/);
  });

  it("настройка прав роли: нельзя выдать права собственника и изменить роль собственника", async () => {
    const { org, ctx } = await newOwner();
    const mgr = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, key: "MANAGER" } });
    await updateRolePermissions(ctx, mgr.id, ["tasks.work", "plan.approve", "unknown.perm"]);
    expect((await prisma.role.findUniqueOrThrow({ where: { id: mgr.id } })).permissions).toEqual(["tasks.work"]);
    const owner = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, key: "OWNER" } });
    await expect(updateRolePermissions(ctx, owner.id, [])).rejects.toThrow(/не настраиваются/);
  });

  it("единственную точку нельзя архивировать", async () => {
    const { org, ctx } = await newOwner();
    const loc = await prisma.location.findFirstOrThrow({ where: { organizationId: org.id } });
    await expect(archiveLocation(ctx, loc.id)).rejects.toThrow(/единственную/);
  });
});

describe("Спринт 1: изоляция компаний", () => {
  it("tenantDb не возвращает и не изменяет записи другой компании по id", async () => {
    const a = await newOwner("a");
    const b = await newOwner("b");
    const locB = await prisma.location.findFirstOrThrow({ where: { organizationId: b.org.id } });

    expect(await a.ctx.db.location.findFirst({ where: { id: locB.id } })).toBeNull();
    expect(await a.ctx.db.location.findUnique({ where: { id: locB.id } })).toBeNull();
    await expect(a.ctx.db.location.update({ where: { id: locB.id }, data: { name: "взлом" } })).rejects.toThrow();
    const res = await a.ctx.db.location.updateMany({ where: { id: locB.id }, data: { name: "взлом" } });
    expect(res.count).toBe(0);
    const del = await a.ctx.db.location.deleteMany({ where: {} });
    expect(del.count).toBeGreaterThanOrEqual(0);
    expect(await prisma.location.count({ where: { organizationId: b.org.id } })).toBe(1);
    expect((await prisma.location.findUniqueOrThrow({ where: { id: locB.id } })).name).not.toBe("взлом");
  });

  it("запись в чужую компанию через подмену organizationId отклоняется", async () => {
    const a = await newOwner("a");
    const b = await newOwner("b");
    await expect(a.ctx.db.location.create({ data: { organizationId: b.org.id, name: "чужая" } })).rejects.toThrow(/чужую компанию/);
    expect(() => scopeArgs("orgA", "Task", "update", { where: { id: "1" }, data: { organizationId: "orgB" } })).toThrow();
  });

  it("scopeArgs добавляет organizationId во все операции tenant-моделей", () => {
    expect(scopeArgs("o1", "Problem", "findMany", {}).where).toEqual({ organizationId: "o1" });
    expect(scopeArgs("o1", "Problem", "count", { where: { status: "OPEN" } }).where).toEqual({ status: "OPEN", organizationId: "o1" });
    expect((scopeArgs("o1", "Task", "createMany", { data: [{ title: "x" }] }).data as object[])[0]).toMatchObject({ organizationId: "o1" });
    expect(scopeArgs("o1", "User", "findMany", {}).where).toBeUndefined();
  });
});

describe("Спринт 1: демо-компания и главная панель", () => {
  it("создаёт демо-компанию с расчётом SERVICE 5D из реальных ответов анкет", async () => {
    const u = await newUser("demo");
    const org = await createDemoOrganization(u.id);
    expect(org.isDemo).toBe(true);
    const ctx = await ctxFor(u.id, org.id);
    const d = await getDashboard(ctx);
    expect(d.latest).not.toBeNull();
    expect(d.latest!.ssi).not.toBeNull();
    expect(d.latest!.ssi!).toBeGreaterThan(20);
    expect(d.latest!.ssi!).toBeLessThan(80);
    expect(d.dimensions).toHaveLength(5);
    expect(d.dimensions.every((x) => x.score !== null)).toBe(true);
    expect(d.history.length).toBe(2);
    expect(d.metrics.revenue).not.toBeNull();
    // Метрики дают оценку B1 через источник «бизнес-показатели»
    const br = d.dimensions.find((x) => x.key === "BUSINESS_RESULTS")!;
    expect(br.criteria.find((c) => c.code === "B1")!.bySource.BUSINESS_METRICS).toBeDefined();
    const responses = await prisma.surveyResponse.count({ where: { organizationId: org.id } });
    expect(responses).toBeGreaterThan(100);
    // Анонимные ответы сотрудников не связаны с пользователями
    const empLinked = await prisma.surveyResponse.count({
      where: { organizationId: org.id, survey: { sourceType: "EMPLOYEE" }, respondentUserId: { not: null } },
    });
    expect(empLinked).toBe(0);
  });
});
