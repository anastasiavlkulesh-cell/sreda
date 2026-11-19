import "server-only";
import { tenantDb, type TenantDb } from "../db/tenant";
import { createOrganization } from "./organizations";
import { buildQuestions, loadCriteria, type CriterionRow } from "./methodology";
import { calculateAndStoreAssessment } from "./assessment";
import { METHODOLOGY_VERSION, DEFAULT_TARGET_RESPONSES } from "@/domain/methodology/v1";
import type { SourceType } from "@/domain/types";
import type { MetricKey } from "@/domain/metrics";

/**
 * Демо-компания. Все данные синтетические, компания помечена isDemo и в
 * интерфейсе отмечается значком «Демо». Данные создаются через те же
 * сервисы и расчёты, что и для реальных компаний: ответы анкет → расчёт
 * SERVICE 5D → анализ → план → задачи. Ничего не «рисуется» вручную.
 */

export const DEMO_NAME = "Демо: сеть кофеен «Зерно и пар»";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    s = Math.imul(s ^ (s >>> 13), 3266489909) >>> 0;
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
}

/** Целевые средние по критериям для каждого источника (профиль демо-компании). */
const PROFILE_NOW: Record<string, Partial<Record<SourceType, number>>> = {
  C1: { CUSTOMER: 2.6, MYSTERY_SHOPPER: 2.5, OWNER: 4, MANAGER: 3.5 },
  C2: { CUSTOMER: 3.4, MYSTERY_SHOPPER: 3, OWNER: 4.5, MANAGER: 4 },
  C3: { CUSTOMER: 4.1, MYSTERY_SHOPPER: 4, OWNER: 4.5, MANAGER: 4 },
  C4: { CUSTOMER: 2.7, OWNER: 4, MANAGER: 3, EMPLOYEE: 2.4 },
  C5: { CUSTOMER: 3.2, MYSTERY_SHOPPER: 3, OWNER: 4 },
  C6: { CUSTOMER: 4, MYSTERY_SHOPPER: 3.5, OWNER: 4, MANAGER: 4 },
  T1: { EMPLOYEE: 3, MANAGER: 3.5, OWNER: 4 },
  T2: { EMPLOYEE: 2.8, MANAGER: 3.5 },
  T3: { EMPLOYEE: 3.6, MANAGER: 4 },
  T4: { EMPLOYEE: 2.1, MANAGER: 2.5, OWNER: 3.5 },
  T5: { EMPLOYEE: 2.9, MANAGER: 3.5 },
  L1: { EMPLOYEE: 2.3, MANAGER: 4, OWNER: 4 },
  L2: { EMPLOYEE: 2.7, MANAGER: 3.5, OWNER: 3.5 },
  L3: { EMPLOYEE: 3, MANAGER: 4 },
  L4: { EMPLOYEE: 2.6, MANAGER: 3 },
  L5: { EMPLOYEE: 3.3, OWNER: 4 },
  S1: { OWNER: 2, MANAGER: 2.5 },
  S2: { EMPLOYEE: 2.6, MANAGER: 3, OWNER: 3.5 },
  S3: { EMPLOYEE: 3, MYSTERY_SHOPPER: 2.5, OWNER: 3.5, MANAGER: 3 },
  S4: { EMPLOYEE: 2.4, MANAGER: 3, OWNER: 3 },
  S5: { OWNER: 2.5, MANAGER: 2, EMPLOYEE: 2.4 },
  B1: { OWNER: 3, MANAGER: 3 },
  B2: { OWNER: 3, MANAGER: 3 },
  B3: { OWNER: 3.5, MANAGER: 3 },
  B4: { OWNER: 2, MANAGER: 2.5 },
  B5: { OWNER: 3, MANAGER: 2.5 },
};

/** Профиль три месяца назад — немного хуже по ряду критериев (для динамики). */
function profileBefore(code: string, src: SourceType): number | undefined {
  const v = PROFILE_NOW[code]?.[src];
  if (v === undefined) return undefined;
  const delta = ["C1", "C6", "S5", "T4"].includes(code) ? -0.3 : code.startsWith("L") ? -0.2 : 0.1;
  return Math.max(1, Math.min(5, v + delta));
}

const TEXTS: Partial<Record<SourceType, string[]>> = {
  CUSTOMER: [
    "Долго ждала заказ утром, очередь почти не двигалась.",
    "Кофе отличный, но в час пик обслуживают очень медленно.",
    "Бариста приветливый, всё понравилось.",
    "Перепутали заказ, пришлось ждать замену, никто не извинился.",
    "Хотелось бы быстрее на кассе, особенно до 9 утра.",
    "Вкусно и уютно, буду приходить ещё.",
    "Жалобу на холодный сэндвич выслушали, но ничего не предложили.",
  ],
  EMPLOYEE: [
    "Утром в смене не хватает людей, работаем на пределе.",
    "Нет понятных правил, что делать при жалобе клиента.",
    "Обратную связь получаем только когда что-то пошло не так.",
    "Новичков учим на ходу, стандартов на бумаге нет.",
    "График составляют без учёта потока гостей.",
    "Команда хорошая, помогаем друг другу.",
  ],
  MYSTERY_SHOPPER: [
    "Время ожидания напитка 9 минут при нормативе сети 5 минут; приветствие было, выяснения предпочтений не было.",
    "Зал чистый, витрина заполнена; при оплате не предложили карту лояльности.",
  ],
  OWNER: ["Выручка перестала расти, хотя гостей вроде бы не меньше."],
  MANAGER: ["Не хватает людей в утренние смены, сложно удерживать стандарты."],
};

const EMPLOYEES = [
  ["Анна Соколова", "Старший бариста"], ["Илья Петров", "Бариста"], ["Мария Кузнецова", "Бариста"],
  ["Дмитрий Орлов", "Бариста"], ["Екатерина Лебедева", "Кассир"], ["Артём Волков", "Повар"],
  ["Ольга Николаева", "Повар"], ["Сергей Морозов", "Бариста"], ["Виктория Белова", "Администратор зала"],
  ["Павел Зайцев", "Бариста"], ["Наталья Ковалёва", "Кассир"], ["Роман Фёдоров", "Повар"],
  ["Алина Смирнова", "Бариста"], ["Кирилл Андреев", "Бариста"],
];

const N_RESPONSES: Record<SourceType, number> = {
  OWNER: 1, MANAGER: 2, EMPLOYEE: 12, CUSTOMER: 36, MYSTERY_SHOPPER: 2, BUSINESS_METRICS: 0,
};

async function createDiagnosticWithResponses(
  db: TenantDb,
  orgId: string,
  userId: string,
  criteria: CriterionRow[],
  opts: { title: string; startedAt: Date; completedAt: Date; profile: (code: string, s: SourceType) => number | undefined; seed: number; locationId: string },
) {
  const random = rng(opts.seed);
  const sources: SourceType[] = ["OWNER", "MANAGER", "EMPLOYEE", "CUSTOMER", "MYSTERY_SHOPPER", "BUSINESS_METRICS"];
  const diagnostic = await db.diagnostic.create({
    data: {
      organizationId: orgId,
      title: opts.title,
      status: "COMPLETED",
      methodologyVersion: METHODOLOGY_VERSION,
      startedAt: opts.startedAt,
      completedAt: opts.completedAt,
      createdById: userId,
      createdAt: opts.startedAt,
      sources: {
        create: sources.map((type) => ({ type, isEnabled: true, targetResponses: DEFAULT_TARGET_RESPONSES[type] })),
      },
    },
  });

  for (const source of sources.filter((s) => s !== "BUSINESS_METRICS")) {
    const questions = buildQuestions(criteria, source);
    const survey = await db.survey.create({
      data: {
        organizationId: orgId,
        diagnosticId: diagnostic.id,
        sourceType: source,
        title: `Анкета: ${source}`,
        status: "CLOSED",
        isAnonymous: source === "EMPLOYEE" || source === "CUSTOMER",
        questions: { create: questions },
      },
      include: { questions: true },
    });
    const texts = TEXTS[source] ?? [];
    for (let i = 0; i < N_RESPONSES[source]; i++) {
      const answers = survey.questions.flatMap((q): { questionId: string; value?: number; text?: string }[] => {
        if (q.type === "SCALE") {
          const code = criteria.find((c) => c.id === q.criterionId)?.code;
          const target = code ? opts.profile(code, source) : undefined;
          if (target === undefined) return [];
          const noise = (random() + random() - 1) * 1.3;
          return [{ questionId: q.id, value: Math.max(1, Math.min(5, Math.round(target + noise))) }];
        }
        const pick = texts[(i + q.sortOrder) % Math.max(texts.length, 1)];
        return pick && random() < 0.6 ? [{ questionId: q.id, text: pick }] : [];
      });
      const submittedAt = new Date(opts.startedAt.getTime() + random() * (opts.completedAt.getTime() - opts.startedAt.getTime()));
      await db.surveyResponse.create({
        data: {
          organizationId: orgId,
          surveyId: survey.id,
          respondentUserId: source === "OWNER" ? userId : null,
          respondentLabel:
            source === "MYSTERY_SHOPPER" ? `Визит тайного покупателя №${i + 1}` : source === "MANAGER" ? `Управляющий №${i + 1}` : null,
          locationId: source === "EMPLOYEE" || source === "CUSTOMER" ? null : opts.locationId,
          submittedAt,
          answers: { create: answers },
        },
      });
    }
  }
  const { assessment } = await calculateAndStoreAssessment(db, orgId, diagnostic.id);
  await db.assessment.update({ where: { id: assessment.id }, data: { calculatedAt: opts.completedAt } });
  return diagnostic;
}

function monthStart(offset: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

async function createMetrics(db: TenantDb, orgId: string, userId: string) {
  const random = rng(42);
  const rows: { key: MetricKey; kind: "FACT" | "ESTIMATE" | "FORECAST"; offset: number; value: number }[] = [];
  for (let m = -15; m <= -1; m++) {
    const season = 1 + 0.08 * Math.sin(((m + 15) / 12) * Math.PI * 2);
    const trend = m > -5 ? 0.93 : 1; // последние месяцы — снижение
    const revenue = Math.round(2_350_000 * season * trend * (0.97 + random() * 0.06));
    const check = Math.round(415 * (0.98 + random() * 0.04));
    rows.push({ key: "REVENUE", kind: "FACT", offset: m, value: revenue });
    rows.push({ key: "AVERAGE_CHECK", kind: "FACT", offset: m, value: check });
    rows.push({ key: "CUSTOMERS", kind: "FACT", offset: m, value: Math.round(revenue / check / 1.9) });
    rows.push({ key: "REPEAT_SALES", kind: "FACT", offset: m, value: Math.round((m > -5 ? 22 : 27) + random() * 3) });
    rows.push({ key: "ERROR_COST", kind: "FACT", offset: m, value: Math.round(62_000 + random() * 18_000) });
    rows.push({ key: "MARGIN", kind: "FACT", offset: m, value: Math.round(18 + random() * 3) });
  }
  rows.push({ key: "LTV", kind: "ESTIMATE", offset: -1, value: 9_800 });
  rows.push({ key: "CAC", kind: "ESTIMATE", offset: -1, value: 640 });
  for (let m = 0; m <= 2; m++) rows.push({ key: "REVENUE", kind: "FORECAST", offset: m, value: 2_250_000 });

  await db.businessMetric.createMany({
    data: rows.map((r) => ({
      organizationId: orgId,
      key: r.key,
      kind: r.kind,
      source: "MANUAL" as const,
      periodStart: monthStart(r.offset),
      periodEnd: new Date(monthStart(r.offset + 1).getTime() - 1),
      value: r.value,
      note: "Демо",
      createdById: userId,
    })),
  });
}

export async function createDemoOrganization(userId: string) {
  const org = await createOrganization(userId, {
    name: DEMO_NAME,
    industry: "horeca",
    locationName: "Кофейня на Садовой",
    city: "Казань",
    isDemo: true,
  });
  const db = tenantDb(org.id);
  const loc1 = (await db.location.findFirst({}))!;
  const loc2 = await db.location.create({ data: { organizationId: org.id, name: "Кофейня у парка", city: "Казань" } });
  const deps = await Promise.all(
    ["Бариста", "Кухня", "Зал и касса"].map((name) =>
      db.department.create({ data: { organizationId: org.id, name } }),
    ),
  );
  await db.employee.createMany({
    data: EMPLOYEES.map(([fullName, position], i) => ({
      organizationId: org.id,
      fullName,
      position,
      locationId: i % 2 === 0 ? loc1.id : loc2.id,
      departmentId: position.includes("Повар") ? deps[1].id : position.includes("Бариста") ? deps[0].id : deps[2].id,
      hiredAt: new Date(Date.UTC(2023 + (i % 3), (i * 5) % 12, 1)),
    })),
  });
  await createMetrics(db, org.id, userId);

  const criteria = await loadCriteria(org.id);
  const day = 86400_000;
  const now = Date.now();
  await createDiagnosticWithResponses(db, org.id, userId, criteria, {
    title: "Диагностика SERVICE 5D — весна",
    startedAt: new Date(now - 110 * day),
    completedAt: new Date(now - 95 * day),
    profile: profileBefore,
    seed: 7,
    locationId: loc1.id,
  });
  await createDiagnosticWithResponses(db, org.id, userId, criteria, {
    title: "Диагностика SERVICE 5D — текущая",
    startedAt: new Date(now - 20 * day),
    completedAt: new Date(now - 6 * day),
    profile: (c, s) => PROFILE_NOW[c]?.[s],
    seed: 11,
    locationId: loc1.id,
  });

  return org;
}
