import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AppError } from "./errors";
import { log, errorMeta } from "./logger";

import type { ActionState } from "@/lib/action-state";
export type { ActionState };

/** Преобразует FormData в объект (повторяющиеся ключи → массив). */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const val = v;
    if (k in out) {
      const prev = out[k];
      out[k] = Array.isArray(prev) ? [...prev, val] : [prev, val];
    } else out[k] = val;
  }
  return out;
}

/**
 * Обёртка серверного действия: валидация входа (Zod), единая обработка
 * ошибок, логирование. Проверка прав выполняется внутри handler через
 * actionContext(permission).
 */
export function defineAction<S extends z.ZodType>(
  name: string,
  schema: S,
  handler: (input: z.infer<S>) => Promise<ActionState | void>,
) {
  return async function action(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const parsed = schema.safeParse(formToObject(formData));
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "_");
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return { ok: false, error: "Проверьте правильность заполнения полей", fieldErrors };
    }
    try {
      const res = await handler(parsed.data);
      return res ?? { ok: true };
    } catch (e) {
      unstable_rethrow(e);
      if (e instanceof AppError) return { ok: false, error: e.message };
      log.error(`action.${name}.failed`, errorMeta(e));
      return { ok: false, error: "Не удалось выполнить действие. Попробуйте ещё раз." };
    }
  };
}
