import "server-only";
import type { OrgContext } from "../context-core";
import { assertLocationInScope } from "../context-core";
import { audit } from "../audit";
import { AppError, forbidden, notFound } from "../errors";
import { decrypt, encrypt, hashToken, newToken } from "../crypto";
import { aggregateGroups, protectAgainstDifferencing, disclosableComments, DEFAULT_MIN_GROUP_SIZE } from "@/domain/anonymity";
import { parseDimensions } from "./assessment";

export const PULSE_QUESTIONS: { metricKey: string; label: string; text: string }[] = [
  { metricKey: "engagement", label: "Вовлечённость", text: "Мне важен результат моей работы и успех компании." },
  { metricKey: "satisfaction", label: "Удовлетворённость", text: "В целом я доволен(на) работой в компании." },
  { metricKey: "leader", label: "Оценка руководителя", text: "Мой руководитель поддерживает меня и даёт полезную обратную связь." },
  { metricKey: "culture", label: "Корпоративная культура", text: "В команде принято помогать друг другу и открыто говорить о проблемах." },
  { metricKey: "workload", label: "Посильность нагрузки", text: "Моя нагрузка посильна, я не работаю постоянно на пределе." },
  { metricKey: "stay", label: "Намерение остаться", text: "Я планирую работать здесь и через год." },
];
const PULSE_OPEN = "Что бы вы изменили в работе команды в первую очередь?";

// ---------------------------------------------------------------------------
// Сотрудники
// ---------------------------------------------------------------------------

function scopeWhere(ctx: OrgContext) {
  return ctx.locationScope ? { OR: [{ locationId: { in: ctx.locationScope } }, { locationId: null }] } : {};
}

export async function listEmployees(ctx: OrgContext) {
  if (!ctx.can("team.view")) throw forbidden();
  const rows = await ctx.db.employee.findMany({
    where: { archivedAt: null, ...scopeWhere(ctx) },
    include: { location: { select: { name: true } }, department: { select: { name: true } } },
    orderBy: { fullName: "asc" },
  });
  // Контакты расшифровываются только для тех, кто управляет командой
  return rows.map((e) => ({
    ...e,
    contact: ctx.can("team.manage") && e.contactEnc ? safeDecrypt(e.contactEnc) : null,
    contactEnc: undefined,
  }));
}

function safeDecrypt(v: string) {
  try {
    return decrypt(v);
  } catch {
    return null;
  }
}

export async function saveEmployee(
  ctx: OrgContext,
  input: { id?: string; fullName: string; position: string; locationId?: string | null; departmentId?: string | null; contact?: string; hiredAt?: Date | null },
) {
  if (!ctx.can("team.manage")) throw forbidden();
  if (input.locationId) {
    if (!(await ctx.db.location.findFirst({ where: { id: input.locationId } }))) throw notFound("Точка не найдена");
    assertLocationInScope(ctx, input.locationId);
  } else if (ctx.locationScope) throw forbidden("Укажите свою точку");
  if (input.departmentId && !(await ctx.db.department.findFirst({ where: { id: input.departmentId } }))) throw notFound("Подразделение не найдено");
  const data = {
    fullName: input.fullName,
    position: input.position,
    locationId: input.locationId || null,
    departmentId: input.departmentId || null,
    hiredAt: input.hiredAt ?? null,
    ...(input.contact !== undefined ? { contactEnc: input.contact ? encrypt(input.contact) : null } : {}),
  };
  if (input.id) {
    const e = await ctx.db.employee.findFirst({ where: { id: input.id, ...scopeWhere(ctx) } });
    if (!e) throw notFound("Сотрудник не найден");
    await ctx.db.employee.update({ where: { id: e.id }, data });
    await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "employee.update", "Employee", e.id);
    return e;
  }
  const e = await ctx.db.employee.create({ data: { organizationId: ctx.org.id, ...data } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "employee.create", "Employee", e.id);
  return e;
}

export async function archiveEmployee(ctx: OrgContext, id: string) {
  if (!ctx.can("team.manage")) throw forbidden();
  const e = await ctx.db.employee.findFirst({ where: { id, ...scopeWhere(ctx) } });
  if (!e) throw notFound("Сотрудник не найден");
  // Персональные данные уволенного сотрудника очищаются (контакт), запись остаётся для истории
  await ctx.db.employee.update({ where: { id }, data: { archivedAt: new Date(), contactEnc: null } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "employee.archive", "Employee", id);
}

// ---------------------------------------------------------------------------
// Анонимные пульс-опросы
// ---------------------------------------------------------------------------

export async function createPulseSurvey(ctx: OrgContext, title: string) {
  if (!ctx.can("team.manage")) throw forbidden();
  const token = newToken(18);
  const s = await ctx.db.survey.create({
    data: {
      organizationId: ctx.org.id,
      kind: "TEAM_PULSE",
      sourceType: "EMPLOYEE",
      title,
      intro:
        "Опрос анонимный: имя, e-mail и точное время ответа не сохраняются. Результаты видны только обобщённо, по группам от 5 человек. Ответьте честно — это поможет сделать работу лучше.",
      status: "OPEN",
      isAnonymous: true,
      publicTokenHash: hashToken(token),
      publicTokenEnc: encrypt(token),
      questions: {
        create: [
          ...PULSE_QUESTIONS.map((q, i) => ({ type: "SCALE" as const, text: q.text, metricKey: q.metricKey, sortOrder: i, isRequired: true })),
          { type: "TEXT" as const, text: PULSE_OPEN, sortOrder: PULSE_QUESTIONS.length, isRequired: false },
        ],
      },
    },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "pulse.create", "Survey", s.id);
  return s;
}

export async function closePulseSurvey(ctx: OrgContext, id: string) {
  if (!ctx.can("team.manage")) throw forbidden();
  const s = await ctx.db.survey.findFirst({ where: { id, kind: "TEAM_PULSE" } });
  if (!s) throw notFound("Опрос не найден");
  await ctx.db.survey.update({ where: { id }, data: { status: "CLOSED" } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "pulse.close", "Survey", id);
}

export async function listPulseSurveys(ctx: OrgContext) {
  if (!ctx.can("team.view")) throw forbidden();
  const surveys = await ctx.db.survey.findMany({
    where: { kind: "TEAM_PULSE" },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { responses: true } } },
  });
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return surveys.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    createdAt: s.createdAt,
    responses: s._count.responses,
    link: ctx.can("team.manage") && s.status === "OPEN" && s.publicTokenEnc ? `${base}/s/${safeDecrypt(s.publicTokenEnc)}` : null,
  }));
}

export interface PulseMetricResult {
  metricKey: string;
  label: string;
  overall: number | null;
  groups: { group: string; n: number; mean: number | null; hidden: boolean }[];
}

/**
 * Результаты пульс-опроса — только агрегаты:
 * — общий результат показывается при n ≥ K;
 * — по подразделениям — при n ≥ K в подразделении, с защитой от вычитания;
 * — комментарии — при n ≥ K, без дат, в перемешанном порядке, без контактов.
 */
export async function pulseResults(ctx: OrgContext, surveyId: string) {
  if (!ctx.can("team.insights")) throw forbidden("Результаты опросов доступны руководителям с правом просмотра аналитики команды");
  const k = ctx.org.settings.anonymityMinGroup ?? DEFAULT_MIN_GROUP_SIZE;
  const survey = await ctx.db.survey.findFirst({
    where: { id: surveyId, kind: "TEAM_PULSE" },
    include: { questions: true, responses: { include: { answers: true } } },
  });
  if (!survey) throw notFound("Опрос не найден");
  const departments = await ctx.db.department.findMany({ select: { id: true, name: true } });
  const depName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "Не указано";
  const n = survey.responses.length;

  const metrics: PulseMetricResult[] = PULSE_QUESTIONS.map((pq) => {
    const q = survey.questions.find((x) => x.metricKey === pq.metricKey);
    const groups = new Map<string, number[]>();
    const all: number[] = [];
    for (const r of survey.responses) {
      const a = r.answers.find((x) => x.questionId === q?.id);
      if (a?.value == null) continue;
      all.push(a.value);
      const g = depName(r.departmentId);
      groups.set(g, [...(groups.get(g) ?? []), a.value]);
    }
    const overall = all.length >= k ? Math.round((all.reduce((x, y) => x + y, 0) / all.length) * 100) / 100 : null;
    return { metricKey: pq.metricKey, label: pq.label, overall, groups: protectAgainstDifferencing(aggregateGroups(groups, k), k) };
  });

  const openQ = survey.questions.find((q) => q.type === "TEXT");
  const comments = disclosableComments(
    survey.responses.flatMap((r) => r.answers.filter((a) => a.questionId === openQ?.id && a.text).map((a) => a.text!)),
    n,
    k,
    survey.id,
  );

  const val = (key: string) => metrics.find((m) => m.metricKey === key)?.overall ?? null;
  const risks: { key: string; level: "high" | "medium" | "low"; text: string }[] = [];
  const workload = val("workload");
  const stay = val("stay");
  if (workload !== null) risks.push(riskOf("overload", workload, "Риск перегрузки", "нагрузка оценивается как посильная"));
  if (stay !== null) risks.push(riskOf("attrition", stay, "Риск ухода сотрудников", "намерение остаться"));

  return { survey: { id: survey.id, title: survey.title, status: survey.status }, n, k, enough: n >= k, metrics, comments, risks };
}

function riskOf(key: string, mean: number, title: string, what: string) {
  const level: "high" | "medium" | "low" = mean <= 2.5 ? "high" : mean <= 3.3 ? "medium" : "low";
  const word = level === "high" ? "высокий" : level === "medium" ? "умеренный" : "низкий";
  return { key, level, text: `${title}: ${word} (средняя оценка «${what}» — ${mean.toFixed(1)} из 5).` };
}

export async function teamOverview(ctx: OrgContext) {
  if (!ctx.can("team.view")) throw forbidden();
  const [employees, byDept, assessment] = await Promise.all([
    ctx.db.employee.count({ where: { archivedAt: null, ...scopeWhere(ctx) } }),
    ctx.db.employee.groupBy({ by: ["departmentId"], where: { archivedAt: null, ...scopeWhere(ctx) }, _count: true }),
    ctx.db.assessment.findFirst({ where: { diagnostic: { status: "COMPLETED" } }, orderBy: { calculatedAt: "desc" } }),
  ]);
  const dims = assessment ? parseDimensions(assessment.dimensions) : [];
  return {
    employees,
    departments: byDept.length,
    team: dims.find((d) => d.key === "TEAM") ?? null,
    leadership: dims.find((d) => d.key === "LEADERSHIP") ?? null,
  };
}

export function assertPulseTitle(title: string) {
  if (title.trim().length < 3) throw new AppError("Укажите название опроса");
}
