import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bindDevice, bindWithLogin, loadConfig, previewBindCode, refreshDeviceIdentity, saveConfig, serverAllows, unbind, } from "../config.js";
import { startWatcher } from "../watcher.js";
import { WsReceiveClient } from "../ws-client.js";
import { assertExplicitInsecureHttp, defaultDownloadDir, ensureAllowedDir, isAllowedDir, normalizeBaseUrl } from "../utils.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ---- Local Web UI session auth ----
// The Web UI listens on 127.0.0.1 but the same machine can host other users
// or processes that would otherwise be able to scan ports and read device
// tokens. We authenticate every /api/* request with an HttpOnly, SameSite=Strict
// session cookie. The cookie is minted by exchanging a one-time boot token
// that `launch` puts in the initial URL.
//
//   http://127.0.0.1:<port>/?boot=<base64url token>
//         |
//         v  server validates token, clears it, sets cookie, 302 -> /
//
// After that, all API access relies solely on the cookie. State-changing
// requests additionally require Origin == http://127.0.0.1:<port> to block
// CSRF via cross-origin form submissions.
const SESSION_COOKIE_NAME = "ssr_session";
// R0-5 §4: the session is bound to the Web server process — when the
// process restarts the sessionToken changes and any pre-existing cookie
// stops being accepted. We therefore do NOT advertise an artificial Max-Age
// in the Set-Cookie header; an absent Max-Age makes the browser treat this
// as a session cookie that is dropped on browser exit, matching the
// process-lifetime semantics of the token.
function randomToken(bytes) {
    return crypto.randomBytes(bytes).toString("base64url");
}
function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length)
        return false;
    return crypto.timingSafeEqual(ab, bb);
}
function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx <= 0)
            continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key)
            out[key] = decodeURIComponent(val);
    }
    return out;
}
const CSP_HEADER = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; " +
    "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none';";
function buildSanitizedDevice(device) {
    return {
        serverBaseUrl: device.serverBaseUrl,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        user: device.user,
        profile: device.profile,
        permissions: device.permissions,
        permissionsFetchedAt: device.permissionsFetchedAt,
    };
}
function buildConfigDto(config) {
    return {
        device: config.device ? buildSanitizedDevice(config.device) : undefined,
        autoUpload: config.autoUpload,
        autoReceive: config.autoReceive,
        copyToClipboard: config.copyToClipboard,
        watchDir: config.watchDir,
        downloadDir: config.downloadDir,
        allowInsecureHttp: config.allowInsecureHttp === true,
    };
}
const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);
function broadcastLog(text, type = "info") {
    logEmitter.emit("log", JSON.stringify({ text, type }));
}
const services = {};
let pendingDeliveryCount = 0;
async function startReceive() {
    if (services.receiveClient)
        return;
    const config = await loadConfig();
    if (!config.device)
        throw new Error("Not bound");
    config.device = await refreshDeviceIdentity(config.device, {
        allowInsecureHttp: config.allowInsecureHttp,
    });
    await saveConfig(config);
    if (!serverAllows(config.device, "canAutoReceive")) {
        throw new Error("服务端未允许本设备自动接收");
    }
    const client = new WsReceiveClient({
        device: config.device,
        config,
        onStatus: (line) => broadcastLog(line, "info"),
        onPending: (count) => {
            pendingDeliveryCount = count;
            if (count > 0)
                broadcastLog(`有 ${count} 张离线图片等待确认`, "pending");
        },
        onDownload: async (filePath, imageId, deliveryId, sourceDeviceName) => {
            broadcastLog(`Received ${filePath}`, "success");
            try {
                const stat = await fs.stat(filePath);
                recordRecentDelivery({
                    deliveryId,
                    imageId,
                    fileName: path.basename(filePath),
                    sourceDevice: sourceDeviceName,
                    size: stat.size,
                    savedAt: new Date().toISOString(),
                });
            }
            catch (err) {
                broadcastLog(`记录最近投递失败：${err.message}`, "error");
            }
        },
        onError: (message) => broadcastLog(message, "error"),
    });
    client.start();
    services.receiveClient = client;
    broadcastLog("Receive service started", "success");
}
async function stopReceive() {
    services.receiveClient?.stop();
    services.receiveClient = undefined;
    pendingDeliveryCount = 0;
    broadcastLog("Receive service stopped", "info");
}
async function startWatch() {
    if (services.watcher)
        return;
    const config = await loadConfig();
    if (!config.device)
        throw new Error("Not bound");
    config.device = await refreshDeviceIdentity(config.device, {
        allowInsecureHttp: config.allowInsecureHttp,
    });
    await saveConfig(config);
    if (!config.watchDir)
        throw new Error("Watch directory not configured");
    if (!serverAllows(config.device, "canAutoUpload")) {
        throw new Error("服务端未允许本设备自动上传");
    }
    services.watcher = startWatcher({
        device: config.device,
        watchDir: config.watchDir,
        excludedDirs: config.downloadDir ? [config.downloadDir] : [],
        onLog: (line) => broadcastLog(line, "info"),
        onError: (message) => broadcastLog(message, "error"),
    });
    broadcastLog(`Watch service started for ${config.watchDir}`, "success");
}
async function stopWatch() {
    await services.watcher?.close();
    services.watcher = undefined;
    broadcastLog("Watch service stopped", "info");
}
const MAX_RECENT_DELIVERIES = 20;
const recentDeliveries = [];
export function recordRecentDelivery(entry) {
    recentDeliveries.unshift(entry);
    if (recentDeliveries.length > MAX_RECENT_DELIVERIES) {
        recentDeliveries.length = MAX_RECENT_DELIVERIES;
    }
}
export async function startWebServer(port = 0) {
    const app = fastify({
        logger: false,
        // R0-5 §1: when the web server is shutting down, fastify must not block
        // on idle keep-alive sockets left open by browsers (e.g. EventSource,
        // long-poll fallbacks). "idle" closes only the sockets that are
        // currently between requests, so any in-flight request still finishes.
        forceCloseConnections: "idle",
    });
    // Per-startup session state. Closed over by the onRequest hook so each
    // invocation (including tests) gets fresh credentials and the boot token
    // can never leak to another instance.
    const sessionState = {
        sessionToken: randomToken(32),
        bootToken: randomToken(32),
        expectedOrigin: "",
    };
    const activeLogStreams = new Set();
    // R0-5 §2: unref() the timer so it never blocks process exit. Tests and
    // a clean SIGTERM shutdown of the Web server should not have to wait for
    // the next 5-minute tick to release the event loop.
    const permissionTimer = setInterval(() => {
        void (async () => {
            const config = await loadConfig();
            if (!config.device)
                return;
            config.device = await refreshDeviceIdentity(config.device, {
                allowInsecureHttp: config.allowInsecureHttp,
            });
            await saveConfig(config);
            if (!serverAllows(config.device, "canAutoUpload"))
                await stopWatch();
            if (!serverAllows(config.device, "canAutoReceive"))
                await stopReceive();
        })().catch((err) => broadcastLog(`定时刷新服务端权限失败：${err.message}`, "warn"));
    }, 5 * 60 * 1000);
    permissionTimer.unref();
    // Authentication gate. Every /api/* request must carry a valid session
    // cookie. State-changing requests additionally require Origin ==
    // http://127.0.0.1:<port> to block CSRF via cross-origin form posts.
    // /api/auth/boot is the only public endpoint — it trades a one-time boot
    // token for the cookie that unlocks the rest of the API.
    app.addHook("onRequest", async (req, reply) => {
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Referrer-Policy", "no-referrer");
        reply.header("X-Frame-Options", "DENY");
        reply.header("Content-Security-Policy", CSP_HEADER);
        const urlPath = req.url.split("?", 1)[0];
        if (!urlPath.startsWith("/api/"))
            return;
        if (urlPath === "/api/auth/boot")
            return;
        const cookies = parseCookies(req.headers.cookie);
        const token = cookies[SESSION_COOKIE_NAME];
        if (!token || !safeEqual(token, sessionState.sessionToken)) {
            return reply.code(401).send({
                success: false,
                error: { message: "未鉴权或会话已过期，请通过 studyshot-relay launch 打开的 URL 进入" },
            });
        }
        const method = req.method.toUpperCase();
        if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
            const origin = req.headers.origin;
            if (typeof origin !== "string" || !safeEqual(origin, sessionState.expectedOrigin)) {
                return reply.code(403).send({
                    success: false,
                    error: { message: "Origin 不被允许" },
                });
            }
        }
    });
    await app.register(fastifyStatic, {
        root: __dirname,
        prefix: "/",
    });
    app.get("/api/auth/boot", async (req, reply) => {
        const token = req.query.token;
        if (typeof token !== "string" || !token || !sessionState.bootToken || !safeEqual(token, sessionState.bootToken)) {
            return reply.code(403).send({
                success: false,
                error: { message: "引导令牌无效或已过期" },
            });
        }
        // One-time use: invalidate the boot token before minting the cookie so a
        // replay (e.g. via browser history) cannot mint a second session.
        sessionState.bootToken = null;
        reply.header("Set-Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionState.sessionToken)}; Path=/; HttpOnly; SameSite=Strict`);
        return reply.redirect("/", 303);
    });
    app.get("/api/config", async (_req, reply) => {
        const config = await loadConfig();
        if (config.device) {
            try {
                config.device = await refreshDeviceIdentity(config.device, {
                    allowInsecureHttp: config.allowInsecureHttp,
                });
                await saveConfig(config);
            }
            catch (err) {
                broadcastLog(`刷新服务端权限失败：${err.message}`, "warn");
            }
        }
        return reply.send(buildConfigDto(config));
    });
    app.post("/api/config", async (req, reply) => {
        const oldConfig = await loadConfig();
        const config = { ...oldConfig };
        const body = req.body ?? {};
        const allowUnsafe = body.allowUnsafePath === true;
        try {
            if (body.watchDir !== undefined) {
                if (!body.watchDir.trim()) {
                    config.watchDir = undefined;
                }
                else {
                    const resolved = await ensureAllowedDir(body.watchDir, allowUnsafe);
                    if (allowUnsafe && !isAllowedDir(resolved).ok) {
                        broadcastLog(`警告：watchDir 设置为非安全路径 ${resolved}`, "warn");
                    }
                    config.watchDir = resolved;
                }
            }
            if (body.downloadDir !== undefined) {
                const resolved = await ensureAllowedDir(body.downloadDir.trim() || defaultDownloadDir(), allowUnsafe);
                if (allowUnsafe && !isAllowedDir(resolved).ok) {
                    broadcastLog(`警告：downloadDir 设置为非安全路径 ${resolved}`, "warn");
                }
                config.downloadDir = resolved;
            }
        }
        catch (err) {
            return reply.status(400).send({ success: false, error: { message: err.message } });
        }
        if (body.autoUpload !== undefined) {
            if (body.autoUpload && config.device && !serverAllows(config.device, "canAutoUpload")) {
                return reply.status(403).send({ success: false, error: { message: "服务端未允许本设备自动上传" } });
            }
            config.autoUpload = body.autoUpload;
        }
        if (body.autoReceive !== undefined) {
            if (body.autoReceive && config.device && !serverAllows(config.device, "canAutoReceive")) {
                return reply.status(403).send({ success: false, error: { message: "服务端未允许本设备自动接收" } });
            }
            config.autoReceive = body.autoReceive;
        }
        if (body.copyToClipboard !== undefined) {
            config.copyToClipboard = body.copyToClipboard;
        }
        // Persists the user's explicit choice to allow plaintext HTTP for non-
        // loopback hosts. UI displays a persistent warning when this is on.
        if (body.allowInsecureHttp !== undefined) {
            config.allowInsecureHttp = body.allowInsecureHttp === true;
        }
        const watchDirChanged = body.watchDir !== undefined && config.watchDir !== oldConfig.watchDir;
        const receiveConfigChanged = (body.downloadDir !== undefined && config.downloadDir !== oldConfig.downloadDir) ||
            (body.copyToClipboard !== undefined &&
                config.copyToClipboard !== oldConfig.copyToClipboard);
        const autoUploadChanged = body.autoUpload !== undefined && config.autoUpload !== oldConfig.autoUpload;
        const autoReceiveChanged = body.autoReceive !== undefined && config.autoReceive !== oldConfig.autoReceive;
        await saveConfig(config);
        // If watchDir changed and auto upload is on, restart the watcher so
        // it picks up the new path. Similarly toggle watcher when autoUpload flips.
        if (watchDirChanged && config.autoUpload) {
            await stopWatch().catch(() => undefined);
            await startWatch().catch((err) => broadcastLog(`重启监听失败：${err.message}`, "error"));
        }
        else if (autoUploadChanged) {
            if (config.autoUpload) {
                await startWatch().catch((err) => broadcastLog(`启动监听失败：${err.message}`, "error"));
            }
            else {
                await stopWatch().catch(() => undefined);
            }
        }
        // WsReceiveClient holds the config snapshot it was started with. Restart
        // only an already-running receiver so directory/clipboard changes apply
        // immediately without changing the user's service state.
        if (receiveConfigChanged && services.receiveClient) {
            await stopReceive();
            await startReceive().catch((err) => broadcastLog(`重启接收失败：${err.message}`, "error"));
        }
        if (autoReceiveChanged) {
            if (config.autoReceive) {
                await startReceive().catch((err) => broadcastLog(`启动接收失败：${err.message}`, "error"));
            }
            else {
                await stopReceive();
            }
        }
        return reply.send({ success: true });
    });
    app.post("/api/bind/preview", async (req, reply) => {
        try {
            const preview = await previewBindCode(req.body.serverBaseUrl, req.body.bindCode, {
                allowInsecureHttp: req.body.allowInsecureHttp === true,
            });
            return reply.send({ success: true, data: preview });
        }
        catch (err) {
            return reply.status(400).send({ success: false, error: { message: err.message } });
        }
    });
    app.post("/api/bind", async (req, reply) => {
        const { serverBaseUrl, bindCode, deviceName, profile, confirmedTargetUserId, allowInsecureHttp } = req.body;
        const userOptedIn = allowInsecureHttp === true;
        try {
            const preview = await previewBindCode(serverBaseUrl, bindCode, { allowInsecureHttp: userOptedIn });
            if (!confirmedTargetUserId || confirmedTargetUserId !== preview.targetUser.id) {
                return reply.status(409).send({
                    success: false,
                    error: { message: "请先预览并确认绑定目标" },
                });
            }
            const device = await bindDevice(serverBaseUrl, bindCode, deviceName || "Linux", profile, {
                allowInsecureHttp: userOptedIn,
            });
            const config = await loadConfig();
            config.device = device;
            // Persist the user's choice so subsequent refreshes against a stored
            // http:// URL keep working without re-prompting.
            config.allowInsecureHttp = config.allowInsecureHttp || userOptedIn;
            await saveConfig(config);
            if (config.autoReceive) {
                await startReceive().catch((err) => broadcastLog(`绑定成功，但启动接收失败：${err.message}`, "warn"));
            }
            return reply.send({ success: true, data: buildSanitizedDevice(device) });
        }
        catch (err) {
            return reply.status(400).send({ success: false, error: { message: err.message } });
        }
    });
    app.post("/api/bind-login", async (req, reply) => {
        const { serverBaseUrl, login, password, deviceName, profile, allowInsecureHttp } = req.body;
        const userOptedIn = allowInsecureHttp === true;
        try {
            const device = await bindWithLogin(serverBaseUrl, login, password, deviceName || "Linux", profile, {
                allowInsecureHttp: userOptedIn,
            });
            const config = await loadConfig();
            config.device = device;
            config.allowInsecureHttp = config.allowInsecureHttp || userOptedIn;
            await saveConfig(config);
            if (config.autoReceive) {
                await startReceive().catch((err) => broadcastLog(`绑定成功，但启动接收失败：${err.message}`, "warn"));
            }
            return reply.send({ success: true, data: buildSanitizedDevice(device) });
        }
        catch (err) {
            return reply.status(400).send({ success: false, error: { message: err.message } });
        }
    });
    app.post("/api/permissions/refresh", async (_req, reply) => {
        const config = await loadConfig();
        if (!config.device)
            return reply.status(400).send({ success: false, error: { message: "Not bound" } });
        config.device = await refreshDeviceIdentity(config.device, {
            allowInsecureHttp: config.allowInsecureHttp,
        });
        await saveConfig(config);
        if (!serverAllows(config.device, "canAutoUpload"))
            await stopWatch();
        if (!serverAllows(config.device, "canAutoReceive"))
            await stopReceive();
        return reply.send({ success: true, data: buildSanitizedDevice(config.device) });
    });
    app.post("/api/unbind", async (_req, reply) => {
        await stopReceive();
        await stopWatch();
        await unbind();
        return reply.send({ success: true });
    });
    app.post("/api/service/receive/start", async (_req, reply) => {
        await startReceive();
        return reply.send({ success: true });
    });
    app.post("/api/service/receive/stop", async (_req, reply) => {
        await stopReceive();
        return reply.send({ success: true });
    });
    app.post("/api/service/watch/start", async (_req, reply) => {
        await startWatch();
        return reply.send({ success: true });
    });
    app.post("/api/service/watch/stop", async (_req, reply) => {
        await stopWatch();
        return reply.send({ success: true });
    });
    app.get("/api/service/status", async (_req, reply) => {
        return reply.send({
            receive: Boolean(services.receiveClient),
            watch: Boolean(services.watcher),
            pendingDeliveryCount,
        });
    });
    app.post("/api/service/receive/pending/accept", async (_req, reply) => {
        if (!services.receiveClient)
            return reply.status(409).send({ success: false, error: { message: "接收服务未启动" } });
        await services.receiveClient.acceptPending();
        return reply.send({ success: true });
    });
    app.post("/api/service/receive/pending/skip", async (_req, reply) => {
        if (!services.receiveClient)
            return reply.status(409).send({ success: false, error: { message: "接收服务未启动" } });
        await services.receiveClient.skipPending();
        return reply.send({ success: true });
    });
    app.get("/api/recent-deliveries", async (_req, reply) => {
        return reply.send({ deliveries: recentDeliveries });
    });
    app.delete("/api/recent-deliveries/:deliveryId", async (req, reply) => {
        const { deliveryId } = req.params;
        const index = recentDeliveries.findIndex((item) => item.deliveryId === deliveryId);
        if (index >= 0)
            recentDeliveries.splice(index, 1);
        return reply.send({ success: true });
    });
    app.delete("/api/recent-deliveries", async (_req, reply) => {
        recentDeliveries.length = 0;
        return reply.send({ success: true });
    });
    // ---- admin image library proxy ----
    // The Linux-client Web UI does not store the admin JWT itself; the browser
    // attaches the JWT to every request, the linux server attaches it to the
    // upstream call to the backend, and returns the response. This keeps the
    // JWT scoped to the browser session and avoids storing secrets here.
    async function requireAdminJwt(req, reply) {
        const auth = req.headers.authorization;
        if (!auth?.startsWith("Bearer ")) {
            reply.status(401).send({ success: false, error: { message: "需要先登录管理账号" } });
            return null;
        }
        return auth.slice(7);
    }
    async function requireSafeConfiguredDevice(reply) {
        const config = await loadConfig();
        if (!config.device) {
            reply.status(400).send({ success: false, error: { message: "Not bound" } });
            return null;
        }
        try {
            assertExplicitInsecureHttp(config.device.serverBaseUrl, {
                allowInsecureHttp: config.allowInsecureHttp,
            });
            return config.device;
        }
        catch (err) {
            reply.status(403).send({ success: false, error: { message: err.message } });
            return null;
        }
    }
    async function resolveImageLibraryToken(req, reply) {
        const config = await loadConfig();
        if (!config.device) {
            reply.status(400).send({ success: false, error: { message: "Not bound" } });
            return null;
        }
        // R0-2: don't ship the device token (or relay an admin JWT) over a
        // non-loopback http:// URL that was never explicitly authorized.
        try {
            assertExplicitInsecureHttp(config.device.serverBaseUrl, {
                allowInsecureHttp: config.allowInsecureHttp,
            });
        }
        catch (err) {
            reply.status(403).send({
                success: false,
                error: { message: err.message },
            });
            return null;
        }
        const auth = req.headers.authorization;
        if (auth?.startsWith("Bearer ") && auth.slice(7).trim()) {
            return { token: auth.slice(7).trim(), device: config.device };
        }
        if (config.device.permissions?.canManualDownload) {
            return { token: config.device.deviceToken, device: config.device };
        }
        reply.status(403).send({
            success: false,
            error: { message: "需要登录成员账号，或为本设备开启手动下载权限" },
        });
        return null;
    }
    app.get("/api/proxy/images", async (req, reply) => {
        const resolved = await resolveImageLibraryToken(req, reply);
        if (!resolved)
            return;
        const { token, device } = resolved;
        const baseUrl = normalizeBaseUrl(device.serverBaseUrl);
        const url = new URL(`${baseUrl}/api/v1/images`);
        const query = req.query;
        for (const [k, v] of Object.entries(query)) {
            if (typeof v === "string" && v !== "")
                url.searchParams.set(k, v);
        }
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const body = await response.text();
        return reply.status(response.status).type("application/json").send(body);
    });
    app.delete("/api/proxy/images/:imageId", async (req, reply) => {
        const jwt = await requireAdminJwt(req, reply);
        if (!jwt)
            return;
        const { imageId } = req.params;
        const device = await requireSafeConfiguredDevice(reply);
        if (!device)
            return;
        const response = await fetch(`${normalizeBaseUrl(device.serverBaseUrl)}/api/v1/images/${encodeURIComponent(imageId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${jwt}` } });
        const body = await response.text();
        return reply.status(response.status).type("application/json").send(body);
    });
    app.get("/api/proxy/images/:imageId/download", async (req, reply) => {
        const resolved = await resolveImageLibraryToken(req, reply);
        if (!resolved)
            return;
        const { token, device } = resolved;
        const { imageId } = req.params;
        const response = await fetch(`${normalizeBaseUrl(device.serverBaseUrl)}/api/v1/images/${encodeURIComponent(imageId)}/download`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) {
            const body = await response.text();
            return reply.status(response.status).type("application/json").send(body);
        }
        const contentType = response.headers.get("content-type") || "application/octet-stream";
        reply.header("Content-Type", contentType);
        const buffer = Buffer.from(await response.arrayBuffer());
        return reply.send(buffer);
    });
    app.post("/api/proxy/auth/login", async (req, reply) => {
        const device = await requireSafeConfiguredDevice(reply);
        if (!device)
            return;
        const url = `${normalizeBaseUrl(device.serverBaseUrl)}/api/v1/auth/login`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
        });
        const data = await response.json();
        return reply.status(response.status).send(data);
    });
    app.get("/api/logs", async (req, reply) => {
        const handler = (data) => {
            reply.raw.write(`data: ${data}\n\n`);
        };
        logEmitter.on("log", handler);
        const heartbeat = setInterval(() => {
            if (!reply.raw.writableEnded)
                reply.raw.write(":heartbeat\n\n");
        }, 15000);
        heartbeat.unref();
        let stream;
        const cleanup = () => {
            clearInterval(heartbeat);
            logEmitter.off("log", handler);
            activeLogStreams.delete(stream);
        };
        stream = { reply, heartbeat, handler, cleanup };
        activeLogStreams.add(stream);
        req.socket.once("close", cleanup);
        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        reply.raw.write(":connected\n\n");
    });
    app.setNotFoundHandler(async (req, reply) => {
        if (req.method === "GET" && !req.url.startsWith("/api/")) {
            const indexPath = path.join(__dirname, "index.html");
            const html = await fs.readFile(indexPath, "utf-8");
            // Security headers (CSP / nosniff / referrer-policy / X-Frame-Options)
            // are attached globally in the onRequest hook above; just send the HTML.
            return reply.type("text/html").send(html);
        }
        return reply.status(404).send({ error: { message: "Not found" } });
    });
    const address = await app.listen({ port, host: "127.0.0.1" });
    const actualPort = app.server.address().port;
    const url = `http://127.0.0.1:${actualPort}`;
    // Pin the expected Origin now that the listening port is known. State-
    // changing API requests must come from this exact origin so a malicious
    // page served from another origin cannot drive the local management API.
    sessionState.expectedOrigin = url;
    // The first browser window is opened through /api/auth/boot so it can
    // exchange the one-time boot token for a session cookie. The printed `url`
    // (without token) is what we surface to the user in the terminal.
    const bootUrl = `${url}/api/auth/boot?token=${encodeURIComponent(sessionState.bootToken ?? "")}`;
    const startupConfig = await loadConfig();
    if (startupConfig.device && startupConfig.autoReceive) {
        await startReceive().catch((err) => broadcastLog(`自动启动接收失败：${err.message}`, "error"));
    }
    if (startupConfig.device && startupConfig.autoUpload && startupConfig.watchDir) {
        await startWatch().catch((err) => broadcastLog(`自动启动监听失败：${err.message}`, "error"));
    }
    return {
        url,
        bootUrl,
        close: async () => {
            // R0-5 §2: the close path must always run every teardown step even if
            // an earlier one throws. Otherwise a failed stopReceive() would leave
            // the WebSocket receiver running and the process unable to exit.
            clearInterval(permissionTimer);
            await stopReceive().catch((err) => broadcastLog(`关闭接收客户端失败：${err.message}`, "warn"));
            await stopWatch().catch((err) => broadcastLog(`关闭目录监听失败：${err.message}`, "warn"));
            for (const stream of [...activeLogStreams]) {
                stream.cleanup();
                if (!stream.reply.raw.writableEnded)
                    stream.reply.raw.end();
            }
            await app.close();
        },
    };
}
export function openBrowser(url) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    // spawn with arg array avoids shell parsing of the URL; cmd.exe needs
    // /c start on Windows so the spawned process actually opens the URL.
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", (err) => {
        broadcastLog(`Failed to open browser: ${err.message}`, "error");
    });
    child.unref();
}
//# sourceMappingURL=server.js.map