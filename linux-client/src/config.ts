import fs from "node:fs/promises";
import path from "node:path";
import { configDir, defaultDownloadDir, ensureDir, normalizeBaseUrl } from "./utils.js";

export interface DeviceConfig {
  serverBaseUrl: string;
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  user?: BoundUserInfo;
  profile?: string;
  permissions?: DevicePermissions;
  permissionsFetchedAt?: string;
}

export interface BoundUserInfo {
  id: string;
  ownerUserId: string;
  role: string;
  displayName?: string;
}

export interface DevicePermissions {
  canAutoUpload: boolean;
  canManualUpload: boolean;
  canAutoReceive: boolean;
  canManualDownload: boolean;
  canManageSpace: boolean;
  canCreateInvite: boolean;
  autoUploadScope: string;
  autoReceiveScope: string;
}

export interface BindCodePreview {
  expiresAt: string;
  space: { ownerUserId: string; displayName: string };
  targetUser: { id: string; role: string; displayName?: string };
}

export interface AppConfig {
  device?: DeviceConfig;
  autoUpload: boolean;
  autoReceive: boolean;
  copyToClipboard: boolean;
  watchDir?: string;
  downloadDir?: string;
  uploadedHashes: string[];
  receivedHashes: string[];
}

const DEFAULT_CONFIG: AppConfig = {
  autoUpload: true,
  autoReceive: true,
  copyToClipboard: true,
  uploadedHashes: [],
  receivedHashes: [],
};

const CONFIG_FILE = "config.json";
let saveChain: Promise<void> = Promise.resolve();

function configPath(): string {
  return path.join(configDir(), CONFIG_FILE);
}

export async function loadConfig(): Promise<AppConfig> {
  const file = configPath();
  try {
    const text = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(text) as Partial<AppConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      downloadDir: parsed.downloadDir?.trim() || defaultDownloadDir(),
      uploadedHashes: parsed.uploadedHashes ?? [],
      receivedHashes: parsed.receivedHashes ?? [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_CONFIG, downloadDir: defaultDownloadDir() };
    }
    throw err;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
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

export async function bindDevice(
  serverBaseUrl: string,
  bindCode: string,
  deviceName: string,
  profile = "receive_own",
): Promise<DeviceConfig> {
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

  const body = (await response.json()) as {
    success: boolean;
    data?: {
      deviceId: string;
      deviceToken: string;
      user: BoundUserInfo;
      profile: string;
      permissions: DevicePermissions;
    };
    error?: { code: string; message: string };
  };

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

async function parseData<T>(response: Response): Promise<T> {
  const body = await response.json() as {
    success?: boolean;
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (!response.ok || body.success !== true || body.data === undefined) {
    throw new Error(body.error?.message || `HTTP ${response.status}`);
  }
  return body.data;
}

export async function previewBindCode(serverBaseUrl: string, bindCode: string): Promise<BindCodePreview> {
  const url = normalizeBaseUrl(serverBaseUrl);
  const response = await fetch(`${url}/api/v1/bind-codes/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bindCode: bindCode.trim() }),
  });
  return parseData<BindCodePreview>(response);
}

export async function bindWithLogin(
  serverBaseUrl: string,
  login: string,
  password: string,
  deviceName: string,
  profile = "receive_own",
): Promise<DeviceConfig> {
  const url = normalizeBaseUrl(serverBaseUrl);
  const loginResponse = await fetch(`${url}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: login.trim(), password }),
  });
  const loginData = await parseData<{
    accessToken: string;
    user: { id: string };
  }>(loginResponse);
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
  const code = await parseData<{
    bindCode: string;
    targetUser?: { id: string };
  }>(codeResponse);
  if (code.targetUser && code.targetUser.id !== loginData.user.id) {
    throw new Error("Binding code target does not match the logged-in account");
  }
  const preview = await previewBindCode(url, code.bindCode);
  if (preview.targetUser.id !== loginData.user.id) {
    throw new Error("Binding preview target does not match the logged-in account");
  }
  return bindDevice(url, code.bindCode, deviceName, profile);
}

export async function refreshDeviceIdentity(device: DeviceConfig): Promise<DeviceConfig> {
  const response = await fetch(`${normalizeBaseUrl(device.serverBaseUrl)}/api/v1/devices/me`, {
    headers: { Authorization: `Bearer ${device.deviceToken}` },
  });
  const data = await parseData<{
    device: { id: string; name: string };
    user: BoundUserInfo;
    profile: string;
    permissions: DevicePermissions;
  }>(response);
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

export function serverAllows(
  device: DeviceConfig,
  permission: "canAutoUpload" | "canManualUpload" | "canAutoReceive",
): boolean {
  return device.permissions?.[permission] !== false;
}

export async function unbind(): Promise<void> {
  const config = await loadConfig();
  config.device = undefined;
  config.uploadedHashes = [];
  config.receivedHashes = [];
  await saveConfig(config);
}
