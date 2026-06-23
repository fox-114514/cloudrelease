import { app, safeStorage } from "electron";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  BoundUserInfo,
  DevicePermissions,
  DeviceProfile,
  RendererSettings,
  SaveSettingsInput,
} from "./shared";

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
  boundUser?: BoundUserInfo;
  lastKnownProfile?: DeviceProfile;
  lastKnownPermissions?: DevicePermissions;
  permissionsFetchedAt?: string;
  /** Whether the user explicitly opted into plaintext HTTP for non-loopback hosts. */
  allowInsecureHttp?: boolean;
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
  // 0.5.1: default to https:// when no scheme is given. A missing scheme no
  // longer silently downgrades to plaintext; callers must opt in via the
  // allowInsecureHttp flag for non-loopback http:// URLs.
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/** True when host is loopback — http:// is safe because traffic never leaves the machine. */
function isLoopbackHost(baseUrl: string): boolean {
  try {
    const u = new URL(normalizeBaseUrl(baseUrl));
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Throws when the URL is a non-loopback http:// address and the caller has not
 * opted in. Loopback is always allowed. Use at every bind/login path so an
 * accidental `http://` typo never leaks the device token or member password.
 */
function assertExplicitInsecureHttp(
  baseUrl: string,
  opts: { allowInsecureHttp: boolean },
): void {
  let u: URL;
  try {
    u = new URL(normalizeBaseUrl(baseUrl));
  } catch {
    throw new Error("服务器地址无效");
  }
  if (u.protocol !== "http:") return;
  if (isLoopbackHost(baseUrl)) return;
  if (!opts.allowInsecureHttp) {
    throw new Error(
      "服务器地址使用了明文 http://，但未启用“允许不安全 HTTP”。" +
        "明文连接下 token、密码和图片均可能被窃听。" +
        "请改用 https://，或在受信 VPN/局域网场景下显式启用“允许不安全 HTTP”。",
    );
  }
}

/** True when the URL is http:// AND not loopback — UI shows persistent banner. */
function isInsecureHttpUrl(baseUrl: string): boolean {
  try {
    const u = new URL(normalizeBaseUrl(baseUrl));
    return u.protocol === "http:" && !isLoopbackHost(baseUrl);
  } catch {
    return false;
  }
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
    const insecureHttp = isInsecureHttpUrl(this.config.serverBaseUrl);
    const allowInsecureHttp = this.config.allowInsecureHttp === true;
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
          ? "系统加密不可用，设备 token 暂存于受限本地配置文件中。"
          : undefined,
      boundUser: this.config.boundUser,
      lastKnownProfile: this.config.lastKnownProfile,
      lastKnownPermissions: this.config.lastKnownPermissions,
      permissionsFetchedAt: this.config.permissionsFetchedAt,
      allowInsecureHttp,
      insecureHttpWarning: insecureHttp
        ? "⚠ 当前使用明文 HTTP。token、密码与图片可被同网段窃听，请尽快切换到 HTTPS 或仅在受信 VPN/局域网内继续使用。"
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
      const normalized = normalizeBaseUrl(input.serverBaseUrl);
      // If the new URL is a non-loopback http:// URL, require that the user
      // either already has allowInsecureHttp=true or is simultaneously setting
      // it to true in this same call.
      const allowInsecure = input.allowInsecureHttp ?? this.config.allowInsecureHttp === true;
      assertExplicitInsecureHttp(normalized, { allowInsecureHttp: allowInsecure });
      this.config.serverBaseUrl = normalized;
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
        throw new Error("排除目录必须位于监听目录内部,且不能等于监听目录");
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
    if (input.boundUser !== undefined) {
      this.config.boundUser = input.boundUser;
    }
    if (input.lastKnownProfile !== undefined) {
      this.config.lastKnownProfile = input.lastKnownProfile;
    }
    if (input.lastKnownPermissions !== undefined) {
      this.config.lastKnownPermissions = input.lastKnownPermissions;
    }
    if (input.permissionsFetchedAt !== undefined) {
      this.config.permissionsFetchedAt = input.permissionsFetchedAt;
    }
    if (input.allowInsecureHttp !== undefined) {
      this.config.allowInsecureHttp = input.allowInsecureHttp === true;
    }
    await this.persist();
  }

  async bindDevice(input: {
    serverBaseUrl: string;
    deviceId: string;
    deviceToken: string;
    deviceName: string;
    boundUser?: BoundUserInfo;
    lastKnownProfile?: DeviceProfile;
    lastKnownPermissions?: DevicePermissions;
    allowInsecureHttp?: boolean;
  }): Promise<void> {
    const normalized = normalizeBaseUrl(input.serverBaseUrl);
    // bindDevice is called after the server already minted the device token,
    // so the URL is implicitly authorised by the preceding bind/preview code
    // path. But we double-check here as a defensive guard in case someone
    // calls bindDevice directly from a new entry point.
    assertExplicitInsecureHttp(normalized, {
      allowInsecureHttp: input.allowInsecureHttp === true || this.config.allowInsecureHttp === true,
    });
    this.config.serverBaseUrl = normalized;
    this.config.deviceId = input.deviceId;
    this.config.deviceName = input.deviceName.trim() || defaultDeviceName();
    if (input.allowInsecureHttp === true) {
      this.config.allowInsecureHttp = true;
    }
    this.setDeviceToken(input.deviceToken);
    if (input.boundUser) this.config.boundUser = input.boundUser;
    if (input.lastKnownProfile) this.config.lastKnownProfile = input.lastKnownProfile;
    if (input.lastKnownPermissions) this.config.lastKnownPermissions = input.lastKnownPermissions;
    if (input.lastKnownPermissions) this.config.permissionsFetchedAt = new Date().toISOString();
    await this.persist();
  }

  async clearBinding(): Promise<void> {
    delete this.config.deviceId;
    delete this.config.encryptedDeviceToken;
    delete this.config.plainDeviceToken;
    delete this.config.boundUser;
    delete this.config.lastKnownProfile;
    delete this.config.lastKnownPermissions;
    delete this.config.permissionsFetchedAt;
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

export { normalizeBaseUrl, isLoopbackHost, assertExplicitInsecureHttp, isInsecureHttpUrl };

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
