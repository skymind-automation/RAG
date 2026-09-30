/**
 * Structured JSON logger with mandatory redaction.
 *
 * Fields whose *key* looks sensitive are replaced before serialisation, at any
 * depth. Callers should still avoid logging ticket bodies or AI prompts; the
 * redactor is a safety net, not a licence. Swap the sink for OpenTelemetry /
 * Sentry by replacing `write` — the call sites do not change.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  requestId?: string;
  organizationId?: string;
  userId?: string;
  operation?: string;
  latencyMs?: number;
  result?: "ok" | "error" | "denied";
  errorCategory?: string;
  [key: string]: unknown;
}

const SENSITIVE_KEY =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|credential|private[-_]?key|hash/i;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const REDACTED = "[REDACTED]";

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

function minLevel(): LogLevel {
  const env = process.env.LOG_LEVEL as LogLevel | undefined;
  if (env && env in LEVEL_ORDER) return env;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function write(level: LogLevel, message: string, fields: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) return;
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(redact(fields) as Record<string, unknown>),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bound: LogFields): Logger;
}

function make(bound: LogFields): Logger {
  return {
    debug: (m, f = {}) => write("debug", m, { ...bound, ...f }),
    info: (m, f = {}) => write("info", m, { ...bound, ...f }),
    warn: (m, f = {}) => write("warn", m, { ...bound, ...f }),
    error: (m, f = {}) => write("error", m, { ...bound, ...f }),
    child: (more) => make({ ...bound, ...more }),
  };
}

export const logger: Logger = make({});
