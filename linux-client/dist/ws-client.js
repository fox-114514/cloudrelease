import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { ApiClient } from "./api.js";
import { ensureDir, extensionForMime, formatTimestamp, sanitizeFilePart, wsUrl, } from "./utils.js";
export class WsReceiveClient {
    options;
    socket;
    reconnectTimer;
    reconnectDelayMs = 1000;
    destroyed = false;
    processing = new Set();
    api;
    constructor(options) {
        this.options = options;
        this.api = new ApiClient(options.device);
    }
    start() {
        if (this.destroyed)
            return;
        this.connect();
    }
    stop() {
        this.destroyed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        this.socket?.close();
        this.socket = undefined;
    }
    connect() {
        if (this.destroyed || this.socket)
            return;
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
            }
            else {
                this.log("stopped", "Stopped reconnecting due to auth/policy failure");
            }
        });
        this.socket.on("error", (err) => {
            this.log("error", `WebSocket error: ${err.message}`);
        });
    }
    handleMessage(text) {
        try {
            const msg = JSON.parse(text);
            if (msg.type === "hello.ack") {
                this.fetchPending();
            }
            else if (msg.type === "pong") {
                // ignore
            }
            else if (msg.type === "image.created") {
                this.handleImageCreated(msg);
            }
        }
        catch (err) {
            this.log("error", `Failed to handle message: ${err.message}`);
        }
    }
    handleImageCreated(msg) {
        const deliveryId = msg.deliveryId;
        const image = (msg.image ?? {});
        const imageId = image.id;
        const mimeType = image.mimeType || "image/jpeg";
        if (!deliveryId || !imageId)
            return;
        if (this.processing.has(deliveryId))
            return;
        this.processing.add(deliveryId);
        this.downloadAndAck(deliveryId, imageId, mimeType).finally(() => {
            this.processing.delete(deliveryId);
        });
    }
    async fetchPending() {
        try {
            const { deliveries } = await this.api.getPendingDeliveries();
            for (const delivery of deliveries) {
                if (this.processing.has(delivery.id))
                    continue;
                this.processing.add(delivery.id);
                this.downloadAndAck(delivery.id, delivery.image.id, delivery.image.mimeType).finally(() => {
                    this.processing.delete(delivery.id);
                });
            }
        }
        catch (err) {
            this.log("error", `fetchPending failed: ${err.message}`);
        }
    }
    async downloadAndAck(deliveryId, imageId, mimeType) {
        try {
            const downloadDir = this.options.config.downloadDir || path.join(process.cwd(), "downloads");
            await ensureDir(downloadDir);
            const sourceName = sanitizeFilePart(this.options.device.deviceName);
            const fileName = `${formatTimestamp(new Date().toISOString())}_${sourceName}_${imageId.slice(0, 8)}${extensionForMime(mimeType)}`;
            const filePath = path.join(downloadDir, fileName);
            const stream = await this.api.downloadImage(imageId);
            const file = await fs.open(filePath, "w");
            try {
                const reader = stream.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    await file.write(value);
                }
            }
            finally {
                await file.close();
            }
            await this.api.ackDelivery(deliveryId, "downloaded");
            this.log("download", `Saved ${filePath}`);
            this.options.onDownload?.(filePath);
        }
        catch (err) {
            this.log("error", `Download failed: ${err.message}`);
            try {
                await this.api.ackDelivery(deliveryId, "failed");
            }
            catch {
                // ignore
            }
        }
    }
    shouldReconnect(closeCode) {
        // 1008 = policy violation (revoked, invalid token, etc.)
        if (closeCode === 1008)
            return false;
        return !this.destroyed;
    }
    scheduleReconnect() {
        if (this.destroyed || this.reconnectTimer)
            return;
        const base = Math.min(60000, this.reconnectDelayMs);
        const jitter = base * (0.75 + Math.random() * 0.5);
        this.log("reconnect", `Reconnecting in ${Math.round(jitter)}ms`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.reconnectDelayMs = Math.min(60000, this.reconnectDelayMs * 2);
            this.connect();
        }, jitter);
    }
    log(tag, message) {
        const line = `[${new Date().toISOString()}] [${tag}] ${message}`;
        console.log(line);
        this.options.onStatus?.(line);
    }
}
//# sourceMappingURL=ws-client.js.map