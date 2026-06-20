import fs from "node:fs/promises";
import path from "node:path";
import { configDir, ensureDir, normalizeBaseUrl } from "./utils.js";

export interface DeviceConfig {
  serverBaseUrl: string;
  deviceId: string;
  deviceToken: string;
  deviceName: string;
}

export interface AppConfig {
  device?: DeviceConfig;
  autoUpload: boolean;
  autoReceive: boolean;
  watchDir?: string;
  downloadDir?: string;
  uploadedHashes: string[];
}

const DEFAULT_CONFIG: AppConfig = {
  autoUpload: true,
  autoReceive: true,
  uploadedHashes: [],
};

const CONFIG_FILE = "config.json";

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
      uploadedHashes: parsed.uploadedHashes ?? [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }
    throw err;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureDir(configDir());
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function bindDevice(
  serverBaseUrl: string,
  bindCode: string,
  deviceName: string
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
      appVersion: "0.4.0",
    }),
  });

  const body = (await response.json()) as {
    success: boolean;
    data?: { deviceId: string; deviceToken: string };
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
  };
}

export async function unbind(): Promise<void> {
  const config = await loadConfig();
  config.device = undefined;
  config.uploadedHashes = [];
  await saveConfig(config);
}
