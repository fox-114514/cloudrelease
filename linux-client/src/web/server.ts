import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bindDevice, loadConfig, saveConfig, unbind } from "../config.js";
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
  const client = new WsReceiveClient({
    device: config.device,
    config,
    onStatus: (line) => broadcastLog(line, "info"),
    onDownload: (filePath) => broadcastLog(`Received ${filePath}`, "success"),
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
  if (!config.watchDir) throw new Error("Watch directory not configured");
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

export async function startWebServer(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const app: FastifyInstance = fastify({ logger: false });

  await app.register(fastifyStatic, {
    root: __dirname,
    prefix: "/",
  });

  app.get("/api/config", async (_req, reply) => {
    const config = await loadConfig();
    return reply.send(config);
  });

  app.post("/api/config", async (req: FastifyRequest<{
    Body: Partial<import("../config.js").AppConfig> & { allowUnsafePath?: boolean }
  }>, reply) => {
    const config = await loadConfig();
    const body = req.body ?? {};
    const allowUnsafe = body.allowUnsafePath === true;

    try {
      if (body.watchDir !== undefined) {
        const resolved = await ensureAllowedDir(body.watchDir, allowUnsafe);
        if (!allowUnsafe && isAllowedDir(resolved).ok === false) {
          // ensureAllowedDir already threw — defensive.
        }
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

    if (body.autoUpload !== undefined) config.autoUpload = body.autoUpload;
    if (body.autoReceive !== undefined) config.autoReceive = body.autoReceive;
    await saveConfig(config);
    return reply.send({ success: true });
  });

  app.post("/api/bind", async (req: FastifyRequest<{ Body: { serverBaseUrl: string; bindCode: string; deviceName?: string } }>, reply) => {
    const { serverBaseUrl, bindCode, deviceName } = req.body;
    const device = await bindDevice(serverBaseUrl, bindCode, deviceName || "Linux");
    const config = await loadConfig();
    config.device = device;
    await saveConfig(config);
    return reply.send({ success: true });
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
