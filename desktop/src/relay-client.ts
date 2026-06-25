import { clipboard, nativeImage, Notification } from "electron";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import WebSocket from "ws";
import type { ConfigStore } from "./config-store";
import { assertExplicitInsecureHttp, normalizeBaseUrl } from "./url-safety";
import type { HistoryStore } from "./history-store";
import { logError, logInfo, logWarn } from "./logger";
import type {
  AdminLoginInput,
  AdminState,
  AppUpdateInfo,
  BindCodePreview,
  BindCodeTargetUser,
  BoundUserInfo,
  ConnectionState,
  CreateBindCodeInput,
  CreateBindCodeResult,
  DeliveryPayload,
  DevicePermissions,
  DeviceProfile,
  DeviceSelfInfo,
  DownloadRecord,
  ImageCreatedEvent,
  ManualUploadResult,
  ImageLibraryPage,
  LibraryImage,
  ManualLibraryDownloadResult,
  ManagedDevice,
  Platform,
  RegisterDeviceInput,
  RendererState,
  WatchState,
  WatchUploadEvent,
} from "./shared";
import { CLIENT_VERSION } from "./shared";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface RegisterDeviceResponse {
  deviceId: string;
  deviceToken: string;
  profile?: DeviceProfile;
  permissions: DevicePermissions;
  user: BoundUserInfo;
}

interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    ownerUserId: string;
    role: string;
    emailOrLogin?: string;
    displayName?: string;
  };
}

interface CreateBindCodeResponse {
  bindCode: string;
  expiresAt: string;
  targetUser?: BindCodeTargetUser;
}

interface PendingDeliveriesResponse {
  deliveries: DeliveryPayload[];
  totalPending?: number;
  hasMore?: boolean;
}

interface DevicesResponse {
  devices: ManagedDevice[];
}

interface UploadImageResponse {
  imageId: string;
  deduplicated: boolean;
  createdDeliveriesCount: number;
  expiresAt: string;
}

interface ImageLibraryResponse extends ImageLibraryPage {}

type StateListener = (state: RendererState) => void;
type UpdateListener = (release: AppUpdateInfo) => void;

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function apiUrl(baseUrl: string, pathname: string): string {
  return `${normalizeBaseUrl(baseUrl)}${pathname}`;
}

function wsUrl(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/v1/ws";
  url.search = "";
  return url.toString();
}

function currentPlatform(): Platform {
  return process.platform === "win32" ? "windows" : "linux";
}

function currentUpdateChannel(): "windows" | "linux-desktop" {
  return process.platform === "win32" ? "windows" : "linux-desktop";
}

function sanitizeFilePart(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 80) || "unknown-device";
}

function extensionForMime(mimeType: string): string {
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

function detectImageMimeType(buffer: Buffer): string | undefined {
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

function formatTimestamp(input: string): string {
  const date = Number.isNaN(Date.parse(input)) ? new Date() : new Date(input);
  const pad = (value: number): string => String(value).padStart(2, "0");
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

async function writeFileExclusive(target: string, data: Buffer): Promise<void> {
  // O_EXCL: open fails if the path already exists. The caller (writeFileWithRetry)
  // catches EEXIST and bumps the suffix, so two concurrent deliveries can't
  // both end up writing to the same path.
  const handle = await fs.open(target, "wx", 0o600);
  try {
    await handle.writeFile(data);
  } catch (err) {
    await handle.close().catch(() => undefined);
    try {
      await fs.unlink(target);
    } catch {
      // ignore
    }
    throw err;
  }
  await handle.close();
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function writeFileWithUniqueSuffix(basePath: string, data: Buffer): Promise<string> {
  const parsed = path.parse(basePath);
  let lastError: unknown;
  for (let index = 0; index < 1000; index += 1) {
    const candidate =
      index === 0
        ? basePath
        : path.join(parsed.dir, `${parsed.name}-${String(index + 1).padStart(2, "0")}${parsed.ext}`);
    try {
      await writeFileExclusive(candidate, data);
      return candidate;
    } catch (err) {
      lastError = err;
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to allocate a unique file name");
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: ApiEnvelope<T>;
  if (!text) {
    body = { success: true } as ApiEnvelope<T>;
  } else {
    try {
      body = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      // Reverse proxy / CDN error pages come back as HTML. Wrap so the user
      // sees a meaningful error instead of "Unexpected token <".
      throw new ApiError(
        response.status,
        "INVALID_RESPONSE",
        `Server returned non-JSON response (HTTP ${response.status})`,
      );
    }
  }
  if (!response.ok || !body.success) {
    throw new ApiError(
      response.status,
      body.error?.code ?? `HTTP_${response.status}`,
      body.error?.message ?? response.statusText
    );
  }
  return body.data as T;
}

class LruSet<T> {
  private readonly map = new Map<T, true>();
  constructor(private readonly maxSize: number) {}
  add(value: T): void {
    if (this.map.has(value)) {
      this.map.delete(value);
    }
    this.map.set(value, true);
    while (this.map.size > this.maxSize) {
      const first = this.map.keys().next().value;
      if (first !== undefined) {
        this.map.delete(first);
      }
    }
  }
  has(value: T): boolean {
    return this.map.has(value);
  }
}

export class RelayClient {
  private socket?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelayMs = 1000;
  private lastMessageAt = 0;
  private processingDeliveries = new Set<string>();
  private completedDeliveries = new LruSet<string>(5000);
  private receivedHashes = new LruSet<string>(5000);
  private pendingOfflineCount = 0;
  private deliveryChain: Promise<void> = Promise.resolve();
  private stateListener?: StateListener;
  private updateListener?: UpdateListener;
  private connection: ConnectionState = { status: "idle" };
  private adminToken?: string;
  private admin: AdminState = {
    isLoggedIn: false,
    devices: [],
  };
  private watch: WatchState = {
    enabled: false,
    active: false,
    dir: "",
    recentUploads: [],
  };

  updateWatchState(patch: Partial<WatchState>): void {
    this.watch = { ...this.watch, ...patch };
    this.emitState();
  }

  appendWatchUpload(event: WatchUploadEvent): void {
    this.watch = {
      ...this.watch,
      recentUploads: [event, ...this.watch.recentUploads].slice(0, 30),
      lastEvent: event.uploadedAt,
    };
    this.emitState();
  }

  hideWatchUpload(uploadedAt: string): void {
    this.watch = {
      ...this.watch,
      recentUploads: this.watch.recentUploads.filter((event) => event.uploadedAt !== uploadedAt),
    };
    this.emitState();
  }

  clearWatchUploads(): void {
    this.watch = { ...this.watch, recentUploads: [] };
    this.emitState();
  }

  get watchState(): WatchState {
    return this.watch;
  }

  constructor(
    private readonly config: ConfigStore,
    private readonly history: HistoryStore
  ) {
    for (const record of history.list()) {
      if (record.sha256) this.receivedHashes.add(record.sha256);
    }
  }

  onState(listener: StateListener): void {
    this.stateListener = listener;
    this.emitState();
  }

  onUpdate(listener: UpdateListener): void {
    this.updateListener = listener;
  }

  getState(): RendererState {
    return {
      settings: this.config.settings,
      connection: this.connection,
      recentDownloads: this.history.list(),
      pendingOfflineCount: this.pendingOfflineCount,
      admin: this.admin,
      watch: this.watch,
    };
  }

  /**
   * R0-2: gate any token-bearing request against the stored authorization.
   * A 0.5.0 config migrated to 0.5.1 may have a non-loopback http:// URL with
   * allowInsecureHttp still false; until the user confirms in the UI we must
   * not send the device token over plaintext. Bind/login paths use their own
   * assertExplicitInsecureHttp call because they carry fresh input.
   */
  private assertHttpAuthorized(): void {
    const s = this.config.settings;
    assertExplicitInsecureHttp(s.serverBaseUrl, {
      allowInsecureHttp: s.allowInsecureHttp,
    });
  }

  async registerDevice(input: RegisterDeviceInput): Promise<DeviceSelfInfo> {
    const serverBaseUrl = normalizeBaseUrl(input.serverBaseUrl);
    if (!serverBaseUrl) {
      throw new Error("服务器地址不能为空");
    }
    if (!input.bindCode.trim()) {
      throw new Error("绑定码不能为空");
    }
    assertExplicitInsecureHttp(serverBaseUrl, {
      allowInsecureHttp: input.allowInsecureHttp === true,
    });

    const body: Record<string, unknown> = {
      bindCode: input.bindCode.trim(),
      deviceName: input.deviceName.trim() || os.hostname(),
      platform: currentPlatform(),
      osVersion: `${os.type()} ${os.release()}`,
      appVersion: CLIENT_VERSION,
    };
    if (input.profile) {
      body.profile = input.profile;
    }
    const response = await fetch(apiUrl(serverBaseUrl, "/api/v1/devices/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await parseEnvelope<RegisterDeviceResponse>(response);
    await this.config.bindDevice({
      serverBaseUrl,
      deviceId: data.deviceId,
      deviceToken: data.deviceToken,
      deviceName: input.deviceName.trim() || os.hostname(),
      boundUser: data.user,
      lastKnownProfile: data.profile ?? "custom",
      lastKnownPermissions: data.permissions,
      // R0-1: propagate the same authorization that gated the request, so the
      // local persist step doesn't reject a URL the server already acted on.
      allowInsecureHttp: input.allowInsecureHttp === true || this.config.settings.allowInsecureHttp,
    });
    logInfo("Device registered", { serverBaseUrl, deviceId: data.deviceId });
    this.emitState();

    this.connect();

    return {
      device: {
        id: data.deviceId,
        name: input.deviceName.trim() || os.hostname(),
        platform: currentPlatform(),
        appVersion: CLIENT_VERSION,
        osVersion: `${os.type()} ${os.release()}`,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      },
      user: data.user,
      profile: data.profile ?? "custom",
      permissions: data.permissions,
    };
  }

  async previewBindCode(
    serverBaseUrl: string,
    bindCode: string,
    opts: { allowInsecureHttp?: boolean } = {},
  ): Promise<BindCodePreview> {
    const normalized = normalizeBaseUrl(serverBaseUrl);
    if (!normalized) {
      throw new Error("服务器地址不能为空");
    }
    if (!bindCode.trim()) {
      throw new Error("绑定码不能为空");
    }
    assertExplicitInsecureHttp(normalized, {
      allowInsecureHttp: opts.allowInsecureHttp === true,
    });
    const response = await fetch(apiUrl(normalized, "/api/v1/bind-codes/preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bindCode: bindCode.trim() }),
    });
    return parseEnvelope<BindCodePreview>(response);
  }

  async getDeviceMe(): Promise<DeviceSelfInfo> {
    this.assertHttpAuthorized();
    const token = this.config.getDeviceToken();
    const serverBaseUrl = this.config.serverBaseUrl;
    if (!token || !serverBaseUrl) {
      throw new Error("设备未绑定");
    }
    const response = await fetch(apiUrl(serverBaseUrl, "/api/v1/devices/me"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await parseEnvelope<DeviceSelfInfo>(response);
    await this.config.saveSettings({
      boundUser: data.user,
      lastKnownProfile: data.profile,
      lastKnownPermissions: data.permissions,
      permissionsFetchedAt: new Date().toISOString(),
    });
    if (!data.permissions.canAutoReceive) {
      this.disconnect();
    }
    this.emitState();
    return data;
  }

  async refreshEffectivePermissions(): Promise<DeviceSelfInfo | undefined> {
    if (!this.config.serverBaseUrl || !this.config.getDeviceToken()) {
      return undefined;
    }
    try {
      return await this.getDeviceMe();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        // Auth failure likely means the device was revoked or disabled; the
        // UI should stop the watcher/receiver and prompt for rebind. Set the
        // connection error BEFORE clearBinding so the renderer keeps the
        // reason visible next to the bind form (plan 0.5.1 §2.4.4).
        this.disconnect();
        this.setConnection({
          status: "stopped",
          lastError: "设备已被撤销或凭证失效，请重新绑定",
        });
        await this.config.clearBinding();
        this.emitState();
      }
      throw err;
    }
  }

  async updateDeviceProfile(profile: DeviceProfile): Promise<void> {
    await this.adminUpdateDeviceProfile(this.requireDeviceId(), profile);
  }

  async adminUpdateDeviceProfile(deviceId: string, profile: DeviceProfile): Promise<void> {
    const token = this.requireAdminToken();
    if (!this.config.serverBaseUrl) throw new Error("服务器地址不能为空");
    const response = await fetch(
      apiUrl(this.config.serverBaseUrl, `/api/v1/devices/${deviceId}/profile`),
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      },
    );
    await parseEnvelope<unknown>(response);
    await this.adminRefreshDevices();
    if (deviceId === this.config.settings.deviceId) {
      await this.refreshEffectivePermissions();
    }
  }

  async updateReceiveConfig(
    mode: "disabled" | "same_user_only" | "selected_devices" | "all_authorized_sources",
    sourceDeviceIds: string[] = []
  ): Promise<void> {
    await this.adminUpdateReceiveConfig(this.requireDeviceId(), mode, sourceDeviceIds);
  }

  async adminUpdateReceiveConfig(
    deviceId: string,
    mode: "disabled" | "same_user_only" | "selected_devices" | "all_authorized_sources",
    sourceDeviceIds: string[] = []
  ): Promise<void> {
    const token = this.requireAdminToken();
    if (!this.config.serverBaseUrl) throw new Error("服务器地址不能为空");
    const response = await fetch(
      apiUrl(this.config.serverBaseUrl, `/api/v1/devices/${deviceId}/receive-config`),
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mode, sourceDeviceIds }),
      },
    );
    await parseEnvelope<unknown>(response);
    await this.adminRefreshDevices();
    if (deviceId === this.config.settings.deviceId) {
      await this.refreshEffectivePermissions();
    }
  }

  async createBindCodeWithLogin(input: CreateBindCodeInput): Promise<CreateBindCodeResult> {
    const serverBaseUrl = normalizeBaseUrl(input.serverBaseUrl);
    if (!serverBaseUrl) {
      throw new Error("服务器地址不能为空");
    }
    if (!input.login.trim() || !input.password) {
      throw new Error("主用户登录名和密码不能为空");
    }
    assertExplicitInsecureHttp(serverBaseUrl, {
      allowInsecureHttp: input.allowInsecureHttp === true,
    });

    const loginResponse = await fetch(apiUrl(serverBaseUrl, "/api/v1/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: input.login.trim(),
        password: input.password,
      }),
    });
    const loginData = await parseEnvelope<LoginResponse>(loginResponse);

    const bindResponse = await fetch(apiUrl(serverBaseUrl, "/api/v1/bind-codes"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${loginData.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        purpose: "bind_device",
        deviceNameHint: input.deviceNameHint,
        expiresInSeconds: 600,
      }),
    });
    const bindData = await parseEnvelope<CreateBindCodeResponse>(bindResponse);
    await this.config.saveSettings({
      serverBaseUrl,
      deviceName: input.deviceNameHint,
      allowInsecureHttp: input.allowInsecureHttp === true || this.config.settings.allowInsecureHttp,
    });
    this.emitState();
    logInfo("Bind code created with owner login", { serverBaseUrl });
    return bindData;
  }

  async bindWithLogin(input: CreateBindCodeInput): Promise<DeviceSelfInfo> {
    const serverBaseUrl = normalizeBaseUrl(input.serverBaseUrl);
    if (!serverBaseUrl) {
      throw new Error("服务器地址不能为空");
    }
    if (!input.login.trim() || !input.password) {
      throw new Error("成员账号和密码不能为空");
    }
    assertExplicitInsecureHttp(serverBaseUrl, {
      allowInsecureHttp: input.allowInsecureHttp === true,
    });
    const loginResponse = await fetch(apiUrl(serverBaseUrl, "/api/v1/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: input.login.trim(), password: input.password }),
    });
    const loginData = await parseEnvelope<LoginResponse>(loginResponse);

    const bindResponse = await fetch(apiUrl(serverBaseUrl, "/api/v1/bind-codes"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${loginData.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        purpose: "bind_device",
        deviceNameHint: input.deviceNameHint,
        expiresInSeconds: 600,
      }),
    });
    const bindData = await parseEnvelope<CreateBindCodeResponse>(bindResponse);

    if (bindData.targetUser && bindData.targetUser.id !== loginData.user.id) {
      throw new Error("服务端返回的绑定码不属于当前账号，已中止绑定");
    }

    const preview = await this.previewBindCode(serverBaseUrl, bindData.bindCode, {
      allowInsecureHttp: input.allowInsecureHttp === true,
    });
    if (preview.targetUser.id !== loginData.user.id) {
      throw new Error("绑定码预览身份与当前账号不一致，已中止绑定");
    }

    const self = await this.registerDevice({
      serverBaseUrl,
      bindCode: bindData.bindCode,
      deviceName: input.deviceNameHint ?? os.hostname(),
      profile: input.profile,
      allowInsecureHttp: input.allowInsecureHttp === true,
    });
    logInfo("Member bind-with-login succeeded", { userId: loginData.user.id });
    return self;
  }

  private requireDeviceId(): string {
    const id = this.config.settings.deviceId;
    if (!id) {
      throw new Error("设备未绑定");
    }
    return id;
  }

  async adminLogin(input: AdminLoginInput): Promise<void> {
    const serverBaseUrl = normalizeBaseUrl(input.serverBaseUrl);
    if (!serverBaseUrl) {
      throw new Error("服务器地址不能为空");
    }
    if (!input.login.trim() || !input.password) {
      throw new Error("登录名和密码不能为空");
    }
    assertExplicitInsecureHttp(serverBaseUrl, {
      allowInsecureHttp: input.allowInsecureHttp === true || this.config.settings.allowInsecureHttp,
    });

    const response = await fetch(apiUrl(serverBaseUrl, "/api/v1/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: input.login.trim(),
        password: input.password,
      }),
    });
    const data = await parseEnvelope<LoginResponse>(response);
    this.adminToken = data.accessToken;
    await this.config.saveSettings({
      serverBaseUrl,
      allowInsecureHttp: input.allowInsecureHttp === true || this.config.settings.allowInsecureHttp,
    });
    this.admin = {
      isLoggedIn: true,
      login: data.user.emailOrLogin ?? input.login.trim(),
      user: {
        id: data.user.id,
        ownerUserId: data.user.ownerUserId,
        role: data.user.role,
        displayName: data.user.displayName,
      },
      devices: [],
    };
    await this.adminRefreshDevices();
  }

  adminLogout(): void {
    this.adminToken = undefined;
    this.admin = {
      isLoggedIn: false,
      devices: [],
    };
    this.emitState();
  }

  async adminRefreshDevices(): Promise<void> {
    const token = this.requireAdminToken();
    const response = await fetch(apiUrl(this.config.serverBaseUrl, "/api/v1/devices"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await parseEnvelope<DevicesResponse>(response);
    this.admin = {
      ...this.admin,
      isLoggedIn: true,
      devices: data.devices,
      lastError: undefined,
    };
    this.emitState();
  }

  async adminUpdateDevicePermissions(
    deviceId: string,
    permissions: Partial<ManagedDevice["permissions"]>
  ): Promise<void> {
    const token = this.requireAdminToken();
    const response = await fetch(apiUrl(this.config.serverBaseUrl, `/api/v1/devices/${deviceId}/permissions`), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(permissions),
    });
    await parseEnvelope<unknown>(response);
    await this.adminRefreshDevices();
  }

  async adminRenameDevice(deviceId: string, name: string): Promise<void> {
    const token = this.requireAdminToken();
    const response = await fetch(apiUrl(this.config.serverBaseUrl, `/api/v1/devices/${deviceId}`), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });
    await parseEnvelope<unknown>(response);
    await this.adminRefreshDevices();
  }

  async adminRevokeDevice(deviceId: string): Promise<void> {
    const token = this.requireAdminToken();
    const response = await fetch(apiUrl(this.config.serverBaseUrl, `/api/v1/devices/${deviceId}/revoke`), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    await parseEnvelope<unknown>(response);
    await this.adminRefreshDevices();
  }

  connect(): void {
    this.clearReconnect();

    const token = this.config.getDeviceToken();
    if (!this.config.serverBaseUrl || !token) {
      this.setConnection({ status: "stopped", lastError: "设备未绑定" });
      return;
    }
    // R0-2: don't open a WebSocket (and ship the token) against a pending
    // plaintext-HTTP config. Surface a stopped state with an actionable
    // message; the renderer's confirmation banner lets the user resolve it.
    if (this.config.settings.httpConfirmationPending) {
      this.setConnection({
        status: "stopped",
        lastError: "明文 HTTP 尚未授权，请在设置中确认或切换 HTTPS。",
      });
      return;
    }
    this.closeSocket();
    this.setConnection({ status: "connecting" });

    const socket = new WebSocket(wsUrl(this.config.serverBaseUrl), {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.socket = socket;
    this.lastMessageAt = Date.now();

    socket.on("open", () => {
      this.reconnectDelayMs = 1000;
      socket.send(JSON.stringify({ type: "hello", updateChannel: currentUpdateChannel() }));
      this.startHeartbeat();
      logInfo("WebSocket opened");
    });

    socket.on("message", (raw) => {
      this.lastMessageAt = Date.now();
      this.handleSocketMessage(raw.toString()).catch((err) => {
        this.setConnection({ status: "error", lastError: String(err) });
        logError("Failed to handle WebSocket message", { error: String(err) });
      });
    });

    socket.on("close", (code, reason) => {
      this.stopHeartbeat();
      if (this.socket === socket) {
        this.socket = undefined;
      }
      const reasonText = reason.toString() || "连接已断开";
      logWarn("WebSocket closed", { code, reason: reasonText });

      // 1008 = policy violation (auth/revoked). Stop reconnecting and require rebind.
      if (code === 1008) {
        this.clearReconnect();
        this.setConnection({
          status: "error",
          lastError: "设备已被撤销或鉴权失败，请重新绑定",
        });
        return;
      }
      if (code === 4001) {
        this.clearReconnect();
        this.setConnection({ status: "stopped", lastError: "该设备已在另一个客户端实例上连接" });
        return;
      }

      if (this.config.settings.isBound) {
        this.scheduleReconnect(reasonText);
      } else {
        this.setConnection({ status: "stopped" });
      }
    });

    socket.on("error", (err) => {
      logError("WebSocket error", { error: String(err) });
    });
  }

  disconnect(): void {
    this.clearReconnect();
    this.stopHeartbeat();
    this.closeSocket();
    this.pendingOfflineCount = 0;
    this.setConnection({ status: "stopped" });
  }

  async fetchPending(): Promise<void> {
    this.assertHttpAuthorized();
    const seen = new Set<string>();
    while (true) {
      const data = await this.getPendingBatch();
      const batch = data.deliveries.filter((delivery) => !seen.has(delivery.deliveryId));
      if (batch.length === 0) break;
      for (const delivery of batch) {
        seen.add(delivery.deliveryId);
        await this.processDelivery(delivery);
      }
    }
    await this.checkPending();
  }

  async checkPending(): Promise<void> {
    const data = await this.getPendingBatch();
    this.pendingOfflineCount = data.totalPending ?? data.deliveries.length;
    this.emitState();
  }

  async skipPending(): Promise<void> {
    const seen = new Set<string>();
    while (true) {
      const data = await this.getPendingBatch();
      const batch = data.deliveries.filter((delivery) => !seen.has(delivery.deliveryId));
      if (batch.length === 0) break;
      for (const delivery of batch) {
        seen.add(delivery.deliveryId);
        await this.safeAckDelivery(delivery.deliveryId, "skipped", "User skipped offline delivery", undefined);
      }
    }
    await this.checkPending();
  }

  private async getPendingBatch(): Promise<PendingDeliveriesResponse> {
    const token = this.requireDeviceToken();
    const response = await fetch(apiUrl(this.config.serverBaseUrl, "/api/v1/deliveries/pending"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await parseEnvelope<PendingDeliveriesResponse>(response);
    return data;
  }

  async uploadManualImage(filePath: string): Promise<ManualUploadResult> {
    return this.uploadFromPath(filePath, "manual_share");
  }

  async uploadScreenshotFromPath(filePath: string): Promise<ManualUploadResult> {
    return this.uploadFromPath(filePath, "screenshot");
  }

  async listLibraryImages(): Promise<ImageLibraryPage> {
    this.assertHttpAuthorized();
    const token = this.adminToken ?? this.requireManualDownloadToken();
    const response = await fetch(
      apiUrl(this.config.serverBaseUrl, "/api/v1/images?filter=active&limit=100"),
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return parseEnvelope<ImageLibraryResponse>(response);
  }

  async downloadLibraryImage(image: LibraryImage): Promise<ManualLibraryDownloadResult> {
    this.assertHttpAuthorized();
    if (image.isExpired) throw new Error("图片已过期，无法下载");
    const token = this.adminToken ?? this.requireManualDownloadToken();
    const response = await fetch(
      apiUrl(this.config.serverBaseUrl, `/api/v1/images/${image.id}/download`),
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) await parseEnvelope<unknown>(response);
    const buffer = Buffer.from(await response.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    if (sha256 !== image.sha256) throw new Error("下载图片 sha256 校验失败");

    await mkdir(this.config.downloadDir, { recursive: true });
    const sourceName = sanitizeFilePart(image.uploadedBy.deviceName || "设备");
    const fileName = `${sourceName}_${formatTimestamp(image.createdAt)}`;
    const savedPath = await writeFileWithUniqueSuffix(
      path.join(this.config.downloadDir, `${fileName}${extensionForMime(image.mimeType)}`),
      buffer,
    );
    const clipboardResult = this.config.copyToClipboard
      ? this.copyImageToClipboard(savedPath)
      : { copied: false };
    return { imageId: image.id, savedPath, copiedToClipboard: clipboardResult.copied };
  }

  private requireManualDownloadToken(): string {
    const token = this.requireDeviceToken();
    if (this.config.settings.lastKnownPermissions?.canManualDownload !== true) {
      throw new Error("服务端未允许本设备手动下载；也可以先登录成员账号");
    }
    return token;
  }

  private async uploadFromPath(
    filePath: string,
    sourceKind: "screenshot" | "manual_share" | "selected_album" | "unknown"
  ): Promise<ManualUploadResult> {
    this.assertHttpAuthorized();
    const token = this.requireDeviceToken();
    if (!this.config.serverBaseUrl) {
      throw new Error("服务器地址不能为空");
    }
    const permissions = this.config.settings.lastKnownPermissions;
    const allowed = sourceKind === "manual_share"
      ? permissions?.canManualUpload !== false
      : permissions?.canAutoUpload !== false;
    if (!allowed) {
      throw new Error(sourceKind === "manual_share" ? "服务端未允许本设备手动上传" : "服务端未允许本设备自动上传");
    }

    const buffer = await readFile(filePath);
    const mimeType = detectImageMimeType(buffer);
    if (!mimeType) {
      throw new Error("只支持 PNG、JPEG、WebP 图片");
    }

    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    if (sourceKind !== "manual_share" && this.receivedHashes.has(sha256)) {
      logInfo("Skipped watched image received from server", { filePath, sha256 });
      return {
        imageId: "",
        deduplicated: true,
        createdDeliveriesCount: 0,
        expiresAt: "",
        fileName: path.basename(filePath),
        sha256,
      };
    }
    const form = new FormData();
    form.append("sha256", sha256);
    form.append("sourceKind", sourceKind);
    form.append("sourceDisplayName", path.basename(filePath));
    form.append("file", new Blob([buffer], { type: mimeType }), path.basename(filePath));

    const response = await fetch(apiUrl(this.config.serverBaseUrl, "/api/v1/images"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const data = await parseEnvelope<UploadImageResponse>(response);
    logInfo("Image uploaded", {
      sourceKind,
      imageId: data.imageId,
      deduplicated: data.deduplicated,
      createdDeliveriesCount: data.createdDeliveriesCount,
    });
    return {
      ...data,
      fileName: path.basename(filePath),
      sha256,
    };
  }

  async handleSettingsChanged(): Promise<void> {
    this.emitState();
    if (this.config.settings.isBound) {
      this.connect();
      return;
    }
    this.disconnect();
  }

  private async handleSocketMessage(raw: string): Promise<void> {
    const message = JSON.parse(raw) as { type?: string };
    if (message.type === "hello.ack") {
      this.setConnection({
        status: "connected",
        lastConnectedAt: new Date().toISOString(),
      });
      if (this.config.autoReceive && this.config.settings.lastKnownPermissions?.canAutoReceive !== false) {
        await this.checkPending();
      }
      return;
    }
    if (message.type === "pong") {
      return;
    }
    if (message.type === "image.created") {
      if (this.config.autoReceive && this.config.settings.lastKnownPermissions?.canAutoReceive !== false) {
        await this.enqueueDelivery(message as ImageCreatedEvent);
      }
      return;
    }
    if (message.type === "app.update.available") {
      const release = this.parseUpdateRelease((message as { release?: unknown }).release);
      if (release) this.updateListener?.(release);
    }
  }

  async checkForUpdate(): Promise<AppUpdateInfo | undefined> {
    const token = this.requireDeviceToken();
    const response = await fetch(
      apiUrl(this.config.serverBaseUrl, `/api/v1/updates/${currentUpdateChannel()}`),
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await parseEnvelope<{ available: boolean; release?: AppUpdateInfo }>(response);
    return data.available ? this.parseUpdateRelease(data.release) : undefined;
  }

  async downloadUpdate(release: AppUpdateInfo, targetDir: string): Promise<string> {
    const token = this.requireDeviceToken();
    await mkdir(targetDir, { recursive: true });
    const fileName = path.basename(release.fileName);
    const target = path.join(targetDir, fileName);
    const partial = `${target}.part`;
    await fs.rm(partial, { force: true });
    const response = await fetch(apiUrl(this.config.serverBaseUrl, release.downloadPath), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok || !response.body) {
      throw new Error(`更新包下载失败：HTTP ${response.status}`);
    }
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      createWriteStream(partial, { flags: "wx" }),
    );
    const actual = await sha256File(partial);
    if (actual.toLowerCase() !== release.sha256.toLowerCase()) {
      await fs.rm(partial, { force: true });
      throw new Error("更新包 SHA-256 校验失败");
    }
    await fs.rm(target, { force: true });
    await fs.rename(partial, target);
    return target;
  }

  private parseUpdateRelease(value: unknown): AppUpdateInfo | undefined {
    if (!value || typeof value !== "object") return undefined;
    const release = value as Partial<AppUpdateInfo>;
    if (
      release.channel !== currentUpdateChannel() ||
      !release.versionName || !release.fileName || !release.sha256 || !release.downloadPath ||
      typeof release.fileSize !== "number"
    ) return undefined;
    return release as AppUpdateInfo;
  }

  private enqueueDelivery(delivery: DeliveryPayload): Promise<void> {
    const run = this.deliveryChain.catch(() => undefined).then(() => this.processDelivery(delivery));
    this.deliveryChain = run;
    return run;
  }

  private async processDelivery(delivery: DeliveryPayload): Promise<void> {
    const existing = this.history.find(delivery.deliveryId);
    if (existing?.status === "downloaded") {
      await this.safeAckDelivery(delivery.deliveryId, "downloaded", undefined, existing.savedPath);
      return;
    }
    if (this.completedDeliveries.has(delivery.deliveryId)) {
      await this.safeAckDelivery(delivery.deliveryId, "downloaded", undefined, undefined);
      return;
    }
    if (this.processingDeliveries.has(delivery.deliveryId)) {
      return;
    }

    this.processingDeliveries.add(delivery.deliveryId);
    try {
      const result = await this.downloadWithRetries(delivery);
      if (result.status === "downloaded") this.completedDeliveries.add(delivery.deliveryId);
      await this.history.add(result);
      this.emitState();
    } finally {
      this.processingDeliveries.delete(delivery.deliveryId);
    }
  }

  private async downloadWithRetries(delivery: DeliveryPayload): Promise<DownloadRecord> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.downloadOnce(delivery);
      } catch (err) {
        lastError = err;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          this.disconnect();
          this.setConnection({ status: "error", lastError: err.message });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 800));
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    await this.safeAckDelivery(delivery.deliveryId, "failed", message, undefined);
    const failed: DownloadRecord = {
      deliveryId: delivery.deliveryId,
      imageId: delivery.image.id,
      sourceDeviceName: delivery.source.uploadDeviceName ?? delivery.source.uploadDeviceId,
      receivedAt: new Date().toISOString(),
      copiedToClipboard: false,
      status: "failed",
      error: message,
    };
    logError("Delivery download failed", { deliveryId: delivery.deliveryId, error: message });
    return failed;
  }

  private async downloadOnce(delivery: DeliveryPayload): Promise<DownloadRecord> {
    const token = this.requireDeviceToken();
    const response = await fetch(
      apiUrl(this.config.serverBaseUrl, `/api/v1/images/${delivery.image.id}/download`),
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      await parseEnvelope<unknown>(response);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    if (sha256 !== delivery.image.sha256) {
      throw new Error("下载图片 sha256 校验失败");
    }

    await mkdir(this.config.downloadDir, { recursive: true });
    const sourceName = sanitizeFilePart(delivery.source.uploadDeviceName ?? delivery.source.uploadDeviceId);
    const fileName = [sourceName, formatTimestamp(delivery.createdAt)].join("_");
    const filePath = await writeFileWithUniqueSuffix(
      path.join(this.config.downloadDir, `${fileName}${extensionForMime(delivery.image.mimeType)}`),
      buffer,
    );

    const clipboardResult = this.config.copyToClipboard
      ? this.copyImageToClipboard(filePath)
      : { copied: false };

    await this.safeAckDelivery(delivery.deliveryId, "downloaded", undefined, filePath);

    const record: DownloadRecord = {
      deliveryId: delivery.deliveryId,
      imageId: delivery.image.id,
      sha256: delivery.image.sha256,
      sourceDeviceName: sourceName,
      savedPath: filePath,
      receivedAt: new Date().toISOString(),
      copiedToClipboard: clipboardResult.copied,
      clipboardError: clipboardResult.error,
      status: "downloaded",
    };
    this.receivedHashes.add(delivery.image.sha256);
    this.showDownloadedNotification(record);
    logInfo("Delivery downloaded", { deliveryId: delivery.deliveryId, imageId: delivery.image.id });
    return record;
  }

  private showDownloadedNotification(record: DownloadRecord): void {
    if (!this.config.showNotification || !Notification.isSupported()) return;

    try {
      new Notification({
        title: "收到新图片",
        body: `${record.sourceDeviceName} 的图片已保存`,
        silent: true,
      }).show();
    } catch (err) {
      logWarn("Failed to show desktop notification", { error: String(err) });
    }
  }

  async copyRecordToClipboard(deliveryId: string): Promise<DownloadRecord> {
    const record = this.history.find(deliveryId);
    if (!record?.savedPath) {
      throw new Error("没有可复制的本地图片");
    }

    const result = this.copyImageToClipboard(record.savedPath);
    const updated = await this.history.update(deliveryId, {
      copiedToClipboard: result.copied,
      clipboardError: result.error,
    });
    this.emitState();

    if (!updated) {
      throw new Error("接收记录不存在");
    }
    if (!result.copied) {
      throw new Error(result.error ?? "图片无法写入剪贴板");
    }
    return updated;
  }

  private copyImageToClipboard(filePath: string): { copied: boolean; error?: string } {
    try {
      const image = nativeImage.createFromPath(filePath);
      if (image.isEmpty()) {
        return { copied: false, error: "图片无法写入剪贴板" };
      }
      clipboard.writeImage(image);
      return { copied: true };
    } catch (err) {
      return { copied: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async ackDelivery(
    deliveryId: string,
    status: "downloaded" | "failed" | "skipped",
    errorMessage: string | undefined,
    localPathHint: string | undefined
  ): Promise<void> {
    const token = this.requireDeviceToken();
    const response = await fetch(apiUrl(this.config.serverBaseUrl, `/api/v1/deliveries/${deliveryId}/ack`), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status, errorMessage, localPathHint }),
    });
    await parseEnvelope<unknown>(response);
  }

  private async safeAckDelivery(
    deliveryId: string,
    status: "downloaded" | "failed" | "skipped",
    errorMessage: string | undefined,
    localPathHint: string | undefined
  ): Promise<void> {
    try {
      await this.ackDelivery(deliveryId, status, errorMessage, localPathHint);
    } catch (err) {
      logWarn("Delivery ACK failed", { deliveryId, status, error: String(err) });
    }
  }

  private requireDeviceToken(): string {
    this.assertHttpAuthorized();
    const token = this.config.getDeviceToken();
    if (!token) {
      throw new Error("设备未绑定或 token 无法解密");
    }
    return token;
  }

  private requireAdminToken(): string {
    this.assertHttpAuthorized();
    if (!this.adminToken) {
      throw new Error("请先登录管理会话");
    }
    return this.adminToken;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMessageAt > 90_000) {
        this.socket.close(1001, "Heartbeat timeout");
        return;
      }
      this.socket.send(JSON.stringify({ type: "ping" }));
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private scheduleReconnect(reason: string): void {
    this.clearReconnect();
    const baseDelay = Math.min(this.reconnectDelayMs, 60_000);
    // Add ±25% jitter to avoid reconnect storms, but cap at 60s.
    const delay = Math.min(60_000, Math.floor(baseDelay * (0.75 + Math.random() * 0.5)));
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 60_000);
    this.setConnection({
      status: "reconnecting",
      lastError: reason,
      nextRetryAt: new Date(Date.now() + delay).toISOString(),
    });
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private closeSocket(): void {
    if (this.socket) {
      const socket = this.socket;
      this.socket = undefined;
      socket.removeAllListeners();
      socket.close();
    }
  }

  private setConnection(connection: ConnectionState): void {
    this.connection = connection;
    this.emitState();
  }

  private emitState(): void {
    this.stateListener?.(this.getState());
  }
}
