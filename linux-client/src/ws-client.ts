import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { ApiClient } from "./api.js";
import type { AppConfig, DeviceConfig } from "./config.js";
import {
  ensureDir,
  extensionForMime,
  formatTimestamp,
  sanitizeFilePart,
  wsUrl,
} from "./utils.js";

export interface WsClientOptions {
  device: DeviceConfig;
  config: AppConfig;
  onStatus?: (status: string) => void;
  onDownload?: (filePath: string, imageId: string) => void;
  onError?: (message: string) => void;
}

const PING_INTERVAL_MS = 25_000;
const DOWNLOAD_MAX_ATTEMPTS = 3;

export class WsReceiveClient {
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectDelayMs = 1000;
  private destroyed = false;
  private processing = new Set<string>();
  private api: ApiClient;

  constructor(private readonly options: WsClientOptions) {
    this.api = new ApiClient(options.device);
  }

  start(): void {
    if (this.destroyed) return;
    this.connect();
  }

  stop(): void {
    this.destroyed = true;
    this.clearReconnect();
    this.stopHeartbeat();
    if (this.socket) {
      try {
        this.socket.close(1000, "Client stopped");
      } catch {
        // ignore
      }
    }
    this.socket = undefined;
  }

  private connect(): void {
    if (this.destroyed || this.socket) return;

    const url = wsUrl(this.options.device.serverBaseUrl);
    this.log("connecting", `Connecting to ${url}`);

    this.socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${this.options.device.deviceToken}` },
    });

    this.socket.on("open", () => {
      this.reconnectDelayMs = 1000;
      this.log("connected", "WebSocket connected");
      this.socket?.send(JSON.stringify({ type: "hello" }));
      this.startHeartbeat();
      this.fetchPending();
    });

    this.socket.on("message", (data) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data);
      this.handleMessage(text);
    });

    this.socket.on("close", (code, reason) => {
      const reasonText = reason.toString() || "unknown";
      this.log("disconnected", `WebSocket closed: ${code} ${reasonText}`);
      this.stopHeartbeat();
      this.socket = undefined;
      if (this.shouldReconnect(code)) {
        this.scheduleReconnect();
      } else {
        this.log("stopped", "Stopped reconnecting due to auth/policy failure");
      }
    });

    this.socket.on("error", (err) => {
      this.log("error", `WebSocket error: ${err.message}`);
      // The close event will fire right after; let it handle reconnect scheduling.
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      this.socket.send(JSON.stringify({ type: "ping" }));
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private handleMessage(text: string): void {
    try {
      const msg = JSON.parse(text) as { type: string; [key: string]: unknown };
      if (msg.type === "hello.ack") {
        this.fetchPending();
      } else if (msg.type === "pong") {
        // ignore
      } else if (msg.type === "image.created") {
        this.handleImageCreated(msg as Record<string, unknown>);
      }
    } catch (err) {
      this.log("error", `Failed to handle message: ${(err as Error).message}`);
    }
  }

  private handleImageCreated(msg: Record<string, unknown>): void {
    const delivery = this.parseDelivery(msg);
    if (!delivery) return;

    if (this.processing.has(delivery.deliveryId)) return;
    this.processing.add(delivery.deliveryId);

    this.downloadWithRetries(delivery).finally(() => {
      this.processing.delete(delivery.deliveryId);
    });
  }

  private parseDelivery(msg: Record<string, unknown>): DeliveryLike | null {
    const deliveryId = msg.deliveryId as string | undefined;
    const image = (msg.image ?? {}) as Record<string, unknown>;
    const imageId = image.id as string | undefined;
    if (!deliveryId || !imageId) return null;
    return {
      deliveryId,
      imageId,
      mimeType: (image.mimeType as string) || "image/jpeg",
      createdAt: (msg.createdAt as string) || new Date().toISOString(),
    };
  }

  private async fetchPending(): Promise<void> {
    try {
      const { deliveries } = await this.api.getPendingDeliveries();
      for (const raw of deliveries) {
        const delivery: DeliveryLike = {
          deliveryId: raw.id,
          imageId: raw.image.id,
          mimeType: raw.image.mimeType,
          createdAt: raw.createdAt,
        };
        if (this.processing.has(delivery.deliveryId)) continue;
        this.processing.add(delivery.deliveryId);
        this.downloadWithRetries(delivery).finally(() => {
          this.processing.delete(delivery.deliveryId);
        });
      }
    } catch (err) {
      this.log("error", `fetchPending failed: ${(err as Error).message}`);
    }
  }

  private async downloadWithRetries(delivery: DeliveryLike): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.downloadOnce(delivery);
        return;
      } catch (err) {
        lastError = err;
        this.log("error", `Download attempt ${attempt}/${DOWNLOAD_MAX_ATTEMPTS} failed: ${(err as Error).message}`);
        if (attempt < DOWNLOAD_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 800));
        }
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    this.log("error", `Download failed permanently for ${delivery.deliveryId}: ${message}`);
    try {
      await this.api.ackDelivery(delivery.deliveryId, "failed");
    } catch {
      // ignore
    }
  }

  private async downloadOnce(delivery: DeliveryLike): Promise<void> {
    const downloadDir = this.options.config.downloadDir || path.join(process.cwd(), "downloads");
    await ensureDir(downloadDir);

    const sourceName = sanitizeFilePart(this.options.device.deviceName);
    const fileName = `${formatTimestamp(delivery.createdAt)}_${sourceName}_${delivery.imageId.slice(
      0,
      8,
    )}${extensionForMime(delivery.mimeType)}`;
    const filePath = await this.uniquePath(path.join(downloadDir, fileName));

    const stream = await this.api.downloadImage(delivery.imageId);
    const handle = await fs.open(filePath, "w", 0o600);
    try {
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await handle.write(value);
      }
    } finally {
      await handle.close();
    }

    await this.api.ackDelivery(delivery.deliveryId, "downloaded");
    this.log("download", `Saved ${filePath}`);
    this.options.onDownload?.(filePath, delivery.imageId);
  }

  private async uniquePath(basePath: string): Promise<string> {
    const parsed = path.parse(basePath);
    for (let index = 0; index < 1000; index += 1) {
      const candidate =
        index === 0
          ? basePath
          : path.join(parsed.dir, `${parsed.name}-${String(index + 1).padStart(2, "0")}${parsed.ext}`);
      try {
        await fs.access(candidate);
      } catch {
        return candidate;
      }
    }
    throw new Error("Unable to allocate a unique file name");
  }

  private shouldReconnect(closeCode: number): boolean {
    // 1008 = policy violation (revoked, invalid token, etc.)
    if (closeCode === 1008) return false;
    return !this.destroyed;
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    const base = Math.min(60000, this.reconnectDelayMs);
    const jitter = base * (0.75 + Math.random() * 0.5);
    this.log("reconnect", `Reconnecting in ${Math.round(jitter)}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnectDelayMs = Math.min(60000, this.reconnectDelayMs * 2);
      this.connect();
    }, jitter);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private log(tag: string, message: string): void {
    const line = `[${new Date().toISOString()}] [${tag}] ${message}`;
    console.log(line);
    this.options.onStatus?.(line);
  }
}

interface DeliveryLike {
  deliveryId: string;
  imageId: string;
  mimeType: string;
  createdAt: string;
}
