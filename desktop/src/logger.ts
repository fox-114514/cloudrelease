import { app } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

type LogLevel = "info" | "warn" | "error";

function logPath(): string {
  return path.join(app.getPath("logs"), "studyshot-desktop.log");
}

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(
    JSON.stringify(value, (key, current) => {
      if (key.toLowerCase().includes("token")) return "[redacted]";
      if (key.toLowerCase().includes("password")) return "[redacted]";
      if (key.toLowerCase().includes("bindcode")) return "[redacted]";
      return current;
    })
  ) as unknown;
}

export async function writeLog(level: LogLevel, message: string, metadata?: unknown): Promise<void> {
  const file = logPath();
  await mkdir(path.dirname(file), { recursive: true });
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    metadata: redact(metadata),
  });
  await appendFile(file, `${line}\n`, "utf8");
}

export function logInfo(message: string, metadata?: unknown): void {
  writeLog("info", message, metadata).catch(() => undefined);
}

export function logWarn(message: string, metadata?: unknown): void {
  writeLog("warn", message, metadata).catch(() => undefined);
}

export function logError(message: string, metadata?: unknown): void {
  writeLog("error", message, metadata).catch(() => undefined);
}

