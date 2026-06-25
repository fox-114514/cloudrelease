import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sha256File } from "./utils.js";
export const CLIENT_VERSION = "0.5.1";
export function isNewerVersion(candidate, current = CLIENT_VERSION) {
    const parse = (value) => value.split("-")[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
    const next = parse(candidate);
    const installed = parse(current);
    for (let index = 0; index < Math.max(next.length, installed.length); index += 1) {
        const difference = (next[index] ?? 0) - (installed[index] ?? 0);
        if (difference !== 0)
            return difference > 0;
    }
    return false;
}
export function defaultUpdateDir() {
    return path.join(os.homedir(), "Downloads", "StudyShot Relay");
}
export async function downloadUpdate(api, release, targetDir = defaultUpdateDir()) {
    await fs.mkdir(targetDir, { recursive: true });
    const target = path.join(targetDir, path.basename(release.fileName));
    const partial = `${target}.part`;
    await fs.rm(partial, { force: true });
    const body = await api.downloadUpdatePackage(release.downloadPath);
    await pipeline(Readable.fromWeb(body), createWriteStream(partial, { flags: "wx" }));
    const actual = await sha256File(partial);
    if (actual.toLowerCase() !== release.sha256.toLowerCase()) {
        await fs.rm(partial, { force: true });
        throw new Error("更新包 SHA-256 校验失败");
    }
    await fs.rm(target, { force: true });
    await fs.rename(partial, target);
    return target;
}
export async function openUpdatePackage(packagePath) {
    if (packagePath.toLowerCase().endsWith(".appimage")) {
        await fs.chmod(packagePath, 0o755);
        await spawnDetached(packagePath, []);
        return;
    }
    await spawnDetached("xdg-open", [packagePath]);
}
function spawnDetached(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
    });
}
//# sourceMappingURL=update.js.map