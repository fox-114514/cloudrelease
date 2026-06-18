import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url.replace(/\/$/, "");
}

export function wsUrl(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/v1/ws";
  url.search = "";
  return url.toString();
}

export function apiUrl(baseUrl: string, pathname: string): string {
  return `${normalizeBaseUrl(baseUrl)}${pathname}`;
}

export function sanitizeFilePart(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 80) || "unknown-device";
}

export function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".img";
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

export function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function detectImageMimeType(buffer: Buffer): string | undefined {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

export function detectImageMimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Reject paths outside user home / /tmp to prevent accidental exfiltration
 * of sensitive directories (e.g. ~/.ssh, ~/.aws) into the auto-upload
 * pipeline. Callers can pass `allowUnsafe=true` to bypass with a warning.
 */
export function isAllowedDir(rawDir: string): { ok: boolean; reason?: string } {
  const resolved = path.resolve(rawDir);
  const home = os.homedir();
  const tmp = "/tmp";
  if (resolved === home || resolved.startsWith(home + path.sep)) return { ok: true };
  if (resolved === tmp || resolved.startsWith(tmp + path.sep)) return { ok: true };
  return {
    ok: false,
    reason: `路径必须在用户家目录 (${home}) 或 /tmp 下，避免误上传敏感数据`,
  };
}

export async function ensureAllowedDir(rawDir: string, allowUnsafe: boolean): Promise<string> {
  const resolved = path.resolve(rawDir);
  if (!allowUnsafe) {
    const verdict = isAllowedDir(resolved);
    if (!verdict.ok) {
      throw new Error(verdict.reason);
    }
  }
  await ensureDir(resolved);
  return resolved;
}

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "studyshot-relay");
}

export function defaultDownloadDir(): string {
  return path.join(os.homedir(), "StudyShotDownloads");
}

export function formatTimestamp(input: string): string {
  const date = Number.isNaN(Date.parse(input)) ? new Date() : new Date(input);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
