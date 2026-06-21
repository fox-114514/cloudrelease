import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindDevice,
  bindWithLogin,
  loadConfig,
  previewBindCode,
  refreshDeviceIdentity,
  saveConfig,
  serverAllows,
  unbind,
} from "../config.js";
import { startWatcher } from "../watcher.js";
import { WsReceiveClient } from "../ws-client.js";
import { ensureAllowedDir, isAllowedDir, normalizeBaseUrl } from "../utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

function broadcastLog(text: string, type = "info") {
  logEmitter.emit("log", JSON.stringify({ text, type }));
}

interface ServiceManager {
  receiveClient?: WsReceiveClient;
  watcher?: ReturnType<typeof startWatcher>;
}

const services: ServiceManager = {};

async function startReceive(): Promise<void> {
  if (services.receiveClient) return;
  const config = await loadConfig();
  if (!config.device) throw new Error("Not bound");
  config.device = await refreshDeviceIdentity(config.device);
  await saveConfig(config);
  if (!serverAllows(config.device, "canAutoReceive")) {
    throw new Error("服务端未允许本设备自动接收");
  }
  const client = new WsReceiveClient({
    device: config.device,
    config,
    onStatus: (line) => broadcastLog(line, "info"),
    onDownload: async (filePath, imageId) => {
      broadcastLog(`Received ${filePath}`, "success");
      try {
        const stat = await fs.stat(filePath);
        recordRecentDelivery({
          imageId,
          fileName: path.basename(filePath),
          sourceDevice: config.device?.deviceName ?? "unknown",
          size: stat.size,
          savedAt: new Date().toISOString(),
        });
      } catch (err) {
        broadcastLog(`记录最近投递失败：${(err as Error).message}`, "error");
      }
    },
    onError: (message) => broadcastLog(message, "error"),
  });
  client.start();
  services.receiveClient = client;
  broadcastLog("Receive service started", "success");
}

async function stopReceive(): Promise<void> {
  services.receiveClient?.stop();
  services.receiveClient = undefined;
  broadcastLog("Receive service stopped", "info");
}

async function startWatch(): Promise<void> {
  if (services.watcher) return;
  const config = await loadConfig();
  if (!config.device) throw new Error("Not bound");
  config.device = await refreshDeviceIdentity(config.device);
  await saveConfig(config);
  if (!config.watchDir) throw new Error("Watch directory not configured");
  if (!serverAllows(config.device, "canAutoUpload")) {
    throw new Error("服务端未允许本设备自动上传");
  }
  services.watcher = startWatcher({
    device: config.device,
    watchDir: config.watchDir,
    onLog: (line) => broadcastLog(line, "info"),
    onError: (message) => broadcastLog(message, "error"),
  });
  broadcastLog(`Watch service started for ${config.watchDir}`, "success");
}

async function stopWatch(): Promise<void> {
  await services.watcher?.close();
  services.watcher = undefined;
  broadcastLog("Watch service stopped", "info");
}

// In-memory ring buffer of the most recent N deliveries received by this
// Linux client. Lives in-process; resets on restart. Surfaced on the
// dashboard tab and used by the recent-deliveries API.
interface RecentDelivery {
  imageId: string;
  fileName: string;
  sourceDevice: string;
  size: number;
  savedAt: string;
}
const MAX_RECENT_DELIVERIES = 20;
const recentDeliveries: RecentDelivery[] = [];

export function recordRecentDelivery(entry: RecentDelivery): void {
  recentDeliveries.unshift(entry);
  if (recentDeliveries.length > MAX_RECENT_DELIVERIES) {
    recentDeliveries.length = MAX_RECENT_DELIVERIES;
  }
}

export async function startWebServer(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const app: FastifyInstance = fastify({ logger: false });
  const permissionTimer = setInterval(() => {
    void (async () => {
      const config = await loadConfig();
      if (!config.device) return;
      config.device = await refreshDeviceIdentity(config.device);
      await saveConfig(config);
      if (!serverAllows(config.device, "canAutoUpload")) await stopWatch();
      if (!serverAllows(config.device, "canAutoReceive")) await stopReceive();
    })().catch((err) => broadcastLog(`定时刷新服务端权限失败：${(err as Error).message}`, "warn"));
  }, 5 * 60 * 1000);

  await app.register(fastifyStatic, {
    root: __dirname,
    prefix: "/",
  });

  app.get("/api/config", async (_req, reply) => {
    const config = await loadConfig();
    if (config.device) {
      try {
        config.device = await refreshDeviceIdentity(config.device);
        await saveConfig(config);
      } catch (err) {
        broadcastLog(`刷新服务端权限失败：${(err as Error).message}`, "warn");
      }
    }
    return reply.send(config);
  });

  app.post("/api/config", async (req: FastifyRequest<{
    Body: Partial<import("../config.js").AppConfig> & { allowUnsafePath?: boolean }
  }>, reply) => {
    const oldConfig = await loadConfig();
    const config = { ...oldConfig };
    const body = req.body ?? {};
    const allowUnsafe = body.allowUnsafePath === true;

    try {
      if (body.watchDir !== undefined) {
        const resolved = await ensureAllowedDir(body.watchDir, allowUnsafe);
        if (allowUnsafe && !isAllowedDir(resolved).ok) {
          broadcastLog(`警告：watchDir 设置为非安全路径 ${resolved}`, "warn");
        }
        config.watchDir = resolved;
      }
      if (body.downloadDir !== undefined) {
        const resolved = await ensureAllowedDir(body.downloadDir, allowUnsafe);
        if (allowUnsafe && !isAllowedDir(resolved).ok) {
          broadcastLog(`警告：downloadDir 设置为非安全路径 ${resolved}`, "warn");
        }
        config.downloadDir = resolved;
      }
    } catch (err) {
      return reply.status(400).send({ success: false, error: { message: (err as Error).message } });
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

    const dirChanged =
      (body.watchDir !== undefined && config.watchDir !== oldConfig.watchDir) ||
      (body.downloadDir !== undefined && config.downloadDir !== oldConfig.downloadDir);
    const autoUploadChanged =
      body.autoUpload !== undefined && config.autoUpload !== oldConfig.autoUpload;

    await saveConfig(config);

    // If watchDir changed and auto upload is on, restart the watcher so
    // it picks up the new path. Similarly toggle watcher when autoUpload flips.
    if (dirChanged && body.watchDir !== undefined && config.autoUpload) {
      await stopWatch().catch(() => undefined);
      await startWatch().catch((err) =>
        broadcastLog(`重启监听失败：${(err as Error).message}`, "error"),
      );
    } else if (autoUploadChanged) {
      if (config.autoUpload) {
        await startWatch().catch((err) =>
          broadcastLog(`启动监听失败：${(err as Error).message}`, "error"),
        );
      } else {
        await stopWatch().catch(() => undefined);
      }
    }
    return reply.send({ success: true });
  });

  app.post("/api/bind/preview", async (req: FastifyRequest<{ Body: { serverBaseUrl: string; bindCode: string } }>, reply) => {
    const preview = await previewBindCode(req.body.serverBaseUrl, req.body.bindCode);
    return reply.send({ success: true, data: preview });
  });

  app.post("/api/bind", async (req: FastifyRequest<{ Body: {
    serverBaseUrl: string;
    bindCode: string;
    deviceName?: string;
    profile?: string;
    confirmedTargetUserId?: string;
  } }>, reply) => {
    const { serverBaseUrl, bindCode, deviceName, profile, confirmedTargetUserId } = req.body;
    const preview = await previewBindCode(serverBaseUrl, bindCode);
    if (!confirmedTargetUserId || confirmedTargetUserId !== preview.targetUser.id) {
      return reply.status(409).send({
        success: false,
        error: { message: "请先预览并确认绑定目标" },
      });
    }
    const device = await bindDevice(serverBaseUrl, bindCode, deviceName || "Linux", profile);
    const config = await loadConfig();
    config.device = device;
    await saveConfig(config);
    return reply.send({ success: true, data: device });
  });

  app.post("/api/bind-login", async (req: FastifyRequest<{ Body: {
    serverBaseUrl: string;
    login: string;
    password: string;
    deviceName?: string;
    profile?: string;
  } }>, reply) => {
    const { serverBaseUrl, login, password, deviceName, profile } = req.body;
    const device = await bindWithLogin(serverBaseUrl, login, password, deviceName || "Linux", profile);
    const config = await loadConfig();
    config.device = device;
    await saveConfig(config);
    return reply.send({ success: true, data: device });
  });

  app.post("/api/permissions/refresh", async (_req, reply) => {
    const config = await loadConfig();
    if (!config.device) return reply.status(400).send({ success: false, error: { message: "Not bound" } });
    config.device = await refreshDeviceIdentity(config.device);
    await saveConfig(config);
    if (!serverAllows(config.device, "canAutoUpload")) await stopWatch();
    if (!serverAllows(config.device, "canAutoReceive")) await stopReceive();
    return reply.send({ success: true, data: config.device });
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
    });
  });

  app.get("/api/recent-deliveries", async (_req, reply) => {
    return reply.send({ deliveries: recentDeliveries });
  });

  // ---- admin image library proxy ----
  // The Linux-client Web UI does not store the admin JWT itself; the browser
  // attaches the JWT to every request, the linux server attaches it to the
  // upstream call to the backend, and returns the response. This keeps the
  // JWT scoped to the browser session and avoids storing secrets here.
  async function requireAdminJwt(req: FastifyRequest, reply: FastifyReply) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      reply.status(401).send({ success: false, error: { message: "需要先登录管理账号" } });
      return null;
    }
    return auth.slice(7);
  }

  app.get("/api/proxy/images", async (req, reply) => {
    const jwt = await requireAdminJwt(req, reply);
    if (!jwt) return;
    const config = await loadConfig();
    if (!config.device) return reply.status(400).send({ success: false, error: { message: "Not bound" } });
    const baseUrl = normalizeBaseUrl(config.device.serverBaseUrl);
    const url = new URL(`${baseUrl}/api/v1/images`);
    const query = req.query as Record<string, string | undefined>;
    for (const [k, v] of Object.entries(query)) {
      if (typeof v === "string" && v !== "") url.searchParams.set(k, v);
    }
    const response = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
    const body = await response.text();
    return reply.status(response.status).type("application/json").send(body);
  });

  app.delete("/api/proxy/images/:imageId", async (req, reply) => {
    const jwt = await requireAdminJwt(req, reply);
    if (!jwt) return;
    const { imageId } = req.params as { imageId: string };
    const config = await loadConfig();
    if (!config.device) return reply.status(400).send({ success: false, error: { message: "Not bound" } });
    const response = await fetch(
      `${normalizeBaseUrl(config.device.serverBaseUrl)}/api/v1/images/${encodeURIComponent(imageId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${jwt}` } },
    );
    const body = await response.text();
    return reply.status(response.status).type("application/json").send(body);
  });

  app.get("/api/proxy/images/:imageId/download", async (req, reply) => {
    const jwt = await requireAdminJwt(req, reply);
    if (!jwt) return;
    const { imageId } = req.params as { imageId: string };
    const config = await loadConfig();
    if (!config.device) return reply.status(400).send({ success: false, error: { message: "Not bound" } });
    const response = await fetch(
      `${normalizeBaseUrl(config.device.serverBaseUrl)}/api/v1/images/${encodeURIComponent(imageId)}/download`,
      { headers: { Authorization: `Bearer ${jwt}` } },
    );
    if (!response.ok) {
      const body = await response.text();
      return reply.status(response.status).type("application/json").send(body);
    }
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    reply.header("Content-Type", contentType);
    const buffer = Buffer.from(await response.arrayBuffer());
    return reply.send(buffer);
  });

  app.post("/api/proxy/auth/login", async (req: FastifyRequest<{ Body: { login: string; password: string } }>, reply) => {
    const config = await loadConfig();
    if (!config.device) return reply.status(400).send({ error: { message: "Not bound" } });
    const url = `${normalizeBaseUrl(config.device.serverBaseUrl)}/api/v1/auth/login`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    return reply.status(response.status).send(data);
  });

  app.get("/api/logs", async (req: FastifyRequest, reply: FastifyReply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const handler = (data: string) => {
      reply.raw.write(`data: ${data}\n\n`);
    };
    logEmitter.on("log", handler);

    const heartbeat = setInterval(() => {
      reply.raw.write(":heartbeat\n\n");
    }, 15000);

    req.socket.on("close", () => {
      clearInterval(heartbeat);
      logEmitter.off("log", handler);
    });
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/")) {
      const indexPath = path.join(__dirname, "index.html");
      const html = await fs.readFile(indexPath, "utf-8");
      // Inline <style>/<script> need 'unsafe-inline'. We cannot tighten
      // connect-src further because serverBaseUrl is user-configured; the
      // other directives still close off plugin/object/base-tag attacks.
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; connect-src *; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
      );
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Referrer-Policy", "no-referrer");
      return reply.type("text/html").send(html);
    }
    return reply.status(404).send({ error: { message: "Not found" } });
  });

  const address = await app.listen({ port, host: "127.0.0.1" });
  const actualPort = (app.server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${actualPort}`;

  return {
    url,
    close: async () => {
      clearInterval(permissionTimer);
      await stopReceive();
      await stopWatch();
      await app.close();
    },
  };
}

export function openBrowser(url: string): void {
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
