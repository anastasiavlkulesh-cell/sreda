/**
 * Анализ диагностики: проблемы, противоречия, первопричины, достоверность,
 * приоритеты, рекомендации. Чистая функция — одинаковые данные дают
 * одинаковый результат; это основа, которую внешний AI-провайдер может
 * только дополнить формулировками, но не изменить.
 *
 * Правила методики (версия 5D-1.0):
 *  — проблема: итоговая оценка критерия ≤ 3,0 (направление ≤ 50 баллов),
 *    либо ключевой для направления источник (клиенты — для клиентского опыта,
 *    сотрудники — для команды и управления) оценивает критерий ≤ 3,0: высокая
 *    самооценка руководства не должна «маскировать» проблему в среднем;
 *  — подтверждено: низкая оценка (≤ 3,0) у двух и более источников, либо у
 *    одного надёжного источника + подтверждение в открытых ответах;
 *  — частично подтверждено: низкая оценка у одного источника;
 *  — гипотеза: вывод опирается только на открытые ответы или на связь
 *    причин, по которой нет данных;
 *  — противоречие: разрыв ≥ 1,5 балла между управленческими источниками
 *    (собственник, руководитель) и «полевыми» (сотрудники, клиенты,
 *    тайный покупатель).
 */
import { CRITERIA_BY_CODE, SOURCE_LABELS, DIMENSIONS } from "./methodology/v1";
import type { AssessmentResult, CriterionResult, SourceStat } from "./ssi";
import {
  DEFAULT_PRIORITY_SETTINGS, priorityCategory, priorityScore, scaleFromSources, severityFromScore, systemicFromCauses,
  type PrioritySettings,
} from "./priority";
import type { Confidence, DimensionKey, FindingStatus, PriorityCategory, SourceType } from "./types";
import { scrubPII } from "./anonymity";

export const PROBLEM_THRESHOLD = 3.0;
export const CONTRADICTION_GAP = 1.5;
const MANAGEMENT: SourceType[] = ["OWNER", "MANAGER"];
const FIELD: SourceType[] = ["EMPLOYEE", "CUSTOMER", "MYSTERY_SHOPPER"];

/** Темы открытых ответов → критерии (лексикон методики). */
export const TEXT_THEMES: { code: string; label: string; pattern: RegExp }[] = [
  { code: "C1", label: "ожидание и скорость", pattern: /(очеред|долго|ждал|ждать|ожидан|медленн|быстрее)/i },
  { code: "C2", label: "внимание и доброжелательность", pattern: /(не поздорова|грубо|хамств|равнодуш|невежлив|не извинил)/i },
  { code: "C3", label: "качество продукта", pattern: /(холодн|невкусн|перепутал|ошиб(ка|лись) в заказе|брак|некачествен)/i },
  { code: "C4", label: "работа с жалобами", pattern: /(жалоб|ничего не предложил|не решил|претензи)/i },
  { code: "C6", label: "чистота", pattern: /(грязн|не убран|мусор|липк)/i },
  { code: "T4", label: "перегрузка", pattern: /(не хватает (людей|сотрудник|персонал)|на пределе|перегруз|переработ|без выходных)/i },
  { code: "T2", label: "условия работы", pattern: /(зарплат|условия труда|негде отдохнуть|оснащени)/i },
  { code: "L1", label: "обратная связь", pattern: /(обратн(ую|ой|ая) связ|не хвалят|только когда что-то не так)/i },
  { code: "L2", label: "планирование и контроль", pattern: /(график составля|без учёта|без учета|никто не контролир|задачи теряются)/i },
  { code: "S1", label: "отсутствие стандартов", pattern: /(нет (понятных )?правил|стандартов (на бумаге )?нет|не прописан|не описан)/i },
  { code: "S4", label: "обучение новичков", pattern: /(учим на ходу|новичк|не обучил|без обучения)/i },
];

export interface AnalysisInput {
  assessment: AssessmentResult;
  sourceStats: SourceStat[];
  texts: { source: SourceType; text: string }[];
  metricNotes: Map<string, string>;
  /** Индивидуальные критерии компании (нет в каталоге методики) */
  customCriteria: { code: string; title: string; description: string; businessImpact: number; urgency: number; feasibility: number }[];
  prioritySettings?: PrioritySettings;
  /** Минимальный размер группы для показа цитат анонимных источников */
  anonymityMinGroup?: number;
}

export interface EvidenceDraft {
  key: string;
  kind: "SURVEY_AGGREGATE" | "TEXT_FEEDBACK" | "CONTRADICTION" | "METRIC";
  sourceType: SourceType | null;
  criterionCode: string | null;
  summary: string;
  data: Record<string, unknown>;
}

export interface CauseDraft {
  title: string;
  explanation: string;
  findingStatus: FindingStatus;
  supportingCriteria: string[];
  evidenceKeys: string[];
}

export interface ProblemDraft {
  dimension: DimensionKey;
  criterionCode: string;
  title: string;
  description: string;
  consequences: string;
  findingStatus: FindingStatus;
  confidence: Confidence;
  severity: number;
  businessImpact: number;
  urgency: number;
  scale: number;
  systemic: number;
  feasibility: number;
  priorityScore: number;
  priority: PriorityCategory;
  evidenceKeys: string[];
  dataSources: SourceType[];
  causes: CauseDraft[];
  recommendation: {
    title: string;
    rationale: string;
    checklist: string[];
    metricsUsed: string[];
    limitations: string[];
  };
}

export interface AnalysisOutput {
  problems: ProblemDraft[];
  evidence: EvidenceDraft[];
  contradictions: { criterionCode: string; title: string; management: number; field: number; gap: number }[];
  summary: string;
  limitations: string[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;

function criterionMeta(code: string, input: AnalysisInput) {
  const def = CRITERIA_BY_CODE.get(code);
  if (def) return def;
  const c = input.customCriteria.find((x) => x.code === code);
  if (!c) return null;
  return {
    code,
    title: c.title,
    description: c.description,
    businessImpact: c.businessImpact,
    urgency: c.urgency,
    feasibility: c.feasibility,
    causes: [] as { code: string; explanation: string }[],
    consequences: "Отклонение от индивидуального стандарта компании.",
    solution: "Определить ответственного, описать ожидаемый результат и проверить выполнение через 4 недели.",
    checklist: ["Назначить ответственного", "Описать ожидаемый результат", "Проверить выполнение"],
  };
}

function lowSources(c: CriterionResult): SourceType[] {
  return (Object.entries(c.bySource) as [SourceType, { mean: number; n: number }][])
    .filter(([, v]) => v.mean <= PROBLEM_THRESHOLD)
    .map(([s]) => s);
}

function groupMean(c: CriterionResult, group: SourceType[]): number | null {
  const vals = group.map((s) => c.bySource[s]?.mean).filter((v): v is number => v !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function analyzeDiagnostic(input: AnalysisInput): AnalysisOutput {
  const settings = input.prioritySettings ?? DEFAULT_PRIORITY_SETTINGS;
  const k = input.anonymityMinGroup ?? 5;
  const statBy = new Map(input.sourceStats.map((s) => [s.type, s]));
  const allCriteria = input.assessment.dimensions.flatMap((d) => d.criteria.map((c) => ({ ...c, dimension: d.key })));
  const byCode = new Map(allCriteria.map((c) => [c.code, c]));
  const evidence: EvidenceDraft[] = [];
  const limitations: string[] = [];

  // --- 1. Темы открытых ответов
  const themeHits = new Map<string, { source: SourceType; text: string }[]>();
  for (const t of input.texts) {
    for (const theme of TEXT_THEMES) {
      if (theme.pattern.test(t.text)) themeHits.set(theme.code, [...(themeHits.get(theme.code) ?? []), t]);
    }
  }
  for (const [code, hits] of themeHits) {
    const theme = TEXT_THEMES.find((t) => t.code === code)!;
    const bySource = new Map<SourceType, string[]>();
    for (const h of hits) bySource.set(h.source, [...(bySource.get(h.source) ?? []), h.text]);
    for (const [source, texts] of bySource) {
      const anonymous = source === "EMPLOYEE" || source === "CUSTOMER";
      const respondents = statBy.get(source)?.responses ?? 0;
      const canQuote = !anonymous || respondents >= k;
      evidence.push({
        key: `text:${code}:${source}`,
        kind: "TEXT_FEEDBACK",
        sourceType: source,
        criterionCode: code,
        summary: `${SOURCE_LABELS[source]}: тема «${theme.label}» в ${texts.length} открытых ответах.`,
        data: {
          mentions: texts.length,
          quotes: canQuote ? [...new Set(texts.map((t) => scrubPII(t)))].slice(0, 3) : [],
          quotesHidden: !canQuote,
        },
      });
    }
  }

  // --- 2. Агрегаты по критериям и метрики
  for (const c of allCriteria) {
    if (c.score === null) continue;
    for (const [src, v] of Object.entries(c.bySource) as [SourceType, { mean: number; n: number }][]) {
      if (src === "BUSINESS_METRICS") {
        evidence.push({
          key: `metric:${c.code}`,
          kind: "METRIC",
          sourceType: "BUSINESS_METRICS",
          criterionCode: c.code,
          summary: input.metricNotes.get(c.code) ?? `Оценка по бизнес-показателям: ${v.mean}.`,
          data: { score: v.mean },
        });
      } else {
        evidence.push({
          key: `agg:${c.code}:${src}`,
          kind: "SURVEY_AGGREGATE",
          sourceType: src,
          criterionCode: c.code,
          summary: `${SOURCE_LABELS[src]}: «${c.title}» — ${v.mean.toFixed(1)} из 5 (ответов: ${v.n}).`,
          data: { mean: v.mean, n: v.n },
        });
      }
    }
  }

  // --- 3. Противоречия
  const contradictions: AnalysisOutput["contradictions"] = [];
  for (const c of allCriteria) {
    const m = groupMean(c, MANAGEMENT);
    const f = groupMean(c, FIELD);
    if (m === null || f === null) continue;
    const gap = r1(m - f);
    if (Math.abs(gap) >= CONTRADICTION_GAP) {
      contradictions.push({ criterionCode: c.code, title: c.title, management: r1(m), field: r1(f), gap });
      evidence.push({
        key: `contr:${c.code}`,
        kind: "CONTRADICTION",
        sourceType: null,
        criterionCode: c.code,
        summary:
          gap > 0
            ? `Руководство оценивает «${c.title}» на ${r1(m)}, а сотрудники/клиенты — на ${r1(f)}: управленческая оценка завышена на ${Math.abs(gap)}.`
            : `Сотрудники/клиенты оценивают «${c.title}» выше руководства (${r1(f)} против ${r1(m)}).`,
        data: { management: r1(m), field: r1(f), gap },
      });
    }
  }

  // --- 4. Проблемы
  const keyMean = (c: (typeof allCriteria)[number]) => {
    const keys = DIMENSIONS.find((d) => d.key === c.dimension)!.keySources.filter((s) => !MANAGEMENT.includes(s));
    return keys.length ? groupMean(c, keys) : null;
  };
  const problemCodes = new Set<string>();
  for (const c of allCriteria) {
    if (c.score === null) continue;
    const km = keyMean(c);
    if (c.score <= PROBLEM_THRESHOLD || (km !== null && km <= PROBLEM_THRESHOLD)) problemCodes.add(c.code);
  }
  for (const x of contradictions) {
    if (x.gap >= CONTRADICTION_GAP && (x.field <= PROBLEM_THRESHOLD || (byCode.get(x.criterionCode)?.score ?? 5) <= 3.5)) problemCodes.add(x.criterionCode);
  }

  const problems: ProblemDraft[] = [];
  for (const code of problemCodes) {
    const c = byCode.get(code)!;
    const meta = criterionMeta(code, input);
    if (!meta) continue;
    const score = c.score!;
    const km = keyMean(c);
    const effective = Math.min(score, km ?? score);
    const sourcesWithData = Object.keys(c.bySource) as SourceType[];
    const low = lowSources(c);
    const textCorroborated = themeHits.has(code);
    const reliableLow = low.filter((s) => {
      const st = statBy.get(s);
      return st && st.responses >= st.target;
    });
    let findingStatus: FindingStatus;
    if (low.length >= 2 || (reliableLow.length >= 1 && textCorroborated)) findingStatus = "CONFIRMED";
    else if (low.length === 1) findingStatus = "PARTIALLY_CONFIRMED";
    else findingStatus = "HYPOTHESIS"; // проблема выявлена только по расхождению оценок
    const contradiction = contradictions.find((x) => x.criterionCode === code);

    // Причины
    const causes: CauseDraft[] = [];
    for (const cause of meta.causes) {
      const cc = byCode.get(cause.code);
      const causeMeta = CRITERIA_BY_CODE.get(cause.code);
      const title = causeMeta?.title ?? cause.code;
      if (!cc || cc.score === null) {
        causes.push({
          title: `${title}: ${cause.explanation.toLowerCase()}`,
          explanation: `Причина возможна по методике, но данных по критерию «${title}» нет — требуется проверка.`,
          findingStatus: "HYPOTHESIS",
          supportingCriteria: [],
          evidenceKeys: evidence.filter((e) => e.key.startsWith(`text:${cause.code}:`)).map((e) => e.key),
        });
        continue;
      }
      if (cc.score > PROBLEM_THRESHOLD) continue; // данные не подтверждают эту причину
      const ccLow = lowSources(cc);
      const status: FindingStatus = ccLow.length >= 2 || (ccLow.length === 1 && themeHits.has(cause.code)) ? "CONFIRMED" : "PARTIALLY_CONFIRMED";
      causes.push({
        title: cause.explanation,
        explanation: `Критерий «${title}» оценён на ${cc.score.toFixed(1)} из 5 (${ccLow.map((s) => SOURCE_LABELS[s]).join(", ") || "итоговая оценка"}).`,
        findingStatus: status,
        supportingCriteria: [cause.code],
        evidenceKeys: [
          ...ccLow.map((s) => `agg:${cause.code}:${s}`),
          ...(themeHits.has(cause.code) ? evidence.filter((e) => e.key.startsWith(`text:${cause.code}:`)).map((e) => e.key) : []),
        ],
      });
    }
    causes.sort((a, b) => order(a.findingStatus) - order(b.findingStatus));
    const supported = causes.filter((x) => x.findingStatus !== "HYPOTHESIS").length;

    const severity = effective > PROBLEM_THRESHOLD ? 3 : severityFromScore(effective);
    const critical = input.assessment.criticalRisks.some((r) => r.includes(`«${c.title}»`));
    const params = {
      severity,
      businessImpact: meta.businessImpact,
      urgency: Math.min(5, meta.urgency + (critical ? 1 : 0)),
      scale: scaleFromSources(low.length, sourcesWithData.length),
      systemic: systemicFromCauses(supported),
    };
    const pScore = priorityScore(params, settings);
    const dim = DIMENSIONS.find((d) => d.key === c.dimension)!;

    const evidenceKeys = [
      ...sourcesWithData.map((s) => (s === "BUSINESS_METRICS" ? `metric:${code}` : `agg:${code}:${s}`)),
      ...evidence.filter((e) => e.key.startsWith(`text:${code}:`)).map((e) => e.key),
      ...(contradiction ? [`contr:${code}`] : []),
    ];
    const confidence: Confidence =
      findingStatus === "CONFIRMED" && sourcesWithData.length >= 2 ? "HIGH" : findingStatus === "HYPOTHESIS" ? "LOW" : "MEDIUM";

    const recLimitations: string[] = [];
    if (findingStatus !== "CONFIRMED") recLimitations.push("Вывод подтверждён не всеми источниками — рекомендуется проверить на месте.");
    if (c.dimension === "BUSINESS_RESULTS")
      recLimitations.push("Изменение бизнес-показателей может быть связано с внешними факторами (сезонность, цены, конкуренты) — они проверяются отдельно.");
    if (sourcesWithData.length === 1) recLimitations.push("Оценка основана на одном источнике.");

    const description = [
      `«${c.title}» — ${score.toFixed(1)} из 5 (направление «${dim.shortName}»).`,
      km !== null && km < score - 0.2 ? `Ключевой источник направления оценивает ниже: ${km.toFixed(1)}.` : "",
      low.length ? `Низкие оценки: ${low.map((s) => `${SOURCE_LABELS[s]} ${c.bySource[s]!.mean.toFixed(1)}`).join(", ")}.` : "",
      contradiction
        ? contradiction.gap > 0
          ? `Руководство оценивает ситуацию заметно лучше (${contradiction.management} против ${contradiction.field}).`
          : `Руководство оценивает ситуацию хуже, чем сотрудники и клиенты.`
        : "",
      textCorroborated ? `Тема звучит в открытых ответах.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    problems.push({
      dimension: c.dimension,
      criterionCode: code,
      title: effective <= PROBLEM_THRESHOLD ? `Низкий уровень: ${c.title.toLowerCase()}` : `Расхождение оценок: ${c.title.toLowerCase()}`,
      description,
      consequences: meta.consequences,
      findingStatus,
      confidence,
      ...params,
      feasibility: meta.feasibility,
      priorityScore: pScore,
      priority: priorityCategory(pScore, settings),
      evidenceKeys,
      dataSources: sourcesWithData,
      causes,
      recommendation: {
        title: meta.solution,
        rationale:
          supported > 0
            ? `Решение направлено на подтверждённые данными причины: ${causes.filter((x) => x.findingStatus !== "HYPOTHESIS").map((x) => x.title.replace(/[.\s]+$/, "").toLowerCase()).join("; ")}.`
            : "Решение направлено на сам критерий; причины требуют проверки.",
        checklist: meta.checklist,
        metricsUsed: [`${code} «${c.title}» = ${score.toFixed(1)}${km !== null ? ` (ключевой источник ${km.toFixed(1)})` : ""}`, ...causes.flatMap((x) => x.supportingCriteria.map((s) => `${s} = ${byCode.get(s)?.score?.toFixed(1)}`))],
        limitations: recLimitations,
      },
    });
  }

  problems.sort((a, b) => b.priorityScore - a.priorityScore);

  // --- 5. Ограничения анализа
  limitations.push(...input.assessment.limitations);
  const noTexts = input.texts.length === 0;
  if (noTexts) limitations.push("Открытых ответов нет — причины подтверждаются только количественными оценками.");
  if (input.sourceStats.filter((s) => s.enabled && s.responses > 0).length < 2)
    limitations.push("Данные получены менее чем из двух источников — сопоставление мнений невозможно.");

  const top = problems.slice(0, 3);
  const summary =
    problems.length === 0
      ? "Проблемных критериев (оценка ≤ 3,0) не выявлено. Рекомендуется поддерживать текущий уровень и повторить диагностику через 3 месяца." +
        (contradictions.length ? ` Есть расхождения оценок между руководством и командой/клиентами по ${contradictions.length} критериям — их стоит обсудить.` : "")
      : `Выявлено проблем: ${problems.length} (P1: ${problems.filter((p) => p.priority === "P1").length}, P2: ${problems.filter((p) => p.priority === "P2").length}). ` +
        `В первую очередь: ${top.map((p) => `«${byCode.get(p.criterionCode)!.title}» (${p.priority})`).join(", ")}.` +
        (contradictions.filter((x) => x.gap > 0).length
          ? ` Руководство переоценивает ситуацию по ${contradictions.filter((x) => x.gap > 0).length} критериям — это само по себе риск: проблемы не видны тем, кто принимает решения.`
          : "");

  return { problems, evidence, contradictions, summary, limitations: [...new Set(limitations)] };
}

function order(s: FindingStatus) {
  return s === "CONFIRMED" ? 0 : s === "PARTIALLY_CONFIRMED" ? 1 : 2;
}
