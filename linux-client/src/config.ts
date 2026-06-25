import fs from "node:fs/promises";
import path from "node:path";
import { assertExplicitInsecureHttp, configDir, defaultDownloadDir, ensureDir, normalizeBaseUrl } from "./utils.js";

export interface HttpSafetyOpts {
  /**
   * Whether the caller has explicitly opted into plaintext HTTP for non-
   * loopback hosts. Bind/preview/login/identity-refresh will reject http://
   * for non-loopback hosts unless this is true. Loopback is always allowed.
   */
  allowInsecureHttp?: boolean;
}

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
  /**
   * Whether the user explicitly allowed plaintext HTTP for the stored
   * serverBaseUrl. Set via the launch Web UI checkbox or the CLI's
   * --allow-insecure-http flag at bind time. Refreshes against an already-
   * bound device inherit this setting.
   */
  allowInsecureHttp: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
  autoUpload: true,
  autoReceive: true,
  copyToClipboard: true,
  uploadedHashes: [],
  receivedHashes: [],
  allowInsecureHttp: false,
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
      allowInsecureHttp: parsed.allowInsecureHttp === true,
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
  opts: HttpSafetyOpts = {},
): Promise<DeviceConfig> {
  const url = normalizeBaseUrl(serverBaseUrl);
  assertExplicitInsecureHttp(url, { allowInsecureHttp: opts.allowInsecureHttp === true });
  const response = await fetch(`${url}/api/v1/devices/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bindCode: bindCode.trim(),
      deviceName: deviceName.trim() || "Linux",
      platform: "linux",
      osVersion: `${process.platform} ${process.arch}`,
      appVersion: "0.5.1",
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

export async function previewBindCode(
  serverBaseUrl: string,
  bindCode: string,
  opts: HttpSafetyOpts = {},
): Promise<BindCodePreview> {
  const url = normalizeBaseUrl(serverBaseUrl);
  assertExplicitInsecureHttp(url, { allowInsecureHttp: opts.allowInsecureHttp === true });
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
  opts: HttpSafetyOpts = {},
): Promise<DeviceConfig> {
  const url = normalizeBaseUrl(serverBaseUrl);
  assertExplicitInsecureHttp(url, { allowInsecureHttp: opts.allowInsecureHttp === true });
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
  const preview = await previewBindCode(url, code.bindCode, opts);
  if (preview.targetUser.id !== loginData.user.id) {
    throw new Error("Binding preview target does not match the logged-in account");
  }
  return bindDevice(url, code.bindCode, deviceName, profile, opts);
}

export async function refreshDeviceIdentity(
  device: DeviceConfig,
  opts: HttpSafetyOpts = {},
): Promise<DeviceConfig> {
  const url = normalizeBaseUrl(device.serverBaseUrl);
  // R0-2: a 0.5.0 config migrated to 0.5.1 may have a non-loopback http://
  // URL with allowInsecureHttp still false. Refuse to ship the device token
  // until the user re-binds with --allow-insecure-http or switches to https.
  assertExplicitInsecureHttp(url, { allowInsecureHttp: opts.allowInsecureHttp === true });
  const response = await fetch(`${url}/api/v1/devices/me`, {
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
