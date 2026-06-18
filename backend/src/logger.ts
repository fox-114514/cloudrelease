import { config } from "./config.js";

/**
 * A small wrapper around console for now. Fastify uses pino internally,
 * so most request logs go through fastify.log. This logger is for startup
 * and background tasks.
 */
export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: "info", msg, ...sanitize(meta) }));
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: "warn", msg, ...sanitize(meta) }));
  },
  error: (msg: string, meta?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: "error", msg, ...sanitize(meta) }));
  },
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (config.NODE_ENV === "development") {
      console.log(JSON.stringify({ level: "debug", msg, ...sanitize(meta) }));
    }
  },
};

const SENSITIVE_KEYS = new Set([
  "token",
  "deviceToken",
  "password",
  "passwordHash",
  "jwtSecret",
  "authorization",
  "cookie",
]);

function sanitize(meta?: Record<string, unknown>): Record<string, unknown> {
  if (!meta) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower) || lower.includes("token") || lower.includes("secret") || lower.includes("password")) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = value;
    }
  }
  return result;
}
