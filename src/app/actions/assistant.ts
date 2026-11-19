"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { actionContext } from "@/server/context";
import { askAssistant } from "@/server/services/assistant";

export const askAction = defineAction("ask", z.object({ question: z.string().trim().min(3, "Сформулируйте вопрос").max(500) }), async ({ question }) => {
  const ctx = await actionContext("assistant.use");
  await askAssistant(ctx, question);
  revalidatePath("/assistant");
  return { ok: true };
});
