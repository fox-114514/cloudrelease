import { app, safeStorage } from "electron";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RendererSettings, SaveSettingsInput } from "./shared";

interface StoredConfig {
  serverBaseUrl: string;
  deviceId?: string;
  deviceName: string;
  downloadDir: string;
  watchDir: string;
  watchExcludedDirs: string[];
  autoReceive: boolean;
  autoUpload: boolean;
  copyToClipboard: boolean;
  showNotification: boolean;
  startAtLogin: boolean;
  encryptedDeviceToken?: string;
  plainDeviceToken?: string;
  tokenStorage: "safeStorage" | "plainFile" | "none";
}

const CONFIG_FILE = "config.json";

function defaultDownloadDir(): string {
  return path.join(app.getPath("pictures"), "StudyShot Relay");
}

function defaultWatchDir(): string {
  return path.join(app.getPath("pictures"), "Screenshots");
}

function defaultDeviceName(): string {
  return `${os.hostname()} ${process.platform === "win32" ? "Windows" : "Linux"}`;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export class ConfigStore {
  private readonly configPath: string;
  private config: StoredConfig;

  constructor() {
    this.configPath = path.join(app.getPath("userData"), CONFIG_FILE);
    this.config = {
      serverBaseUrl: "",
      deviceName: defaultDeviceName(),
      downloadDir: defaultDownloadDir(),
      watchDir: defaultWatchDir(),
      watchExcludedDirs: [],
      autoReceive: true,
      autoUpload: false,
      copyToClipboard: true,
      showNotification: true,
      startAtLogin: false,
      tokenStorage: "none",
    };
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredConfig>;
      this.config = {
        ...this.config,
        ...parsed,
        serverBaseUrl: normalizeBaseUrl(parsed.serverBaseUrl ?? this.config.serverBaseUrl),
        watchExcludedDirs: normalizeExcludedDirs(
          parsed.watchDir ?? this.config.watchDir,
          parsed.watchExcludedDirs ?? [],
        ),
        tokenStorage: parsed.tokenStorage ?? "none",
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  get settings(): RendererSettings {
    return {
      serverBaseUrl: this.config.serverBaseUrl,
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName,
      downloadDir: this.config.downloadDir,
      watchDir: this.config.watchDir,
      watchExcludedDirs: this.config.watchExcludedDirs,
      autoReceive: this.config.autoReceive,
      autoUpload: this.config.autoUpload,
      copyToClipboard: this.config.copyToClipboard,
      showNotification: this.config.showNotification,
      startAtLogin: this.config.startAtLogin,
      isBound: Boolean(this.config.deviceId && this.hasStoredToken()),
      tokenStorage: this.config.tokenStorage,
      tokenStorageWarning:
        this.config.tokenStorage === "plainFile"
          ? "系统加密不可用，设备 token 暂存在受限本地配置文件中。"
          : undefined,
    };
  }

  get serverBaseUrl(): string {
    return this.config.serverBaseUrl;
  }

  get deviceId(): string | undefined {
    return this.config.deviceId;
  }

  get deviceName(): string {
    return this.config.deviceName;
  }

  get downloadDir(): string {
    return this.config.downloadDir;
  }

  get watchDir(): string {
    return this.config.watchDir;
  }

  get watchExcludedDirs(): string[] {
    return [...this.config.watchExcludedDirs];
  }

  get autoReceive(): boolean {
    return this.config.autoReceive;
  }

  get autoUpload(): boolean {
    return this.config.autoUpload;
  }

  get copyToClipboard(): boolean {
    return this.config.copyToClipboard;
  }

  get showNotification(): boolean {
    return this.config.showNotification;
  }

  async saveSettings(input: SaveSettingsInput): Promise<void> {
    if (input.serverBaseUrl !== undefined) {
      this.config.serverBaseUrl = normalizeBaseUrl(input.serverBaseUrl);
    }
    if (input.deviceName !== undefined) {
      this.config.deviceName = input.deviceName.trim() || defaultDeviceName();
    }
    if (input.downloadDir !== undefined) {
      const trimmed = input.downloadDir.trim();
      if (!trimmed) {
        throw new Error("下载目录不能为空");
      }
      this.config.downloadDir = trimmed;
    }
    if (input.watchDir !== undefined) {
      const trimmed = input.watchDir.trim();
      if (!trimmed) {
        throw new Error("监听目录不能为空");
      }
      this.config.watchDir = trimmed;
      this.config.watchExcludedDirs = normalizeExcludedDirs(
        trimmed,
        this.config.watchExcludedDirs,
      );
    }
    if (input.watchExcludedDirs !== undefined) {
      const normalized = normalizeExcludedDirs(this.config.watchDir, input.watchExcludedDirs);
      if (normalized.length !== input.watchExcludedDirs.length) {
        throw new Error("排除目录必须位于监听目录内部，且不能等于监听目录");
      }
      this.config.watchExcludedDirs = normalized;
    }
    if (input.autoReceive !== undefined) {
      this.config.autoReceive = input.autoReceive;
    }
    if (input.autoUpload !== undefined) {
      this.config.autoUpload = input.autoUpload;
    }
    if (input.copyToClipboard !== undefined) {
      this.config.copyToClipboard = input.copyToClipboard;
    }
    if (input.showNotification !== undefined) {
      this.config.showNotification = input.showNotification;
    }
    if (input.startAtLogin !== undefined) {
      this.config.startAtLogin = input.startAtLogin;
      app.setLoginItemSettings({ openAtLogin: input.startAtLogin });
    }
    await this.persist();
  }

  async bindDevice(input: {
    serverBaseUrl: string;
    deviceId: string;
    deviceToken: string;
    deviceName: string;
  }): Promise<void> {
    this.config.serverBaseUrl = normalizeBaseUrl(input.serverBaseUrl);
    this.config.deviceId = input.deviceId;
    this.config.deviceName = input.deviceName.trim() || defaultDeviceName();
    this.setDeviceToken(input.deviceToken);
    await this.persist();
  }

  async clearBinding(): Promise<void> {
    delete this.config.deviceId;
    delete this.config.encryptedDeviceToken;
    delete this.config.plainDeviceToken;
    this.config.tokenStorage = "none";
    await this.persist();
  }

  getDeviceToken(): string | undefined {
    if (this.config.encryptedDeviceToken) {
      try {
        return safeStorage.decryptString(Buffer.from(this.config.encryptedDeviceToken, "base64"));
      } catch {
        return undefined;
      }
    }
    return this.config.plainDeviceToken;
  }

  private hasStoredToken(): boolean {
    return Boolean(this.config.encryptedDeviceToken || this.config.plainDeviceToken);
  }

  private setDeviceToken(token: string): void {
    delete this.config.encryptedDeviceToken;
    delete this.config.plainDeviceToken;

    if (safeStorage.isEncryptionAvailable()) {
      this.config.encryptedDeviceToken = safeStorage.encryptString(token).toString("base64");
      this.config.tokenStorage = "safeStorage";
      return;
    }

    this.config.plainDeviceToken = token;
    this.config.tokenStorage = "plainFile";
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`, {
      mode: 0o600,
    });
    try {
      await chmod(this.configPath, 0o600);
    } catch {
      // Windows does not use POSIX file modes.
    }
  }
}

export { normalizeBaseUrl };

function normalizeExcludedDirs(watchDir: string, candidates: string[]): string[] {
  const root = path.resolve(watchDir);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate.trim());
    const relative = path.relative(root, resolved);
    const isDescendant = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    if (!isDescendant) continue;
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result.sort((a, b) => a.localeCompare(b));
}
