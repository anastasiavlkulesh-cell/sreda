import { describe, it, expect } from "vitest";
import {
  priorityScore, priorityCategory, severityFromScore, scaleFromSources, systemicFromCauses, validatePrioritySettings, DEFAULT_PRIORITY_SETTINGS,
} from "@/domain/priority";
import { effectivePermissions, canAssignRole, DEFAULT_ROLE_PERMISSIONS } from "@/domain/rbac";
import { aggregateGroups, protectAgainstDifferencing, disclosableComments, scrubPII } from "@/domain/anonymity";
import { metricDerivedScores, revenueChange, scoreRepeatShare } from "@/domain/metrics";

describe("приоритизация", () => {
  it("максимальные параметры → P1, минимальные → P4", () => {
    const max = priorityScore({ severity: 5, businessImpact: 5, urgency: 5, scale: 5, systemic: 5 });
    expect(max).toBe(5);
    expect(priorityCategory(max)).toBe("P1");
    expect(priorityCategory(priorityScore({ severity: 1, businessImpact: 1, urgency: 1, scale: 1, systemic: 1 }))).toBe("P4");
  });
  it("пороги настраиваются", () => {
    const s = { ...DEFAULT_PRIORITY_SETTINGS, thresholds: { P1: 4.5, P2: 4, P3: 3 } };
    expect(priorityCategory(4.2, s)).toBe("P2");
    expect(priorityCategory(4.2)).toBe("P1");
  });
  it("валидирует настройки", () => {
    expect(validatePrioritySettings(DEFAULT_PRIORITY_SETTINGS)).toEqual([]);
    expect(validatePrioritySettings({ ...DEFAULT_PRIORITY_SETTINGS, thresholds: { P1: 2, P2: 3, P3: 1 } }).length).toBeGreaterThan(0);
    expect(validatePrioritySettings({ ...DEFAULT_PRIORITY_SETTINGS, weights: { severity: 1, businessImpact: 1, urgency: 0, scale: 0, systemic: 0 } }).length).toBeGreaterThan(0);
  });
  it("шкалы параметров", () => {
    expect(severityFromScore(1.4)).toBe(5);
    expect(severityFromScore(3.5)).toBe(1);
    expect(scaleFromSources(3, 3)).toBe(5);
    expect(scaleFromSources(1, 1)).toBe(2);
    expect(systemicFromCauses(0)).toBe(1);
    expect(systemicFromCauses(4)).toBe(5);
  });
});

describe("RBAC", () => {
  const grant = (roleKey: keyof typeof DEFAULT_ROLE_PERMISSIONS, extra: Partial<Parameters<typeof effectivePermissions>[0]> = {}) => ({
    roleKey,
    rolePermissions: DEFAULT_ROLE_PERMISSIONS[roleKey],
    moduleScope: [],
    expiresAt: null,
    archivedAt: null,
    ...extra,
  });
  it("собственник имеет все права, сотрудник — только свои задачи", () => {
    expect(effectivePermissions(grant("OWNER")).has("plan.approve")).toBe(true);
    const emp = effectivePermissions(grant("EMPLOYEE"));
    expect([...emp]).toEqual(["tasks.work"]);
  });
  it("права только собственника нельзя выдать другим ролям даже вручную", () => {
    const p = effectivePermissions(grant("NETWORK_MANAGER", { rolePermissions: ["plan.approve", "roles.manage", "dashboard.view"] }));
    expect(p.has("plan.approve")).toBe(false);
    expect(p.has("roles.manage")).toBe(false);
    expect(p.has("dashboard.view")).toBe(true);
  });
  it("эксперт: срок доступа, ограничение модулями, запрещённые права", () => {
    const past = new Date(Date.now() - 1000);
    expect(effectivePermissions(grant("PLATFORM_EXPERT", { expiresAt: past })).size).toBe(0);
    const scoped = effectivePermissions(grant("PLATFORM_EXPERT", { moduleScope: ["diagnostics"] }));
    expect([...scoped]).toEqual(["diagnostics.view"]);
    const forced = effectivePermissions(grant("PLATFORM_EXPERT", { rolePermissions: ["members.manage", "org.manage"] }));
    expect(forced.size).toBe(0);
  });
  it("архивированный участник не имеет прав", () => {
    expect(effectivePermissions(grant("OWNER", { archivedAt: new Date() })).size).toBe(0);
  });
  it("назначение ролей только ниже своей", () => {
    expect(canAssignRole("OWNER", "OWNER")).toBe(true);
    expect(canAssignRole("NETWORK_MANAGER", "LOCATION_MANAGER")).toBe(true);
    expect(canAssignRole("NETWORK_MANAGER", "NETWORK_MANAGER")).toBe(false);
    expect(canAssignRole("NETWORK_MANAGER", "PLATFORM_EXPERT")).toBe(false);
    expect(canAssignRole("LOCATION_MANAGER", "OWNER")).toBe(false);
  });
});

describe("анонимность", () => {
  it("скрывает группы меньше K", () => {
    const res = aggregateGroups(new Map([["Кухня", [1, 2, 3]], ["Зал", [4, 4, 4, 4, 4]]]), 5);
    expect(res.find((r) => r.group === "Кухня")!.mean).toBeNull();
    expect(res.find((r) => r.group === "Зал")!.mean).toBe(4);
  });
  it("защищает от восстановления скрытой группы вычитанием", () => {
    const aggs = aggregateGroups(new Map([["A", [1, 1]], ["B", [4, 4, 4, 4, 4]], ["C", [3, 3, 3, 3, 3, 3]]]), 5);
    const safe = protectAgainstDifferencing(aggs, 5);
    expect(safe.filter((a) => a.hidden).length).toBe(2);
    expect(safe.find((a) => a.group === "B")!.hidden).toBe(true);
  });
  it("комментарии — только при группе ≥ K и без контактов", () => {
    expect(disclosableComments(["a", "b"], 3, 5)).toBeNull();
    const out = disclosableComments(["Пишите мне на ivan@mail.ru", "Звоните +7 912 345-67-89", "ок", "ок2", "ок3"], 7, 5)!;
    expect(out.join(" ")).not.toMatch(/ivan@mail\.ru|912/);
    expect(scrubPII("мой ник @ivan_petrov")).toBe("мой ник [ник скрыт]");
  });
});

describe("бизнес-показатели → оценки критериев", () => {
  const month = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
  it("динамика выручки год к году", () => {
    const pts = [];
    for (let m = 0; m < 15; m++) pts.push({ key: "REVENUE" as const, kind: "FACT" as const, periodStart: month(2025, m), value: m >= 12 ? 90 : 100 });
    const rc = revenueChange(pts)!;
    expect(rc.basis).toBe("yoy");
    expect(Math.round(rc.change * 100)).toBe(-10);
    expect(metricDerivedScores(pts).get("B1")!.score).toBe(2);
  });
  it("прогнозы и оценки не используются как факт", () => {
    const pts = [];
    for (let m = 0; m < 15; m++) pts.push({ key: "REVENUE" as const, kind: "FORECAST" as const, periodStart: month(2025, m), value: 100 });
    expect(revenueChange(pts)).toBeNull();
  });
  it("доля повторных продаж", () => {
    expect(scoreRepeatShare(55)).toBe(5);
    expect(scoreRepeatShare(22)).toBe(3);
  });
});
