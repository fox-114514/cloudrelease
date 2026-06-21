import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { ApiClient } from "./api.js";
import { ensureDir, extensionForMime, formatTimestamp, sanitizeFilePart, wsUrl, } from "./utils.js";
const PING_INTERVAL_MS = 25_000;
const DOWNLOAD_MAX_ATTEMPTS = 3;
export class WsReceiveClient {
    options;
    socket;
    reconnectTimer;
    heartbeatTimer;
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
        this.clearReconnect();
        this.stopHeartbeat();
        if (this.socket) {
            try {
                this.socket.close(1000, "Client stopped");
            }
            catch {
                // ignore
            }
        }
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
            }
            else {
                this.log("stopped", "Stopped reconnecting due to auth/policy failure");
            }
        });
        this.socket.on("error", (err) => {
            this.log("error", `WebSocket error: ${err.message}`);
            // The close event will fire right after; let it handle reconnect scheduling.
        });
    }
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
                return;
            this.socket.send(JSON.stringify({ type: "ping" }));
        }, PING_INTERVAL_MS);
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
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
        const delivery = this.parseDelivery(msg);
        if (!delivery)
            return;
        if (this.processing.has(delivery.deliveryId))
            return;
        this.processing.add(delivery.deliveryId);
        this.downloadWithRetries(delivery).finally(() => {
            this.processing.delete(delivery.deliveryId);
        });
    }
    parseDelivery(msg) {
        const deliveryId = msg.deliveryId;
        const image = (msg.image ?? {});
        const imageId = image.id;
        const sha256 = image.sha256;
        if (!deliveryId || !imageId || !sha256)
            return null;
        return {
            deliveryId,
            imageId,
            mimeType: image.mimeType || "image/jpeg",
            createdAt: msg.createdAt || new Date().toISOString(),
            expectedSha256: sha256,
        };
    }
    async fetchPending() {
        try {
            const { deliveries } = await this.api.getPendingDeliveries();
            for (const raw of deliveries) {
                const delivery = {
                    deliveryId: raw.id,
                    imageId: raw.image.id,
                    mimeType: raw.image.mimeType,
                    createdAt: raw.createdAt,
                    expectedSha256: raw.image.sha256,
                };
                if (this.processing.has(delivery.deliveryId))
                    continue;
                this.processing.add(delivery.deliveryId);
                this.downloadWithRetries(delivery).finally(() => {
                    this.processing.delete(delivery.deliveryId);
                });
            }
        }
        catch (err) {
            this.log("error", `fetchPending failed: ${err.message}`);
        }
    }
    async downloadWithRetries(delivery) {
        let lastError;
        for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
            try {
                await this.downloadOnce(delivery);
                return;
            }
            catch (err) {
                lastError = err;
                this.log("error", `Download attempt ${attempt}/${DOWNLOAD_MAX_ATTEMPTS} failed: ${err.message}`);
                if (attempt < DOWNLOAD_MAX_ATTEMPTS) {
                    await new Promise((resolve) => setTimeout(resolve, attempt * 800));
                }
            }
        }
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        this.log("error", `Download failed permanently for ${delivery.deliveryId}: ${message}`);
        try {
            await this.api.ackDelivery(delivery.deliveryId, "failed");
        }
        catch {
            // ignore
        }
    }
    async downloadOnce(delivery) {
        const downloadDir = this.options.config.downloadDir || path.join(process.cwd(), "downloads");
        await ensureDir(downloadDir);
        const sourceName = sanitizeFilePart(this.options.device.deviceName);
        const fileName = `${formatTimestamp(delivery.createdAt)}_${sourceName}_${delivery.imageId.slice(0, 8)}${extensionForMime(delivery.mimeType)}`;
        const basePath = path.join(downloadDir, fileName);
        const stream = await this.api.downloadImage(delivery.imageId);
        const filePath = await this.writeImageWithUniqueSuffix(basePath, stream, delivery.expectedSha256);
        await this.api.ackDelivery(delivery.deliveryId, "downloaded");
        this.log("download", `Saved ${filePath}`);
        this.options.onDownload?.(filePath, delivery.imageId);
    }
    // Streams the response body to disk at `basePath`, hashing as we go.
    // Uses O_EXCL so two concurrent downloads of the same image can't stomp
    // each other. If the path is taken, the suffix is bumped and we retry.
    // On any error after a partial write, the partial file is unlinked.
    async writeImageWithUniqueSuffix(basePath, stream, expectedSha256) {
        const parsed = path.parse(basePath);
        let lastError;
        for (let index = 0; index < 1000; index += 1) {
            const candidate = index === 0
                ? basePath
                : path.join(parsed.dir, `${parsed.name}-${String(index + 1).padStart(2, "0")}${parsed.ext}`);
            try {
                await this.writeImageExclusive(candidate, stream, expectedSha256);
                return candidate;
            }
            catch (err) {
                lastError = err;
                if (err.code === "EEXIST")
                    continue;
                throw err;
            }
        }
        throw lastError instanceof Error ? lastError : new Error("Unable to allocate a unique file name");
    }
    async writeImageExclusive(target, stream, expectedSha256) {
        const handle = await fs.open(target, "wx", 0o600);
        const hash = crypto.createHash("sha256");
        try {
            const reader = stream.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                await handle.write(value);
                hash.update(value);
            }
        }
        catch (err) {
            await handle.close().catch(() => undefined);
            await fs.unlink(target).catch(() => undefined);
            throw err;
        }
        await handle.close();
        const actualSha256 = hash.digest("hex");
        if (actualSha256 !== expectedSha256) {
            await fs.unlink(target).catch(() => undefined);
            throw new Error("下载图片 sha256 校验失败");
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
    clearReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }
    log(tag, message) {
        const line = `[${new Date().toISOString()}] [${tag}] ${message}`;
        console.log(line);
        this.options.onStatus?.(line);
    }
}
//# sourceMappingURL=ws-client.js.map