// P9 — structured logging. Emits one JSON object per line to stdout/stderr, which
// Railway captures and which log tooling can parse/query (vs. free-form
// console.log strings). Intentionally dependency-free and tiny; swap the `emit`
// body for a real transport (or forward to Sentry) later without touching callers.
//
// Usage: log.error("api_error", { method, path, userId, error }).

type Level = "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

function emit(level: Level, msg: string, fields?: LogFields): void {
  // Field order is cosmetic; JSON consumers key by name. Spreading fields last
  // lets callers override nothing structural (level/time/msg are reserved).
  const entry = { level, time: new Date().toISOString(), msg, ...fields };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Normalize an unknown thrown value into loggable fields (never throws itself). */
export function errorFields(e: unknown): LogFields {
  if (e instanceof Error) return { error: e.message, stack: e.stack };
  return { error: String(e) };
}

export const log = {
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
