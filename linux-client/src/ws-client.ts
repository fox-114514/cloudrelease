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
  onDownload?: (filePath: string) => void;
  onError?: (message: string) => void;
}

export class WsReceiveClient {
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close();
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
      this.fetchPending();
    });

    this.socket.on("message", (data) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data);
      this.handleMessage(text);
    });

    this.socket.on("close", (code, reason) => {
      const reasonText = reason.toString() || "unknown";
      this.log("disconnected", `WebSocket closed: ${code} ${reasonText}`);
      this.socket = undefined;
      if (this.shouldReconnect(code)) {
        this.scheduleReconnect();
      } else {
        this.log("stopped", "Stopped reconnecting due to auth/policy failure");
      }
    });

    this.socket.on("error", (err) => {
      this.log("error", `WebSocket error: ${err.message}`);
    });
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
    const deliveryId = msg.deliveryId as string | undefined;
    const image = (msg.image ?? {}) as Record<string, unknown>;
    const imageId = image.id as string | undefined;
    const mimeType = (image.mimeType as string) || "image/jpeg";
    if (!deliveryId || !imageId) return;

    if (this.processing.has(deliveryId)) return;
    this.processing.add(deliveryId);

    this.downloadAndAck(deliveryId, imageId, mimeType).finally(() => {
      this.processing.delete(deliveryId);
    });
  }

  private async fetchPending(): Promise<void> {
    try {
      const { deliveries } = await this.api.getPendingDeliveries();
      for (const delivery of deliveries) {
        if (this.processing.has(delivery.id)) continue;
        this.processing.add(delivery.id);
        this.downloadAndAck(delivery.id, delivery.image.id, delivery.image.mimeType).finally(() => {
          this.processing.delete(delivery.id);
        });
      }
    } catch (err) {
      this.log("error", `fetchPending failed: ${(err as Error).message}`);
    }
  }

  private async downloadAndAck(
    deliveryId: string,
    imageId: string,
    mimeType: string
  ): Promise<void> {
    try {
      const downloadDir = this.options.config.downloadDir || path.join(process.cwd(), "downloads");
      await ensureDir(downloadDir);

      const sourceName = sanitizeFilePart(this.options.device.deviceName);
      const fileName = `${formatTimestamp(new Date().toISOString())}_${sourceName}_${imageId.slice(
        0,
        8
      )}${extensionForMime(mimeType)}`;
      const filePath = path.join(downloadDir, fileName);

      const stream = await this.api.downloadImage(imageId);
      const file = await fs.open(filePath, "w");
      try {
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await file.write(value);
        }
      } finally {
        await file.close();
      }

      await this.api.ackDelivery(deliveryId, "downloaded");
      this.log("download", `Saved ${filePath}`);
      this.options.onDownload?.(filePath);
    } catch (err) {
      this.log("error", `Download failed: ${(err as Error).message}`);
      try {
        await this.api.ackDelivery(deliveryId, "failed");
      } catch {
        // ignore
      }
    }
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

  private log(tag: string, message: string): void {
    const line = `[${new Date().toISOString()}] [${tag}] ${message}`;
    console.log(line);
    this.options.onStatus?.(line);
  }
}
