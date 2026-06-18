import { clipboard, nativeImage, Notification } from "electron";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import type { ConfigStore } from "./config-store";
import { normalizeBaseUrl } from "./config-store";
import type { HistoryStore } from "./history-store";
import { logError, logInfo, logWarn } from "./logger";
import type {
  AdminLoginInput,
  AdminState,
  ConnectionState,
  CreateBindCodeInput,
  CreateBindCodeResult,
  DeliveryPayload,
  DownloadRecord,
  ImageCreatedEvent,
  ManualUploadResult,
  ManagedDevice,
  Platform,
  RegisterDeviceInput,
  RendererState,
} from "./shared";

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
}

interface LoginResponse {
  accessToken: string;
  user: {
    emailOrLogin?: string;
    role: string;
  };
}

interface CreateBindCodeResponse {
  bindCode: string;
  expiresAt: string;
}

interface PendingDeliveriesResponse {
  deliveries: DeliveryPayload[];
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

type StateListener = (state: RendererState) => void;

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
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

async function uniquePath(basePath: string): Promise<string> {
  const parsed = path.parse(basePath);
  for (let index = 0; index < 1000; index += 1) {
    const candidate =
      index === 0
        ? basePath
        : path.join(parsed.dir, `${parsed.name}-${String(index + 1).padStart(2, "0")}${parsed.ext}`);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error("Unable to allocate a unique file name");
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? (JSON.parse(text) as ApiEnvelope<T>) : ({ success: true } as ApiEnvelope<T>);
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
  private stateListener?: StateListener;
  private connection: ConnectionState = { status: "idle" };
  private adminToken?: string;
  private admin: AdminState = {
    isLoggedIn: false,
    devices: [],
  };

  constructor(
    private readonly config: ConfigStore,
    private readonly history: HistoryStore
  ) {}

  onState(listener: StateListener): void {
    this.stateListener = listener;
    this.emitState();
  }

  getState(): RendererState {
    return {
      settings: this.config.settings,
      connection: this.connection,
      recentDownloads: this.history.list(),
      admin: this.admin,
    };
  }

  async registerDevice(input: RegisterDeviceInput): Promise<void> {
    const serverBaseUrl = normalizeBaseUrl(input.serverBaseUrl);
    if (!serverBaseUrl) {
      throw new Error("服务器地址不能为空");
    }
    if (!input.bindCode.trim()) {
      throw new Error("绑定码不能为空");
    }

    const response = await fetch(apiUrl(serverBaseUrl, "/api/v1/devices/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bindCode: input.bindCode.trim(),
        deviceName: input.deviceName.trim() || os.hostname(),
        platform: currentPlatform(),
        osVersion: `${os.type()} ${os.release()}`,
        appVersion: "0.1.0",
      }),
    });

    const data = await parseEnvelope<RegisterDeviceResponse>(response);
    await this.config.bindDevice({
      serverBaseUrl,
      deviceId: data.deviceId,
      deviceToken: data.deviceToken,
      deviceName: input.deviceName.trim() || os.hostname(),
    });
    logInfo("Device registered", { serverBaseUrl, deviceId: data.deviceId });
    this.emitState();

    if (this.config.autoReceive) {
      this.connect();
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
    });
    this.emitState();
    logInfo("Bind code created with owner login", { serverBaseUrl });
    return bindData;
  }

  async adminLogin(input: AdminLoginInput): Promise<void> {
    const serverBaseUrl = normalizeBaseUrl(input.serverBaseUrl);
    if (!serverBaseUrl) {
      throw new Error("服务器地址不能为空");
    }
    if (!input.login.trim() || !input.password) {
      throw new Error("登录名和密码不能为空");
    }

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
    await this.config.saveSettings({ serverBaseUrl });
    this.admin = {
      isLoggedIn: true,
      login: data.user.emailOrLogin ?? input.login.trim(),
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
    if (!this.config.autoReceive) {
      this.setConnection({ status: "stopped" });
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
      socket.send(JSON.stringify({ type: "hello" }));
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

      if (this.config.autoReceive) {
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
    this.setConnection({ status: "stopped" });
  }

  async fetchPending(): Promise<void> {
    const token = this.requireDeviceToken();
    const response = await fetch(apiUrl(this.config.serverBaseUrl, "/api/v1/deliveries/pending"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await parseEnvelope<PendingDeliveriesResponse>(response);
    for (const delivery of data.deliveries) {
      await this.processDelivery(delivery);
    }
  }

  async uploadManualImage(filePath: string): Promise<ManualUploadResult> {
    const token = this.requireDeviceToken();
    if (!this.config.serverBaseUrl) {
      throw new Error("服务器地址不能为空");
    }

    const buffer = await readFile(filePath);
    const mimeType = detectImageMimeType(buffer);
    if (!mimeType) {
      throw new Error("只支持 PNG、JPEG、WebP 图片");
    }

    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const form = new FormData();
    form.append("sha256", sha256);
    form.append("sourceKind", "manual_share");
    form.append("sourceDisplayName", path.basename(filePath));
    form.append("file", new Blob([buffer], { type: mimeType }), path.basename(filePath));

    const response = await fetch(apiUrl(this.config.serverBaseUrl, "/api/v1/images"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const data = await parseEnvelope<UploadImageResponse>(response);
    logInfo("Manual image uploaded", {
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
    if (this.config.autoReceive && this.config.settings.isBound) {
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
      await this.fetchPending();
      return;
    }
    if (message.type === "pong") {
      return;
    }
    if (message.type === "image.created") {
      await this.processDelivery(message as ImageCreatedEvent);
    }
  }

  private async processDelivery(delivery: DeliveryPayload): Promise<void> {
    if (
      this.processingDeliveries.has(delivery.deliveryId) ||
      this.completedDeliveries.has(delivery.deliveryId) ||
      this.history.find(delivery.deliveryId)?.status === "downloaded"
    ) {
      return;
    }

    this.processingDeliveries.add(delivery.deliveryId);
    try {
      const result = await this.downloadWithRetries(delivery);
      this.completedDeliveries.add(delivery.deliveryId);
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
    const fileName = [
      formatTimestamp(delivery.createdAt),
      sourceName,
      delivery.image.id.slice(0, 8),
    ].join("_");
    const filePath = await uniquePath(
      path.join(this.config.downloadDir, `${fileName}${extensionForMime(delivery.image.mimeType)}`)
    );
    await writeFile(filePath, buffer, { mode: 0o600 });

    const clipboardResult = this.config.copyToClipboard
      ? this.copyImageToClipboard(filePath)
      : { copied: false };

    await this.safeAckDelivery(delivery.deliveryId, "downloaded", undefined, filePath);

    const record: DownloadRecord = {
      deliveryId: delivery.deliveryId,
      imageId: delivery.image.id,
      sourceDeviceName: sourceName,
      savedPath: filePath,
      receivedAt: new Date().toISOString(),
      copiedToClipboard: clipboardResult.copied,
      clipboardError: clipboardResult.error,
      status: "downloaded",
    };
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
    const token = this.config.getDeviceToken();
    if (!token) {
      throw new Error("设备未绑定或 token 无法解密");
    }
    return token;
  }

  private requireAdminToken(): string {
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
