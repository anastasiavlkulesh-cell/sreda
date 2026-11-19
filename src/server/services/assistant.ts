import "server-only";
import { z } from "zod";
import type { OrgContext } from "../context-core";
import { forbidden, AppError } from "../errors";
import { audit } from "../audit";
import { getAIProvider, tryComplete } from "../ai/provider";
import { parseDimensions } from "./assessment";
import { METHODOLOGY_VERSION, DIMENSIONS } from "@/domain/methodology/v1";
import { FINDING_LABELS, type DimensionKey } from "@/domain/types";
import { revenueChange, type MetricKey } from "@/domain/metrics";
import { TASK_OUTCOME_LABELS } from "@/lib/labels";

/**
 * AI-помощник СРЕДА: единый интерфейс вопросов. В MVP — единый координатор,
 * который определяет намерение и вызывает специализированную функцию
 * (Service Auditor, Customer Analyst, Performance Analyst, Team Analyst,
 * Training Creator, Business Advisor). Ответ собирается только из данных
 * компании; внешний провайдер (при согласии) может переформулировать
 * текст, но получает только этот же набор фактов.
 */
export const SUGGESTED_QUESTIONS = [
  "Какие проблемы самые критичные?",
  "Что исправить в первую очередь?",
  "Почему снизилась возвращаемость?",
  "Что мешает росту выручки?",
  "Кого нужно обучить?",
  "Какие стандарты нарушаются?",
  "Какой результат дали предыдущие изменения?",
];

type Role = "Service Auditor" | "Customer Analyst" | "Performance Analyst" | "Team Analyst" | "Training Creator" | "Business Advisor";

const INTENTS: { key: string; role: Role; pattern: RegExp }[] = [
  { key: "results", role: "Performance Analyst", pattern: /(результат|эффект|что дал|изменени.*дал|сработал)/i },
  { key: "return", role: "Customer Analyst", pattern: /(возвращ|повторн|вернул|уходят клиент|лояльн)/i },
  { key: "revenue", role: "Business Advisor", pattern: /(выручк|доход|продаж|рост)/i },
  { key: "training", role: "Training Creator", pattern: /(обуч|научить|тренинг|развити)/i },
  { key: "standards", role: "Service Auditor", pattern: /(стандарт|регламент|нарушают|нарушен)/i },
  { key: "team", role: "Team Analyst", pattern: /(команд|сотрудник|выгоран|увольн|перегруз)/i },
  { key: "critical", role: "Service Auditor", pattern: /(критичн|в первую очередь|приоритет|исправить|главн|проблем)/i },
];

export interface AssistantAnswer {
  role: Role;
  intent: string;
  text: string;
  facts: string[];
  sources: string[];
  limitations: string[];
}

export async function askAssistant(ctx: OrgContext, question: string): Promise<AssistantAnswer> {
  if (!ctx.can("assistant.use")) throw forbidden();
  const q = question.trim();
  if (q.length < 3) throw new AppError("Сформулируйте вопрос");
  if (q.length > 500) throw new AppError("Вопрос слишком длинный (до 500 символов)");
  const intent = INTENTS.find((i) => i.pattern.test(q)) ?? { key: "overview", role: "Business Advisor" as Role };

  const assessment = await ctx.db.assessment.findFirst({ where: { diagnostic: { status: "COMPLETED", archivedAt: null } }, orderBy: { calculatedAt: "desc" } });
  const dims = assessment ? parseDimensions(assessment.dimensions) : [];
  const allProblems = ctx.can("problems.view")
    ? await ctx.db.problem.findMany({
        where: { status: { in: ["OPEN", "IN_PLAN", "MONITORING"] } },
        orderBy: [{ priority: "asc" }, { priorityScore: "desc" }],
        include: { causes: true, recommendations: { take: 1, orderBy: { createdAt: "desc" } }, diagnostic: { select: { createdAt: true } } },
      })
    : [];
  // Одна проблема на критерий — из самой свежей диагностики
  const latestByCode = new Map<string, (typeof allProblems)[number]>();
  for (const p of allProblems) {
    const key = p.criterionCode ?? p.id;
    const cur = latestByCode.get(key);
    if (!cur || p.diagnostic.createdAt > cur.diagnostic.createdAt) latestByCode.set(key, p);
  }
  const problems = allProblems.filter((p) => latestByCode.get(p.criterionCode ?? p.id) === p);
  const facts: string[] = [];
  const sources = new Set<string>();
  const limitations: string[] = [];
  if (!assessment) limitations.push("Завершённых диагностик нет — ответ ограничен.");
  if (!ctx.can("problems.view")) limitations.push("Ваша роль не даёт доступа к проблемам и причинам — ответ построен только на доступных данных.");

  const describe = (p: (typeof problems)[number]) => {
    sources.add("AI-анализ диагностики");
    const causes = p.causes.filter((c) => c.findingStatus !== "HYPOTHESIS").map((c) => c.title.replace(/\.$/, "").toLowerCase());
    return `${p.priority} · ${p.title} (${FINDING_LABELS[p.findingStatus].toLowerCase()})${causes.length ? `; причины: ${causes.join("; ")}` : ""}${p.recommendations[0] ? `. Рекомендация: ${p.recommendations[0].title}` : ""}`;
  };
  const byCodes = (codes: string[]) => problems.filter((p) => p.criterionCode && codes.includes(p.criterionCode));
  const byDim = (d: DimensionKey) => problems.filter((p) => p.dimension === d);

  let text = "";
  switch (intent.key) {
    case "critical": {
      const top = problems.filter((p) => p.priority === "P1" || p.priority === "P2").slice(0, 5);
      facts.push(...top.map(describe));
      text = top.length
        ? `Самые критичные проблемы — ${top.length}. Начинать стоит с тех, у которых высокий приоритет и подтверждённые причины; при равном приоритете — с более реализуемых (реализуемость оценивается отдельно).`
        : "Проблем с приоритетом P1–P2 не выявлено.";
      break;
    }
    case "return": {
      const rel = byCodes(["C5", "B2", "C4", "C2", "C1"]);
      facts.push(...rel.slice(0, 4).map(describe));
      const metrics = await ctx.db.businessMetric.findMany({ where: { key: "REPEAT_SALES", kind: "FACT" }, orderBy: { periodStart: "asc" } });
      if (metrics.length >= 2) {
        const first = metrics.slice(0, 3), last = metrics.slice(-3);
        const avg = (xs: typeof metrics) => xs.reduce((a, m) => a + m.value, 0) / xs.length;
        facts.push(`Доля повторных продаж (факт): ${avg(first).toFixed(0)}% в начале периода → ${avg(last).toFixed(0)}% за последние месяцы.`);
        sources.add("Бизнес-показатели");
      }
      text = rel.length
        ? "Возвращаемость связана прежде всего с клиентским опытом: ниже — подтверждённые данными проблемы, которые к ней ведут. Учитывайте, что снижение может объясняться и внешними факторами (цены, конкуренты, сезонность)."
        : "Проблем, связанных с возвращаемостью клиентов, анализ не выявил.";
      break;
    }
    case "revenue": {
      const rel = byCodes(["B1", "B2", "B3", "C5", "C3"]);
      facts.push(...rel.slice(0, 4).map(describe));
      const metrics = await ctx.db.businessMetric.findMany({ where: { kind: "FACT" } });
      const rc = revenueChange(metrics.map((m) => ({ key: m.key as MetricKey, kind: m.kind, periodStart: m.periodStart, value: m.value })));
      if (rc) {
        facts.push(`Выручка за 3 последних месяца: ${rc.change >= 0 ? "+" : ""}${(rc.change * 100).toFixed(1)}% ${rc.basis === "yoy" ? "к прошлому году" : "к предыдущим 3 месяцам"} (факт).`);
        sources.add("Бизнес-показатели");
      }
      text = "Рост выручки сдерживают факторы ниже. Важно: изменение выручки не приписывается только качеству сервиса — сначала разложите её на трафик, средний чек и частоту и проверьте сезонность, цены и конкурентов.";
      limitations.push("Причинно-следственная связь сервиса и выручки не доказана — это сопоставление, а не вывод.");
      break;
    }
    case "training": {
      const rel = byCodes(["S2", "S4", "T5", "L4", "L1", "C2"]);
      facts.push(...rel.slice(0, 5).map(describe));
      text = rel.length
        ? "Потребность в обучении определяется по группам и темам, а не по конкретным людям: AI не принимает кадровых решений. Темы обучения по данным диагностики — ниже."
        : "Явных пробелов в знаниях и обучении диагностика не показала.";
      limitations.push("Персональные программы обучения и тесты — следующий этап развития платформы.");
      break;
    }
    case "standards": {
      const rel = byDim("STANDARDS");
      facts.push(...rel.slice(0, 5).map(describe));
      const mys = await ctx.db.evidence.findMany({ where: { sourceType: "MYSTERY_SHOPPER", kind: "TEXT_FEEDBACK" }, orderBy: { createdAt: "desc" }, take: 2 });
      for (const e of mys) {
        facts.push(e.summary);
        sources.add("Тайный покупатель");
      }
      text = rel.length ? "Нарушения стандартов по данным диагностики:" : "Проблем со стандартами не выявлено.";
      break;
    }
    case "team": {
      const rel = [...byDim("TEAM"), ...byDim("LEADERSHIP")];
      facts.push(...rel.slice(0, 5).map(describe));
      if (ctx.can("team.insights")) {
        const pulse = await ctx.db.survey.findFirst({ where: { kind: "TEAM_PULSE" }, orderBy: { createdAt: "desc" } });
        if (pulse) {
          const { pulseResults } = await import("./team");
          const res = await pulseResults(ctx, pulse.id);
          facts.push(...res.risks.map((r) => r.text));
          sources.add("Анонимный пульс-опрос (агрегаты)");
        }
      }
      text = "Состояние команды по агрегированным данным (индивидуальные ответы недоступны никому):";
      break;
    }
    case "results": {
      const tasks = await ctx.db.task.findMany({ where: { status: "DONE" }, orderBy: { completedAt: "desc" }, take: 10 });
      const improved = tasks.filter((t) => t.outcome === "IMPROVED");
      const none = tasks.filter((t) => t.outcome === "NO_EFFECT");
      facts.push(...tasks.filter((t) => t.outcomeNote).map((t) => `${t.title.replace(/\.$/, "")} — ${TASK_OUTCOME_LABELS[t.outcome].toLowerCase()}: ${t.outcomeNote}`));
      sources.add("Задачи и повторные замеры");
      text = tasks.length
        ? `Выполнено задач: ${tasks.length}. Повторный замер подтвердил улучшение по ${improved.length}, не подтвердил — по ${none.length}, ожидают замера — ${tasks.length - improved.length - none.length}. Закрытие задачи само по себе не означает устранения проблемы.`
        : "Выполненных задач пока нет.";
      break;
    }
    default: {
      facts.push(...problems.slice(0, 3).map(describe));
      text = assessment
        ? `Индекс SSI: ${assessment.ssi === null ? "не рассчитан (данных недостаточно)" : Math.round(assessment.ssi)}. Слабейшие направления: ${dims.filter((d) => d.score !== null).sort((a, b) => a.score! - b.score!).slice(0, 2).map((d) => `${DIMENSIONS.find((x) => x.key === d.key)!.shortName} (${Math.round(d.score!)})`).join(", ")}.`
        : "Данных диагностики пока нет.";
      limitations.push(`Я отвечаю на вопросы о проблемах, причинах, выручке, возвращаемости, обучении, стандартах, команде и результатах изменений.`);
    }
  }
  if (assessment) sources.add(`Диагностика SERVICE 5D (методика ${assessment.methodologyVersion})`);

  let answer: AssistantAnswer = { role: intent.role, intent: intent.key, text, facts, sources: [...sources], limitations };

  const provider = getAIProvider({ allowExternalAI: ctx.org.settings.allowExternalAI });
  if (provider.external && facts.length) {
    const { value, error } = await tryComplete(provider, {
      system:
        "Ты — AI-помощник платформы СРЕДА. Отвечай по-русски, кратко, только на основе переданных фактов. Не придумывай цифры, не выдавай гипотезы за факты, не давай кадровых рекомендаций о конкретных людях. Верни JSON {\"text\": string до 900 символов}.",
      user: JSON.stringify({ question: q, role: intent.role, draft: text, facts, limitations }),
      schema: z.object({ text: z.string().min(10).max(1500) }),
    });
    if (value) answer = { ...answer, text: value.text };
    if (error) answer.limitations.push("Внешний AI-провайдер недоступен — ответ сформирован встроенным алгоритмом.");
  }

  await ctx.db.aIAnalysis.create({
    data: {
      organizationId: ctx.org.id,
      kind: "ASSISTANT",
      status: "COMPLETED",
      methodologyVersion: METHODOLOGY_VERSION,
      provider: provider.name,
      model: provider.model,
      inputSummary: { question: q, intent: intent.key, role: intent.role } as object,
      output: answer as unknown as object,
      limitations: answer.limitations,
      requestedById: ctx.user.id,
      completedAt: new Date(),
    },
  });
  await audit({ orgId: ctx.org.id, userId: ctx.user.id }, "assistant.ask", "AIAnalysis", null, { intent: intent.key });
  return answer;
}

export async function assistantHistory(ctx: OrgContext) {
  if (!ctx.can("assistant.use")) throw forbidden();
  const rows = await ctx.db.aIAnalysis.findMany({
    where: { kind: "ASSISTANT", requestedById: ctx.user.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    question: (r.inputSummary as { question: string }).question,
    answer: r.output as unknown as AssistantAnswer,
  }));
}
