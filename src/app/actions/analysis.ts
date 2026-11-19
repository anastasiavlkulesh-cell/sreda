"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { actionContext } from "@/server/context";
import { runDiagnosticAnalysis, setProblemStatus } from "@/server/services/analysis";

export const runAnalysisAction = defineAction("runAnalysis", z.object({ id: z.string() }), async ({ id }) => {
  const ctx = await actionContext("analysis.run");
  const { output } = await runDiagnosticAnalysis(ctx, id);
  revalidatePath(`/diagnostics/${id}`);
  revalidatePath("/problems");
  revalidatePath("/dashboard");
  return { ok: true, message: `Анализ выполнен: проблем — ${output.problems.length}.` };
});

export const problemStatusAction = defineAction(
  "problemStatus",
  z.object({ id: z.string(), status: z.enum(["DISMISSED", "OPEN"]), reason: z.string().max(500).optional() }),
  async ({ id, status, reason }) => {
    const ctx = await actionContext("plan.manage");
    await setProblemStatus(ctx, id, status, reason);
    revalidatePath(`/problems/${id}`);
    revalidatePath("/problems");
    return { ok: true, message: status === "DISMISSED" ? "Проблема отклонена" : "Проблема возвращена в работу" };
  },
);
