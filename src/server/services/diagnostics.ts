import "server-only";
import { prisma } from "../db/client";
import type { OrgContext } from "../context-core";
import { assertLocationInScope } from "../context-core";
import { audit } from "../audit";
import { AppError, forbidden, notFound } from "../errors";
import { decrypt, encrypt, hashToken, newToken } from "../crypto";
import { buildQuestions, loadCriteria, ensureMethodology } from "./methodology";
import { calculateAndStoreAssessment } from "./assessment";
import { DEFAULT_TARGET_RESPONSES, METHODOLOGY_VERSION, SOURCE_LABELS, ANONYMOUS_SOURCES, DIMENSIONS } from "@/domain/methodology/v1";
import type { DimensionKey, SourceType } from "@/domain/types";
import { diagnosticScopeWhere } from "./dashboard";

const SURVEY_SOURCES: SourceType[] = ["OWNER", "MANAGER", "EMPLOYEE", "CUSTOMER", "MYSTERY_SHOPPER"];
/** Источники, для которых создаётся публичная ссылка (респондент может не иметь учётной записи). */
const LINK_SOURCES: SourceType[] = ["MANAGER", "EMPLOYEE", "CUSTOMER", "MYSTERY_SHOPPER"];

export const SURVEY_TITLES: Record<SourceType, string> = {
  OWNER: "Анкета собственника",
  MANAGER: "Анкета руководителя",
  EMPLOYEE: "Анонимный опрос сотрудников",
  CUSTOMER: "Опрос клиентов",
  MYSTERY_SHOPPER: "Отчёт тайного покупателя",
  BUSINESS_METRICS: "Бизнес-показатели",
};

const SURVEY_INTROS: Partial<Record<SourceType, string>> = {
  EMPLOYEE:
    "Опрос анонимный: ответы не связываются с вашим именем, руководители видят только обобщённые результаты по группам от 5 человек. Оцените, насколько каждое утверждение соответствует действительности.",
  CUSTOMER: "Спасибо, что помогаете нам стать лучше! Опрос анонимный и займёт около двух минут.",
  MYSTERY_SHOPPER: "Заполните отчёт сразу после визита. Оценивайте по факту наблюдений.",
  MANAGER: "Оцените текущее состояние дел честно — это основа для плана улучшений, а не проверка вашей работы.",
  OWNER: "Оцените текущее состояние бизнеса. Система сравнит вашу оценку с мнением команды и клиентов.",
};

export async function listDiagnostics(ctx: OrgContext) {
  return ctx.db.diagnostic.findMany({
    where: { archivedAt: null, ...diagnosticScopeWhere(ctx) },
    orderBy: { createdAt: "desc" },
    include: {
      location: true,
      assessments: { orderBy: { calculatedAt: "desc" }, take: 1 },
      _count: { select: { surveys: true } },
    },
  });
}

export async function createDiagnostic(
  ctx: OrgContext,
  input: { title: string; locationId?: string | null; sources: SourceType[]; targets: Partial<Record<SourceType, number>> },
) {
  if (!ctx.can("diagnostics.manage")) throw forbidden();
  if (input.locationId) {
    const loc = await ctx.db.location.findFirst({ where: { id: input.locationId, archivedAt: null } });
    if (!loc) throw notFound("Точка не найдена");
    assertLocationInScope(ctx, input.locationId);
  } else if (ctx.locationScope) throw forbidden("Вы можете запускать диагностику только по своим точкам");
  if (input.sources.length === 0) throw new AppError("Выберите хотя бы один источник данных");

  const sub = await prisma.subscription.findUnique({ where: { organizationId: ctx.org.id } });
  const allowed = new Set(sub?.enabledSources ?? []);
  const notAllowed = input.sources.filter((s) => !allowed.has(s));
  if (notAllowed.length) throw new AppError(`Источник не подключён в тарифе: ${notAllowed.map((s) => SOURCE_LABELS[s]).join(", ")}`);

  await ensureMethodology();
  const criteria = await loadCriteria(ctx.org.id);
  const diagnostic = await ctx.db.diagnostic.create({
    data: {
      organizationId: ctx.org.id,
      title: input.title,
      locationId: input.locationId || null,
      methodologyVersion: METHODOLOGY_VERSION,
      createdById: ctx.user.id,
      sources: {
        create: input.sources.map((type) => ({
          type,
          isEnabled: true,
          targetResponses: Math.max(1, input.targets[type] ?? DEFAULT_TARGET_RESPONSES[type]),
        })),
      },
    },
  });
  for (const source of input.sources.filter((s) => SURVEY_SOURCES.includes(s))) {
    await ctx.db.survey.create({
      data: {
        organizationId: ctx.org.id,
        diagnosticId: diagnostic.id,
        sourceType: source,
        title: SURVEY_TITLES[source],
        intro: SURVEY_INTROS[source] ?? null,
        isAnonymous: ANONYMOUS_SOURCES.includes(source),
        questions: { create: buildQuestions(criteria, source) },
      },
    });
  }
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "diagnostic.create", "Diagnostic", diagnostic.id, { sources: input.sources });
  return diagnostic;
}

async function getOwnedDiagnostic(ctx: OrgContext, id: string) {
  const d = await ctx.db.diagnostic.findFirst({ where: { id, archivedAt: null }, include: { sources: true } });
  if (!d) throw notFound("Диагностика не найдена");
  if (d.locationId) assertLocationInScope(ctx, d.locationId);
  else if (ctx.locationScope && !ctx.can("diagnostics.view")) throw forbidden();
  return d;
}

export async function launchDiagnostic(ctx: OrgContext, id: string) {
  if (!ctx.can("diagnostics.manage")) throw forbidden();
  const d = await getOwnedDiagnostic(ctx, id);
  if (d.status !== "DRAFT") throw new AppError("Диагностика уже запущена");
  const surveys = await ctx.db.survey.findMany({ where: { diagnosticId: id } });
  for (const s of surveys) {
    const data: { status: "OPEN"; publicTokenHash?: string; publicTokenEnc?: string } = { status: "OPEN" };
    if (LINK_SOURCES.includes(s.sourceType as SourceType)) {
      const token = newToken(18);
      data.publicTokenHash = hashToken(token);
      data.publicTokenEnc = encrypt(token);
    }
    await ctx.db.survey.update({ where: { id: s.id }, data });
  }
  await ctx.db.diagnostic.update({ where: { id }, data: { status: "COLLECTING", startedAt: new Date() } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "diagnostic.launch", "Diagnostic", id);
}

/** Индивидуальные одноразовые ссылки. Токены возвращаются один раз и в открытом виде не хранятся. */
export async function createSurveyInvites(ctx: OrgContext, surveyId: string, count: number) {
  if (!ctx.can("diagnostics.manage")) throw forbidden();
  if (count < 1 || count > 200) throw new AppError("Можно создать от 1 до 200 ссылок за раз");
  const survey = await ctx.db.survey.findFirst({ where: { id: surveyId, status: "OPEN" } });
  if (!survey) throw notFound("Анкета не найдена или закрыта");
  if (!LINK_SOURCES.includes(survey.sourceType as SourceType)) throw new AppError("Для этой анкеты ссылки не создаются");
  const tokens = Array.from({ length: count }, () => newToken(18));
  await ctx.db.surveyInvite.createMany({
    data: tokens.map((t) => ({ organizationId: ctx.org.id, surveyId, tokenHash: hashToken(t) })),
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "survey.invites_create", "Survey", surveyId, { count });
  return tokens;
}

export async function getDiagnosticDetail(ctx: OrgContext, id: string) {
  if (!ctx.can("diagnostics.view") && !ctx.can("diagnostics.manage")) throw forbidden();
  const d = await getOwnedDiagnostic(ctx, id);
  const surveys = await ctx.db.survey.findMany({
    where: { diagnosticId: id },
    include: {
      _count: { select: { responses: true, questions: true } },
      invites: { select: { usedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const myResponses = await ctx.db.surveyResponse.findMany({
    where: { surveyId: { in: surveys.map((s) => s.id) }, respondentUserId: ctx.user.id },
    select: { surveyId: true },
  });
  const assessment = await ctx.db.assessment.findFirst({ where: { diagnosticId: id }, orderBy: { calculatedAt: "desc" } });
  const metricsCount = await ctx.db.businessMetric.count({ where: { kind: "FACT" } });
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const canSeeLinks = ctx.can("diagnostics.manage");

  const sources = d.sources.map((src) => {
    const s = surveys.find((x) => x.sourceType === src.type);
    const responses = src.type === "BUSINESS_METRICS" ? (metricsCount > 0 ? 1 : 0) : (s?._count.responses ?? 0);
    let link: string | null = null;
    if (canSeeLinks && s?.publicTokenEnc && s.status === "OPEN") {
      try {
        link = `${base}/s/${decrypt(s.publicTokenEnc)}`;
      } catch {
        link = null;
      }
    }
    return {
      type: src.type as SourceType,
      target: src.targetResponses,
      responses,
      complete: responses >= src.targetResponses,
      survey: s
        ? {
            id: s.id,
            title: s.title,
            status: s.status,
            isAnonymous: s.isAnonymous,
            questions: s._count.questions,
            invites: s.invites.length,
            invitesUsed: s.invites.filter((i) => i.usedAt).length,
            answeredByMe: myResponses.some((r) => r.surveyId === s.id),
          }
        : null,
      link,
    };
  });
  const completeness = sources.length ? sources.filter((s) => s.complete).length / sources.length : 0;
  return { diagnostic: d, sources, completeness, assessment, metricsCount };
}

/** Завершение сбора и расчёт SERVICE 5D. Можно пересчитать повторно — создаётся новый снимок. */
export async function completeCollection(ctx: OrgContext, id: string) {
  if (!ctx.can("diagnostics.manage")) throw forbidden();
  const d = await getOwnedDiagnostic(ctx, id);
  if (d.status === "DRAFT") throw new AppError("Сначала запустите сбор данных");
  await ctx.db.survey.updateMany({ where: { diagnosticId: id, status: "OPEN" }, data: { status: "CLOSED" } });
  const res = await calculateAndStoreAssessment(ctx.db, ctx.org.id, id);
  await ctx.db.diagnostic.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "diagnostic.complete", "Diagnostic", id, {
    ssi: res.result.ssi,
    confidence: res.result.confidence,
  });
  return res;
}

/** Предварительный расчёт без закрытия сбора. */
export async function recalculate(ctx: OrgContext, id: string) {
  if (!ctx.can("diagnostics.manage")) throw forbidden();
  await getOwnedDiagnostic(ctx, id);
  return calculateAndStoreAssessment(ctx.db, ctx.org.id, id);
}

export async function reopenCollection(ctx: OrgContext, id: string) {
  if (!ctx.can("diagnostics.manage")) throw forbidden();
  const d = await getOwnedDiagnostic(ctx, id);
  if (d.status !== "COMPLETED") throw new AppError("Возобновить можно только завершённую диагностику");
  await ctx.db.survey.updateMany({ where: { diagnosticId: id, status: "CLOSED" }, data: { status: "OPEN" } });
  await ctx.db.diagnostic.update({ where: { id }, data: { status: "COLLECTING", completedAt: null } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "diagnostic.reopen", "Diagnostic", id);
}

export async function archiveDiagnostic(ctx: OrgContext, id: string) {
  if (!ctx.can("diagnostics.manage")) throw forbidden();
  await getOwnedDiagnostic(ctx, id);
  await ctx.db.diagnostic.update({ where: { id }, data: { archivedAt: new Date(), status: "ARCHIVED" } });
  await ctx.db.survey.updateMany({ where: { diagnosticId: id }, data: { status: "CLOSED" } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "diagnostic.archive", "Diagnostic", id);
}

// ---------------------------------------------------------------------------
// Ответы
// ---------------------------------------------------------------------------

export interface AnswerInput {
  questionId: string;
  value?: number | null;
  text?: string | null;
}

type SurveyWithQuestions = { id: string; questions: { id: string; type: string; isRequired: boolean }[] };

export function validateAnswers(survey: SurveyWithQuestions, answers: AnswerInput[]): AnswerInput[] {
  const byId = new Map(survey.questions.map((q) => [q.id, q]));
  const clean: AnswerInput[] = [];
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) continue;
    if (q.type === "SCALE") {
      if (a.value === null || a.value === undefined) continue;
      if (!Number.isInteger(a.value) || a.value < 1 || a.value > 5) throw new AppError("Оценка должна быть от 1 до 5");
      clean.push({ questionId: q.id, value: a.value });
    } else {
      const t = (a.text ?? "").trim().slice(0, 2000);
      if (t) clean.push({ questionId: q.id, text: t });
    }
  }
  const missing = survey.questions.filter((q) => q.isRequired && !clean.some((a) => a.questionId === q.id));
  if (missing.length) throw new AppError(`Ответьте на все обязательные вопросы (осталось: ${missing.length})`);
  return clean;
}

export async function getPublicSurvey(token: string) {
  const survey = await prisma.survey.findUnique({
    where: { publicTokenHash: hashToken(token) },
    include: {
      questions: { orderBy: { sortOrder: "asc" }, include: { criterion: { include: { dimension: true } } } },
      organization: { select: { name: true, isDemo: true, archivedAt: true } },
      diagnostic: { select: { status: true, locationId: true } },
    },
  });
  if (!survey || survey.organization.archivedAt) return null;
  const departments = survey.isAnonymous
    ? await prisma.department.findMany({ where: { organizationId: survey.organizationId, archivedAt: null }, select: { id: true, name: true } })
    : [];
  return { survey, departments };
}

export async function submitPublicResponse(
  token: string,
  input: { answers: AnswerInput[]; inviteToken?: string; respondentLabel?: string; departmentId?: string },
) {
  const found = await getPublicSurvey(token);
  if (!found) throw notFound("Анкета не найдена");
  const { survey } = found;
  if (survey.status !== "OPEN") throw new AppError("Сбор ответов по этой анкете завершён");
  const answers = validateAnswers(survey, input.answers);

  let departmentId: string | null = null;
  if (survey.isAnonymous && input.departmentId) {
    const dep = await prisma.department.findFirst({ where: { id: input.departmentId, organizationId: survey.organizationId } });
    departmentId = dep?.id ?? null;
  }

  await prisma.$transaction(async (tx) => {
    if (input.inviteToken) {
      // Индивидуальная ссылка: используется один раз; ответ с ней НЕ связывается.
      const used = await tx.surveyInvite.updateMany({
        where: { tokenHash: hashToken(input.inviteToken), surveyId: survey.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count === 0) throw new AppError("Индивидуальная ссылка уже использована или недействительна");
    }
    await tx.surveyResponse.create({
      data: {
        organizationId: survey.organizationId,
        surveyId: survey.id,
        respondentUserId: null,
        respondentLabel: survey.isAnonymous ? null : (input.respondentLabel?.trim().slice(0, 120) || null),
        departmentId,
        // Для анонимных анкет время ответа округляется до суток, чтобы его нельзя было сопоставить со сменой.
        submittedAt: survey.isAnonymous ? startOfDay(new Date()) : new Date(),
        answers: { create: answers.map((a) => ({ questionId: a.questionId, value: a.value ?? null, text: a.text ?? null })) },
      },
    });
  });
}

function startOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Заполнение анкеты внутри системы (собственник, руководитель). Один ответ на пользователя. */
export async function submitInAppResponse(ctx: OrgContext, surveyId: string, answers: AnswerInput[]) {
  const survey = await ctx.db.survey.findFirst({ where: { id: surveyId }, include: { questions: true } });
  if (!survey) throw notFound("Анкета не найдена");
  const role = ctx.membership.roleKey;
  const allowed =
    (survey.sourceType === "OWNER" && role === "OWNER") ||
    (survey.sourceType === "MANAGER" && ctx.can("diagnostics.respond") && role !== "OWNER");
  if (!allowed) throw forbidden("Эта анкета предназначена для другой роли");
  if (survey.status !== "OPEN") throw new AppError("Сбор ответов завершён");
  const clean = validateAnswers(survey, answers);
  const existing = await ctx.db.surveyResponse.findFirst({ where: { surveyId, respondentUserId: ctx.user.id } });
  if (existing) throw new AppError("Вы уже заполнили эту анкету");
  await ctx.db.surveyResponse.create({
    data: {
      organizationId: ctx.org.id,
      surveyId,
      respondentUserId: ctx.user.id,
      respondentLabel: ctx.membership.roleName,
      locationId: ctx.locationScope?.[0] ?? null,
      answers: { create: clean.map((a) => ({ questionId: a.questionId, value: a.value ?? null, text: a.text ?? null })) },
    },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "survey.respond", "Survey", surveyId);
}

export async function getInAppSurvey(ctx: OrgContext, surveyId: string) {
  const survey = await ctx.db.survey.findFirst({
    where: { id: surveyId },
    include: { questions: { orderBy: { sortOrder: "asc" }, include: { criterion: { include: { dimension: true } } } }, diagnostic: true },
  });
  if (!survey) throw notFound("Анкета не найдена");
  return survey;
}

/** Анкеты, которые текущий пользователь может заполнить внутри системы. */
export async function pendingSurveysForUser(ctx: OrgContext) {
  const role = ctx.membership.roleKey;
  const sources: SourceType[] = role === "OWNER" ? ["OWNER"] : ctx.can("diagnostics.respond") ? ["MANAGER"] : [];
  if (!sources.length) return [];
  const surveys = await ctx.db.survey.findMany({
    where: { status: "OPEN", sourceType: { in: sources }, kind: "DIAGNOSTIC", diagnostic: { archivedAt: null, ...diagnosticScopeWhere(ctx) } },
    include: { diagnostic: { select: { title: true } }, responses: { where: { respondentUserId: ctx.user.id }, select: { id: true } } },
  });
  return surveys.filter((s) => s.responses.length === 0);
}

// ---------------------------------------------------------------------------
// Индивидуальные критерии компании
// ---------------------------------------------------------------------------

export async function addCustomCriterion(
  ctx: OrgContext,
  input: { dimension: DimensionKey; title: string; description: string; weight: number },
) {
  if (!ctx.can("diagnostics.manage")) throw forbidden();
  await ensureMethodology();
  const dim = await prisma.serviceDimension.findUniqueOrThrow({
    where: { key_methodologyVersion: { key: input.dimension, methodologyVersion: METHODOLOGY_VERSION } },
  });
  const count = await prisma.assessmentCriterion.count({ where: { organizationId: ctx.org.id, dimensionId: dim.id } });
  const code = `${input.dimension[0]}X${count + 1}`;
  const c = await prisma.assessmentCriterion.create({
    data: {
      organizationId: ctx.org.id,
      dimensionId: dim.id,
      code,
      title: input.title,
      description: input.description,
      scope: "CUSTOM",
      weight: input.weight,
    },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "criterion.custom_add", "AssessmentCriterion", c.id, { code });
  return c;
}

export async function toggleCustomCriterion(ctx: OrgContext, id: string, isActive: boolean) {
  if (!ctx.can("diagnostics.manage")) throw forbidden();
  const c = await prisma.assessmentCriterion.findFirst({ where: { id, organizationId: ctx.org.id } });
  if (!c) throw notFound("Критерий не найден");
  await prisma.assessmentCriterion.update({ where: { id }, data: { isActive } });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "criterion.custom_toggle", "AssessmentCriterion", id, { isActive });
}

export const dimensionName = (k: DimensionKey) => DIMENSIONS.find((d) => d.key === k)!.shortName;
