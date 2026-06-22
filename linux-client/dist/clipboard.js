import { spawn } from "node:child_process";
import fs from "node:fs/promises";
const CLIPBOARD_TIMEOUT_MS = 5_000;
/**
 * Prefer the clipboard implementation native to the active desktop session,
 * while retaining the other implementation as a fallback for mixed
 * Wayland/XWayland sessions.
 */
export function clipboardCommands(mimeType, env = process.env) {
    const normalizedMime = normalizeImageMime(mimeType);
    const wayland = {
        command: "wl-copy",
        args: ["--type", normalizedMime],
    };
    const x11 = {
        command: "xclip",
        args: ["-selection", "clipboard", "-t", normalizedMime, "-i"],
    };
    if (env.WAYLAND_DISPLAY)
        return [wayland, x11];
    if (env.DISPLAY)
        return [x11, wayland];
    return [wayland, x11];
}
export async function copyImageToClipboard(filePath, mimeType) {
    const image = await fs.readFile(filePath);
    const failures = [];
    for (const candidate of clipboardCommands(mimeType)) {
        try {
            await runClipboardCommand(candidate, image);
            return { tool: candidate.command };
        }
        catch (err) {
            failures.push(`${candidate.command}: ${errorMessage(err)}`);
        }
    }
    throw new Error(`无法写入图片剪贴板；请安装 wl-clipboard（Wayland）或 xclip（X11）。${failures.join("；")}`);
}
function normalizeImageMime(mimeType) {
    const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase();
    return normalized?.startsWith("image/") ? normalized : "image/png";
}
function runClipboardCommand(candidate, image) {
    return new Promise((resolve, reject) => {
        const child = spawn(candidate.command, candidate.args, {
            stdio: ["pipe", "ignore", "pipe"],
        });
        let stderr = "";
        let settled = false;
        const finish = (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (error)
                reject(error);
            else
                resolve();
        };
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            finish(new Error(`执行超过 ${CLIPBOARD_TIMEOUT_MS}ms`));
        }, CLIPBOARD_TIMEOUT_MS);
        child.stderr?.on("data", (chunk) => {
            if (stderr.length < 2048)
                stderr += String(chunk);
        });
        child.on("error", (err) => finish(err));
        child.on("close", (code, signal) => {
            if (code === 0) {
                finish();
                return;
            }
            const detail = stderr.trim() || (signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`);
            finish(new Error(detail));
        });
        child.stdin?.on("error", (err) => {
            // A useful command error is normally reported by close/stderr. Only use
            // the pipe error when it is the first observable failure.
            if (!child.killed)
                finish(err);
        });
        child.stdin?.end(image);
    });
}
function errorMessage(err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        return "未安装";
    }
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=clipboard.js.map