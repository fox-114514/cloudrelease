import fs from "node:fs/promises";
import path from "node:path";
import { configDir, defaultDownloadDir, ensureDir, normalizeBaseUrl } from "./utils.js";
const DEFAULT_CONFIG = {
    autoUpload: true,
    autoReceive: true,
    copyToClipboard: true,
    uploadedHashes: [],
    receivedHashes: [],
};
const CONFIG_FILE = "config.json";
let saveChain = Promise.resolve();
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
            downloadDir: parsed.downloadDir?.trim() || defaultDownloadDir(),
            uploadedHashes: parsed.uploadedHashes ?? [],
            receivedHashes: parsed.receivedHashes ?? [],
        };
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return { ...DEFAULT_CONFIG, downloadDir: defaultDownloadDir() };
        }
        throw err;
    }
}
export async function saveConfig(config) {
    const serialized = JSON.stringify(config, null, 2);
    const run = saveChain.catch(() => undefined).then(async () => {
        await ensureDir(configDir());
        const target = configPath();
        const temporary = `${target}.${process.pid}.tmp`;
        await fs.writeFile(temporary, serialized, { mode: 0o600 });
        await fs.rename(temporary, target);
    });
    saveChain = run;
    await run;
}
export async function bindDevice(serverBaseUrl, bindCode, deviceName, profile = "receive_own") {
    const url = normalizeBaseUrl(serverBaseUrl);
    const response = await fetch(`${url}/api/v1/devices/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            bindCode: bindCode.trim(),
            deviceName: deviceName.trim() || "Linux",
            platform: "linux",
            osVersion: `${process.platform} ${process.arch}`,
            appVersion: "0.5.0",
            profile,
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
        user: body.data.user,
        profile: body.data.profile,
        permissions: body.data.permissions,
        permissionsFetchedAt: new Date().toISOString(),
    };
}
async function parseData(response) {
    const body = await response.json();
    if (!response.ok || body.success !== true || body.data === undefined) {
        throw new Error(body.error?.message || `HTTP ${response.status}`);
    }
    return body.data;
}
export async function previewBindCode(serverBaseUrl, bindCode) {
    const url = normalizeBaseUrl(serverBaseUrl);
    const response = await fetch(`${url}/api/v1/bind-codes/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bindCode: bindCode.trim() }),
    });
    return parseData(response);
}
export async function bindWithLogin(serverBaseUrl, login, password, deviceName, profile = "receive_own") {
    const url = normalizeBaseUrl(serverBaseUrl);
    const loginResponse = await fetch(`${url}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim(), password }),
    });
    const loginData = await parseData(loginResponse);
    const codeResponse = await fetch(`${url}/api/v1/bind-codes`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${loginData.accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            purpose: "bind_device",
            deviceNameHint: deviceName,
            expiresInSeconds: 600,
        }),
    });
    const code = await parseData(codeResponse);
    if (code.targetUser && code.targetUser.id !== loginData.user.id) {
        throw new Error("Binding code target does not match the logged-in account");
    }
    const preview = await previewBindCode(url, code.bindCode);
    if (preview.targetUser.id !== loginData.user.id) {
        throw new Error("Binding preview target does not match the logged-in account");
    }
    return bindDevice(url, code.bindCode, deviceName, profile);
}
export async function refreshDeviceIdentity(device) {
    const response = await fetch(`${normalizeBaseUrl(device.serverBaseUrl)}/api/v1/devices/me`, {
        headers: { Authorization: `Bearer ${device.deviceToken}` },
    });
    const data = await parseData(response);
    return {
        ...device,
        deviceId: data.device.id,
        deviceName: data.device.name,
        user: data.user,
        profile: data.profile,
        permissions: data.permissions,
        permissionsFetchedAt: new Date().toISOString(),
    };
}
export function serverAllows(device, permission) {
    return device.permissions?.[permission] !== false;
}
export async function unbind() {
    const config = await loadConfig();
    config.device = undefined;
    config.uploadedHashes = [];
    config.receivedHashes = [];
    await saveConfig(config);
}
//# sourceMappingURL=config.js.map