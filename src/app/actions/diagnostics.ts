"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { actionContext } from "@/server/context";
import {
  createDiagnostic, launchDiagnostic, createSurveyInvites, completeCollection, recalculate, reopenCollection,
  archiveDiagnostic, submitInAppResponse, submitPublicResponse, addCustomCriterion, toggleCustomCriterion, type AnswerInput,
} from "@/server/services/diagnostics";
import { addMetric, importMetricsCsv, deleteMetric } from "@/server/services/metrics";
import { METRIC_META } from "@/domain/metrics";
import type { SourceType } from "@/domain/types";
import { toArray } from "@/lib/validation";

const SOURCES = ["OWNER", "MANAGER", "EMPLOYEE", "CUSTOMER", "MYSTERY_SHOPPER", "BUSINESS_METRICS"] as const;

function answersFrom(input: Record<string, unknown>): AnswerInput[] {
  const out: AnswerInput[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (k.startsWith("q_") && typeof v === "string" && v) out.push({ questionId: k.slice(2), value: Number(v) });
    if (k.startsWith("t_") && typeof v === "string") out.push({ questionId: k.slice(2), text: v });
  }
  return out;
}

export const createDiagnosticAction = defineAction(
  "createDiagnostic",
  z
    .object({
      title: z.string().trim().min(3, "Укажите название").max(150),
      locationId: z.string().optional(),
      sources: z.union([z.enum(SOURCES), z.array(z.enum(SOURCES))], { error: "Выберите источники" }),
    })
    .catchall(z.unknown()),
  async (input) => {
    const ctx = await actionContext("diagnostics.manage");
    const sources = toArray(input.sources as string | string[]) as SourceType[];
    const targets: Partial<Record<SourceType, number>> = {};
    for (const s of sources) {
      const v = Number(input[`target_${s}`]);
      if (Number.isFinite(v) && v > 0) targets[s] = Math.min(Math.round(v), 10000);
    }
    const d = await createDiagnostic(ctx, { title: input.title, locationId: input.locationId || null, sources, targets });
    redirect(`/diagnostics/${d.id}`);
  },
);

const idSchema = z.object({ id: z.string().min(1) });

export const launchDiagnosticAction = defineAction("launchDiagnostic", idSchema, async ({ id }) => {
  const ctx = await actionContext("diagnostics.manage");
  await launchDiagnostic(ctx, id);
  revalidatePath(`/diagnostics/${id}`);
  return { ok: true, message: "Сбор данных запущен. Ссылки на анкеты готовы." };
});

export const createInvitesAction = defineAction(
  "createInvites",
  z.object({ surveyId: z.string(), count: z.coerce.number().int().min(1).max(200) }),
  async ({ surveyId, count }) => {
    const ctx = await actionContext("diagnostics.manage");
    const tokens = await createSurveyInvites(ctx, surveyId, count);
    revalidatePath("/diagnostics");
    return { ok: true, message: `Создано ссылок: ${tokens.length}. Каждая работает один раз.`, data: { invites: tokens } };
  },
);

export const completeCollectionAction = defineAction("completeCollection", idSchema, async ({ id }) => {
  const ctx = await actionContext("diagnostics.manage");
  const { result } = await completeCollection(ctx, id);
  revalidatePath(`/diagnostics/${id}`);
  return {
    ok: true,
    message: result.ssi === null ? "Сбор завершён. SSI не рассчитан — данных недостаточно, см. ограничения." : `Сбор завершён. SSI = ${result.ssi}.`,
  };
});

export const recalculateAction = defineAction("recalculate", idSchema, async ({ id }) => {
  const ctx = await actionContext("diagnostics.manage");
  await recalculate(ctx, id);
  revalidatePath(`/diagnostics/${id}`);
  return { ok: true, message: "Предварительный расчёт обновлён" };
});

export const reopenAction = defineAction("reopen", idSchema, async ({ id }) => {
  const ctx = await actionContext("diagnostics.manage");
  await reopenCollection(ctx, id);
  revalidatePath(`/diagnostics/${id}`);
  return { ok: true, message: "Сбор данных возобновлён" };
});

export const archiveDiagnosticAction = defineAction("archiveDiagnostic", idSchema, async ({ id }) => {
  const ctx = await actionContext("diagnostics.manage");
  await archiveDiagnostic(ctx, id);
  redirect("/diagnostics");
});

export const submitInAppAction = defineAction(
  "submitInApp",
  z.object({ surveyId: z.string(), diagnosticId: z.string() }).catchall(z.unknown()),
  async (input) => {
    const ctx = await actionContext(["diagnostics.respond", "diagnostics.manage"]);
    await submitInAppResponse(ctx, input.surveyId, answersFrom(input));
    revalidatePath("/diagnostics");
    redirect(`/diagnostics/${input.diagnosticId}?submitted=1`);
  },
);

export const submitPublicAction = defineAction(
  "submitPublic",
  z
    .object({
      token: z.string().min(10),
      invite: z.string().optional(),
      respondentLabel: z.string().max(120).optional(),
      departmentId: z.string().optional(),
      website: z.string().optional(), // honeypot
    })
    .catchall(z.unknown()),
  async (input) => {
    if (input.website) return { ok: true, message: "Спасибо!" };
    const store = await cookies();
    const marker = `sreda_s_${input.token.slice(0, 10)}`;
    if (!input.invite && store.get(marker)) return { ok: false, error: "С этого устройства анкета уже заполнена. Спасибо!" };
    await submitPublicResponse(input.token, {
      answers: answersFrom(input),
      inviteToken: input.invite || undefined,
      respondentLabel: input.respondentLabel,
      departmentId: input.departmentId,
    });
    store.set(marker, "1", { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
    redirect(`/s/${input.token}/thanks`);
  },
);

export const addCriterionAction = defineAction(
  "addCriterion",
  z.object({
    dimension: z.enum(["CUSTOMER", "TEAM", "LEADERSHIP", "STANDARDS", "BUSINESS_RESULTS"]),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10, "Опишите утверждение для оценки (от 10 символов)").max(300),
    weight: z.coerce.number().int().min(1).max(3),
  }),
  async (input) => {
    const ctx = await actionContext("diagnostics.manage");
    await addCustomCriterion(ctx, input);
    revalidatePath("/diagnostics/criteria");
    return { ok: true, message: "Критерий добавлен. Он войдёт в анкеты собственника и руководителя новых диагностик." };
  },
);

export const toggleCriterionAction = defineAction(
  "toggleCriterion",
  z.object({ id: z.string(), active: z.enum(["0", "1"]) }),
  async ({ id, active }) => {
    const ctx = await actionContext("diagnostics.manage");
    await toggleCustomCriterion(ctx, id, active === "1");
    revalidatePath("/diagnostics/criteria");
    return { ok: true };
  },
);

const METRIC_KEYS = Object.keys(METRIC_META) as [keyof typeof METRIC_META, ...(keyof typeof METRIC_META)[]];

export const addMetricAction = defineAction(
  "addMetric",
  z.object({
    key: z.enum(METRIC_KEYS),
    kind: z.enum(["FACT", "ESTIMATE", "FORECAST"]),
    month: z.string().regex(/^\d{4}-\d{2}$/, "Укажите месяц"),
    value: z.string().transform((v) => Number(v.replace(/\s/g, "").replace(",", "."))).pipe(z.number({ error: "Введите число" })),
    locationId: z.string().optional(),
    note: z.string().max(300).optional(),
  }),
  async (input) => {
    const ctx = await actionContext("metrics.manage");
    const { updated } = await addMetric(ctx, input);
    revalidatePath("/metrics");
    return { ok: true, message: updated ? "Значение за этот месяц обновлено" : "Показатель сохранён" };
  },
);

export const importMetricsAction = defineAction(
  "importMetrics",
  z.object({ file: z.instanceof(File, { message: "Выберите файл" }), locationId: z.string().optional() }),
  async ({ file, locationId }) => {
    const ctx = await actionContext("metrics.manage");
    if (file.size === 0) return { ok: false, error: "Файл пуст" };
    if (file.size > 2 * 1024 * 1024) return { ok: false, error: "Файл больше 2 МБ" };
    const text = await file.text();
    const res = await importMetricsCsv(ctx, text, locationId || null);
    revalidatePath("/metrics");
    return {
      ok: res.imported > 0,
      message: `Импортировано строк: ${res.imported}.`,
      error: res.errors.length ? `Ошибки (${res.errors.length}): ${res.errors.slice(0, 5).join("; ")}` : undefined,
    };
  },
);

export const deleteMetricAction = defineAction("deleteMetric", idSchema, async ({ id }) => {
  const ctx = await actionContext("metrics.manage");
  await deleteMetric(ctx, id);
  revalidatePath("/metrics");
  return { ok: true };
});
