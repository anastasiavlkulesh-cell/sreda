import "server-only";
import { z } from "zod";
import { log, errorMeta } from "../logger";

/**
 * AI service layer. Бизнес-логика вызывает только интерфейс AIProvider —
 * провайдер меняется переменными окружения без изменения кода.
 *
 *  rules              — встроенный алгоритмический анализ; внешних вызовов нет.
 *  openai-compatible  — любой API с протоколом /chat/completions (YandexGPT через
 *                       совместимый шлюз, GigaChat-прокси, OpenAI, локальная модель).
 *
 * Внешний провайдер используется, только если компания дала согласие
 * (settings.allowExternalAI) — иначе всегда rules.
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string | null;
  readonly external: boolean;
  /** Возвращает JSON, проверенный схемой, или null, если провайдер не генерирует текст. */
  completeJson<T>(req: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number }): Promise<T | null>;
}

class RulesProvider implements AIProvider {
  readonly name = "rules";
  readonly model = null;
  readonly external = false;
  async completeJson<T>(): Promise<T | null> {
    return null;
  }
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = "openai-compatible";
  readonly external = true;
  constructor(
    private baseUrl: string,
    private apiKey: string,
    readonly model: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async completeJson<T>(req: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number }): Promise<T | null> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        max_tokens: req.maxTokens ?? 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`AI API ответил ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("Пустой ответ AI API");
    const json = JSON.parse(content.replace(/^```(json)?|```$/g, "").trim());
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) throw new Error("Ответ AI не прошёл проверку схемы");
    return parsed.data;
  }
}

const rules = new RulesProvider();

export function getAIProvider(opts: { allowExternalAI?: boolean }): AIProvider {
  const kind = process.env.AI_PROVIDER ?? "rules";
  if (kind === "openai-compatible" && opts.allowExternalAI) {
    const { AI_BASE_URL, AI_API_KEY, AI_MODEL } = process.env;
    if (AI_BASE_URL && AI_API_KEY && AI_MODEL) return new OpenAICompatibleProvider(AI_BASE_URL, AI_API_KEY, AI_MODEL);
    log.warn("ai.provider_misconfigured", { kind });
  }
  return rules;
}

/** Безопасный вызов: ошибка провайдера не ломает анализ, а фиксируется как ограничение. */
export async function tryComplete<T>(provider: AIProvider, req: Parameters<AIProvider["completeJson"]>[0] & { schema: z.ZodType<T> }) {
  try {
    return { value: await provider.completeJson(req), error: null as string | null };
  } catch (e) {
    log.error("ai.complete_failed", { provider: provider.name, ...errorMeta(e) });
    return { value: null, error: e instanceof Error ? e.message : String(e) };
  }
}
