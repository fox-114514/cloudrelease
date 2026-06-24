import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
export function normalizeBaseUrl(raw) {
    let url = raw.trim();
    if (!url)
        return "";
    // 0.5.1: default to https:// when no scheme is given. Spelling-only
    // mistakes no longer silently downgrade to plaintext; explicit consent via
    // the allowInsecureHttp flag is required for non-loopback http:// URLs.
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(url)) {
        url = `https://${url}`;
    }
    return url.replace(/\/$/, "");
}
/**
 * Returns true when host is loopback — http:// is fine for these because
 * traffic never leaves the machine. Used to relax the explicit-consent rule.
 */
export function isLoopbackHost(baseUrl) {
    try {
        const u = new URL(normalizeBaseUrl(baseUrl));
        const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (host === "localhost" || host === "127.0.0.1" || host === "::1")
            return true;
        // IPv4 loopback 127.0.0.0/8
        if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host))
            return true;
        return false;
    }
    catch {
        return false;
    }
}
/**
 * Enforce the explicit-consent rule for plaintext HTTP. Throws when the URL is
 * a non-loopback http:// address and the caller did not opt in. Loopback is
 * always allowed because the request never traverses the network.
 */
export function assertExplicitInsecureHttp(baseUrl, opts) {
    let u;
    try {
        u = new URL(normalizeBaseUrl(baseUrl));
    }
    catch {
        throw new Error("服务器地址无效");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error("服务器地址只支持 HTTP 或 HTTPS");
    }
    if (u.protocol !== "http:")
        return;
    if (isLoopbackHost(baseUrl))
        return;
    if (!opts.allowInsecureHttp) {
        throw new Error("服务器地址使用了明文 http://，但未显式启用不安全 HTTP。" +
            "明文连接下 token、密码和图片均可能被窃听。" +
            "请改用 https://，或在受信 VPN/局域网场景下显式启用 --allow-insecure-http。");
    }
}
export function wsUrl(baseUrl) {
    const url = new URL(normalizeBaseUrl(baseUrl));
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/v1/ws";
    url.search = "";
    return url.toString();
}
export function apiUrl(baseUrl, pathname) {
    return `${normalizeBaseUrl(baseUrl)}${pathname}`;
}
export function sanitizeFilePart(value) {
    const cleaned = value
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned.slice(0, 80) || "unknown-device";
}
export function extensionForMime(mimeType) {
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
export async function sha256File(filePath) {
    const hash = crypto.createHash("sha256");
    const handle = await fs.open(filePath, "r");
    try {
        const stream = handle.createReadStream();
        for await (const chunk of stream) {
            hash.update(chunk);
        }
    }
    finally {
        await handle.close();
    }
    return hash.digest("hex");
}
export function sha256Buffer(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}
export function detectImageMimeType(buffer) {
    if (buffer.length >= 4 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47) {
        return "image/png";
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "image/jpeg";
    }
    if (buffer.length >= 12 &&
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50) {
        return "image/webp";
    }
    return undefined;
}
export function detectImageMimeTypeFromPath(filePath) {
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
export async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}
/**
 * Reject paths outside user home / /tmp to prevent accidental exfiltration
 * of sensitive directories (e.g. ~/.ssh, ~/.aws) into the auto-upload
 * pipeline. Callers can pass `allowUnsafe=true` to bypass with a warning.
 */
export function isAllowedDir(rawDir) {
    const resolved = path.resolve(rawDir);
    const home = os.homedir();
    const tmp = "/tmp";
    const sensitiveRoots = [".ssh", ".aws", ".gnupg"].map((name) => path.join(home, name));
    if (sensitiveRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
        return { ok: false, reason: "不允许监听或下载到敏感凭据目录" };
    }
    if (resolved === home) {
        return { ok: false, reason: "不允许直接使用用户家目录，请选择具体子目录" };
    }
    if (resolved.startsWith(home + path.sep))
        return { ok: true };
    if (resolved === tmp || resolved.startsWith(tmp + path.sep))
        return { ok: true };
    return {
        ok: false,
        reason: `路径必须在用户家目录 (${home}) 或 /tmp 下，避免误上传敏感数据`,
    };
}
export async function ensureAllowedDir(rawDir, allowUnsafe) {
    if (!rawDir.trim()) {
        throw new Error("目录不能为空");
    }
    const resolved = path.resolve(rawDir);
    if (!allowUnsafe) {
        const verdict = isAllowedDir(resolved);
        if (!verdict.ok) {
            throw new Error(verdict.reason);
        }
    }
    await ensureDir(resolved);
    const actual = await fs.realpath(resolved);
    if (!allowUnsafe) {
        const actualVerdict = isAllowedDir(actual);
        if (!actualVerdict.ok)
            throw new Error(actualVerdict.reason);
    }
    return actual;
}
export function configDir() {
    const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return path.join(base, "studyshot-relay");
}
export function defaultDownloadDir() {
    return path.join(os.homedir(), "StudyShotDownloads");
}
export function formatTimestamp(input) {
    const date = Number.isNaN(Date.parse(input)) ? new Date() : new Date(input);
    const pad = (value) => String(value).padStart(2, "0");
    return [
        date.getUTCFullYear(),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
        "-",
        pad(date.getUTCHours()),
        pad(date.getUTCMinutes()),
        pad(date.getUTCSeconds()),
    ].join("");
}
//# sourceMappingURL=utils.js.map