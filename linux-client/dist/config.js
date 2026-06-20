import fs from "node:fs/promises";
import path from "node:path";
import { configDir, ensureDir, normalizeBaseUrl } from "./utils.js";
const DEFAULT_CONFIG = {
    autoUpload: true,
    autoReceive: true,
    uploadedHashes: [],
};
const CONFIG_FILE = "config.json";
function configPath() {
    return path.join(configDir(), CONFIG_FILE);
}
export async function loadConfig() {
    const file = configPath();
    try {
        const text = await fs.readFile(file, "utf-8");
        const parsed = JSON.parse(text);
        return {
            ...DEFAULT_CONFIG,
            ...parsed,
            uploadedHashes: parsed.uploadedHashes ?? [],
        };
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return { ...DEFAULT_CONFIG };
        }
        throw err;
    }
}
export async function saveConfig(config) {
    await ensureDir(configDir());
    await fs.writeFile(configPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}
export async function bindDevice(serverBaseUrl, bindCode, deviceName) {
    const url = normalizeBaseUrl(serverBaseUrl);
    const response = await fetch(`${url}/api/v1/devices/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            bindCode: bindCode.trim(),
            deviceName: deviceName.trim() || "Linux",
            platform: "linux",
            osVersion: `${process.platform} ${process.arch}`,
            appVersion: "0.3.0",
        }),
    });
    const body = (await response.json());
    if (!response.ok || !body.success || !body.data) {
        throw new Error(body.error?.message || `HTTP ${response.status}`);
    }
    return {
        serverBaseUrl: url,
        deviceId: body.data.deviceId,
        deviceToken: body.data.deviceToken,
        deviceName: deviceName.trim() || "Linux",
    };
}
export async function unbind() {
    const config = await loadConfig();
    config.device = undefined;
    config.uploadedHashes = [];
    await saveConfig(config);
}
//# sourceMappingURL=config.js.map