#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApiClient } from "./api.js";
import { bindDevice, loadConfig, saveConfig, unbind } from "./config.js";
import { startWatcher } from "./watcher.js";
import { uploadSingle } from "./uploader.js";
import { WsReceiveClient } from "./ws-client.js";
import { defaultDownloadDir, ensureAllowedDir, ensureDir, isAllowedDir, normalizeBaseUrl } from "./utils.js";

/** Run `cleanup` on SIGINT/SIGTERM and exit with code 0. */
function installShutdown(cleanup: () => Promise<void> | void): void {
  let triggered = false;
  const handler = (signal: string) => {
    if (triggered) return;
    triggered = true;
    console.log(`\nReceived ${signal}, shutting down...`);
    Promise.resolve(cleanup()).finally(() => process.exit(0));
  };
  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
}

const program = new Command();

program.name("studyshot-relay").description("StudyShot Relay Linux CLI").version("0.3.0");

program
  .command("bind")
  .description("Bind this Linux client to a StudyShot Relay server")
  .requiredOption("-s, --server <url>", "Server base URL, e.g. http://64.90.30.102:3000")
  .requiredOption("-c, --code <code>", "Bind code from server")
  .option("-n, --name <name>", "Device name", os.hostname())
  .action(async (options) => {
    try {
      const device = await bindDevice(options.server, options.code, options.name);
      const config = await loadConfig();
      config.device = device;
      config.downloadDir = config.downloadDir || defaultDownloadDir();
      await saveConfig(config);
      console.log(`Bound as device ${device.deviceId}`);
      console.log(`Config saved to ${path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "studyshot-relay", "config.json")}`);
    } catch (err) {
      console.error(`Bind failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show current binding and settings")
  .action(async () => {
    const config = await loadConfig();
    if (!config.device) {
      console.log("Not bound. Run: studyshot-relay bind -s <server> -c <code>");
      return;
    }
    console.log("Server:", config.device.serverBaseUrl);
    console.log("Device ID:", config.device.deviceId);
    console.log("Device Name:", config.device.deviceName);
    console.log("Auto Upload:", config.autoUpload);
    console.log("Auto Receive:", config.autoReceive);
    console.log("Watch Dir:", config.watchDir || "(none)");
    console.log("Download Dir:", config.downloadDir || defaultDownloadDir());

    try {
      const api = new ApiClient(config.device);
      const health = await api.healthz();
      console.log("Server health:", health.status);
    } catch (err) {
      console.log("Server health check failed:", (err as Error).message);
    }
  });

program
  .command("unbind")
  .description("Remove local binding")
  .action(async () => {
    await unbind();
    console.log("Unbound.");
  });

program
  .command("upload")
  .description("Upload a single image")
  .argument("<file>", "Image file path")
  .option("--kind <kind>", "sourceKind", "manual_share")
  .action(async (file, options) => {
    const config = await loadConfig();
    if (!config.device) {
      console.error("Not bound. Run bind first.");
      process.exit(1);
    }
    try {
      await uploadSingle({
        device: config.device,
        filePath: path.resolve(file),
        sourceKind: options.kind,
        onLog: console.log,
      });
    } catch (err) {
      console.error(`Upload failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("receive")
  .description("Connect WebSocket and auto-download incoming images")
  .option("-d, --download-dir <dir>", "Directory to save received images")
  .option("--allow-unsafe-path", "Allow non-home/non-tmp paths (logs a warning)", false)
  .action(async (options) => {
    const config = await loadConfig();
    if (!config.device) {
      console.error("Not bound. Run bind first.");
      process.exit(1);
    }
    if (options.downloadDir) {
      try {
        config.downloadDir = await ensureAllowedDir(options.downloadDir, options.allowUnsafePath === true);
      } catch (err) {
        console.error((err as Error).message);
        console.error("Pass --allow-unsafe-path to override (logs a warning).");
        process.exit(1);
      }
      if (options.allowUnsafePath && !isAllowedDir(config.downloadDir).ok) {
        console.warn(`[receive] 警告：下载到非安全路径 ${config.downloadDir}`);
      }
      await saveConfig(config);
    }
    const downloadDir = config.downloadDir || defaultDownloadDir();
    await ensureDir(downloadDir);

    const client = new WsReceiveClient({
      device: config.device,
      config,
      onStatus: console.log,
      onDownload: (filePath) => console.log(`[cli] Received ${filePath}`),
      onError: (message) => console.error(`[cli] ${message}`),
    });

    client.start();

    installShutdown(() => {
      client.stop();
    });
  });

program
  .command("watch")
  .description("Watch a directory and auto-upload new images")
  .argument("<dir>", "Directory to watch")
  .option("--allow-unsafe-path", "Allow non-home/non-tmp paths (logs a warning)", false)
  .action(async (dir, options) => {
    const config = await loadConfig();
    if (!config.device) {
      console.error("Not bound. Run bind first.");
      process.exit(1);
    }
    let watchDir: string;
    try {
      watchDir = await ensureAllowedDir(dir, options.allowUnsafePath === true);
    } catch (err) {
      console.error((err as Error).message);
      console.error("Pass --allow-unsafe-path to override (logs a warning).");
      process.exit(1);
    }
    if (options.allowUnsafePath && !isAllowedDir(watchDir).ok) {
      console.warn(`[watch] 警告：监听非安全路径 ${watchDir}（--allow-unsafe-path）`);
    }
    try {
      await fs.access(watchDir);
    } catch {
      console.error(`Directory not accessible: ${watchDir}`);
      process.exit(1);
    }

    config.watchDir = watchDir;
    config.autoUpload = true;
    await saveConfig(config);

    const watcher = startWatcher({
      device: config.device,
      watchDir,
      onLog: console.log,
      onError: console.error,
    });

    installShutdown(async () => {
      await watcher.close();
    });
  });

program
  .command("launch")
  .description("Launch the web management UI and open browser")
  .option("-p, --port <port>", "Web server port", "0")
  .action(async (options) => {
    try {
      const config = await loadConfig();
      if (!config.device) {
        console.log("尚未绑定设备。启动后将打开配置页面。");
      }
      const { startWebServer, openBrowser } = await import("./web/server.js");
      const port = parseInt(options.port, 10) || 0;
      const server = await startWebServer(port);
      console.log(`Web UI: ${server.url}`);
      openBrowser(server.url);

      installShutdown(async () => {
        await server.close();
      });
    } catch (err) {
      console.error(`Launch failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("run")
  .description("Run both receive and watch modes (if watchDir is configured)")
  .option("-d, --download-dir <dir>", "Directory to save received images")
  .action(async (options) => {
    const config = await loadConfig();
    if (!config.device) {
      console.error("Not bound. Run bind first.");
      process.exit(1);
    }
    if (options.downloadDir) {
      config.downloadDir = path.resolve(options.downloadDir);
      await saveConfig(config);
    }
    const downloadDir = config.downloadDir || defaultDownloadDir();
    await ensureDir(downloadDir);

    let watcher: ReturnType<typeof startWatcher> | undefined;
    if (config.watchDir && config.autoUpload) {
      watcher = startWatcher({
        device: config.device,
        watchDir: config.watchDir,
        onLog: console.log,
        onError: console.error,
      });
    }

    const client = new WsReceiveClient({
      device: config.device,
      config,
      onStatus: console.log,
      onDownload: (filePath) => console.log(`[cli] Received ${filePath}`),
      onError: (message) => console.error(`[cli] ${message}`),
    });
    client.start();

    installShutdown(async () => {
      client.stop();
      await watcher?.close();
    });
  });

program.parse();
