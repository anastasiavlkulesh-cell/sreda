/**
 * Структурированный логгер (JSON в stdout — удобно для Docker/Loki/ELK).
 * Персональные данные в лог не пишутся: только идентификаторы.
 */
type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < min || process.env.NODE_ENV === "test") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (m: string, meta?: Record<string, unknown>) => write("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => write("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => write("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => write("error", m, meta),
};

export function errorMeta(e: unknown) {
  return e instanceof Error ? { error: e.message, stack: e.stack?.split("\n").slice(0, 5).join(" | ") } : { error: String(e) };
}
