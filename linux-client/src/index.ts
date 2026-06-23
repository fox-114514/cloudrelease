#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { ApiClient } from "./api.js";
import {
  bindDevice,
  bindWithLogin,
  loadConfig,
  previewBindCode,
  refreshDeviceIdentity,
  saveConfig,
  serverAllows,
  unbind,
} from "./config.js";
import { startWatcher } from "./watcher.js";
import { uploadSingle } from "./uploader.js";
import { WsReceiveClient } from "./ws-client.js";
import { defaultDownloadDir, ensureAllowedDir, ensureDir, isAllowedDir, normalizeBaseUrl } from "./utils.js";
import { assertExplicitInsecureHttp } from "./utils.js";

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

async function confirmAction(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${prompt} [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function readHiddenPassword(prompt = "Password: "): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("Password input requires an interactive terminal");
  }
  process.stdout.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string | Buffer) => {
      for (const char of String(chunk)) {
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function refreshAndSaveDevice() {
  const config = await loadConfig();
  if (!config.device) throw new Error("Not bound. Run bind first.");
  config.device = await refreshDeviceIdentity(config.device);
  await saveConfig(config);
  return config.device;
}

function printIdentity(device: NonNullable<Awaited<ReturnType<typeof loadConfig>>["device"]>): void {
  console.log("Device:", `${device.deviceName} (${device.deviceId})`);
  console.log("User:", device.user ? `${device.user.displayName || device.user.id} [${device.user.role}]` : "unknown");
  console.log("Profile:", device.profile || "unknown");
  console.log("Permissions:", JSON.stringify(device.permissions ?? {}, null, 2));
}

const program = new Command();

program.name("studyshot-relay").description("StudyShot Relay Linux CLI").version("0.5.0");

program
  .command("bind")
  .description("Bind this Linux client to a StudyShot Relay server")
  .requiredOption("-s, --server <url>", "Server base URL, e.g. https://relay.example.com")
  .requiredOption("-c, --code <code>", "Bind code from server")
  .option("-n, --name <name>", "Device name", os.hostname())
  .option("--profile <profile>", "manual_only|upload_only|receive_own|sync_own", "receive_own")
  .option("--yes", "Confirm the preview without prompting", false)
  .option("--allow-insecure-http", "Allow plaintext http:// for non-loopback hosts (VPN/LAN only, logs a warning)", false)
  .action(async (options) => {
    try {
      assertExplicitInsecureHttp(options.server, { allowInsecureHttp: options.allowInsecureHttp === true });
      const preview = await previewBindCode(options.server, options.code, {
        allowInsecureHttp: options.allowInsecureHttp === true,
      });
      const target = preview.targetUser.displayName || preview.targetUser.id;
      console.log(`Target user: ${target} [${preview.targetUser.role}]`);
      console.log(`Space: ${preview.space.displayName}`);
      if (!options.yes && !(await confirmAction("Bind this device to the target above?"))) {
        console.log("Binding cancelled.");
        return;
      }
      const device = await bindDevice(options.server, options.code, options.name, options.profile, {
        allowInsecureHttp: options.allowInsecureHttp === true,
      });
      const config = await loadConfig();
      config.device = device;
      config.downloadDir = config.downloadDir || defaultDownloadDir();
      config.allowInsecureHttp = config.allowInsecureHttp || options.allowInsecureHttp === true;
      await saveConfig(config);
      if (options.allowInsecureHttp) {
        console.warn("[bind] 警告：明文 HTTP 已启用，token/密码/图片可被窃听，仅限受信 VPN/局域网场景。");
      }
      console.log(`Bound as device ${device.deviceId}`);
      console.log(`Config saved to ${path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "studyshot-relay", "config.json")}`);
    } catch (err) {
      console.error(`Bind failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("bind-login")
  .description("Log in as a member and bind this device to the same account")
  .requiredOption("-s, --server <url>", "Server base URL")
  .requiredOption("-u, --user <login>", "Member login")
  .option("-n, --name <name>", "Device name", os.hostname())
  .option("--profile <profile>", "manual_only|upload_only|receive_own|sync_own", "receive_own")
  .option("--allow-insecure-http", "Allow plaintext http:// for non-loopback hosts (VPN/LAN only, logs a warning)", false)
  .action(async (options) => {
    try {
      assertExplicitInsecureHttp(options.server, { allowInsecureHttp: options.allowInsecureHttp === true });
      const password = await readHiddenPassword();
      const device = await bindWithLogin(
        options.server,
        options.user,
        password,
        options.name,
        options.profile,
        { allowInsecureHttp: options.allowInsecureHttp === true },
      );
      const config = await loadConfig();
      config.device = device;
      config.downloadDir = config.downloadDir || defaultDownloadDir();
      config.allowInsecureHttp = config.allowInsecureHttp || options.allowInsecureHttp === true;
      await saveConfig(config);
      if (options.allowInsecureHttp) {
        console.warn("[bind-login] 警告：明文 HTTP 已启用；token/密码/图片可被窃听。");
      }
      printIdentity(device);
    } catch (err) {
      console.error(`Bind failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

for (const commandName of ["whoami", "permissions", "refresh-permissions"] as const) {
  program
    .command(commandName)
    .description(commandName === "whoami" ? "Show the bound user identity" : "Refresh and show effective server permissions")
    .action(async () => {
      try {
        const device = await refreshAndSaveDevice();
        if (commandName === "whoami") {
          console.log(device.user ? `${device.user.displayName || device.user.id} [${device.user.role}]` : "unknown");
        } else {
          console.log(JSON.stringify(device.permissions ?? {}, null, 2));
        }
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      }
    });
}

program
  .command("status")
  .description("Show current binding and settings")
  .action(async () => {
    const config = await loadConfig();
    if (!config.device) {
      console.log("Not bound. Run: studyshot-relay bind -s <server> -c <code>");
      return;
    }
    try {
      config.device = await refreshDeviceIdentity(config.device);
      await saveConfig(config);
    } catch (err) {
      console.log("Permission refresh failed; showing cached identity:", (err as Error).message);
    }
    console.log("Server:", config.device.serverBaseUrl);
    console.log("Device ID:", config.device.deviceId);
    console.log("Device Name:", config.device.deviceName);
    console.log("Bound User:", config.device.user?.displayName || config.device.user?.id || "unknown");
    console.log("Profile:", config.device.profile || "unknown");
    console.log("Auto Upload:", config.autoUpload);
    console.log("Auto Receive:", config.autoReceive);
    console.log("Copy To Clipboard:", config.copyToClipboard);
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
    config.device = await refreshDeviceIdentity(config.device);
    await saveConfig(config);
    const requiredPermission = options.kind === "manual_share" ? "canManualUpload" : "canAutoUpload";
    if (!serverAllows(config.device, requiredPermission)) {
      console.error("Server does not allow this upload mode for this device.");
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
    config.device = await refreshDeviceIdentity(config.device);
    await saveConfig(config);
    if (!serverAllows(config.device, "canAutoReceive")) {
      console.error("Server does not allow automatic receive for this device.");
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
      onPending: (count) => {
        if (count === 0) return;
        console.log(`[cli] ${count} offline image(s) are waiting; they were not downloaded automatically.`);
        void confirmAction(`Receive these ${count} offline image(s) now?`).then((accepted) => {
          if (accepted) void client.acceptPending();
        });
      },
      onError: (message) => console.error(`[cli] ${message}`),
    });

    client.start();

    const permissionTimer = setInterval(() => {
      void refreshAndSaveDevice()
        .then((device) => {
          if (!serverAllows(device, "canAutoReceive")) {
            console.error("Server disabled automatic receive; stopping.");
            clearInterval(permissionTimer);
            client.stop();
          }
        })
        .catch((err) => console.error(`Permission refresh failed: ${(err as Error).message}`));
    }, 5 * 60 * 1000);

    installShutdown(() => {
      clearInterval(permissionTimer);
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
    config.device = await refreshDeviceIdentity(config.device);
    await saveConfig(config);
    if (!serverAllows(config.device, "canAutoUpload")) {
      console.error("Server does not allow automatic upload for this device.");
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
      excludedDirs: config.downloadDir ? [config.downloadDir] : [],
      onLog: console.log,
      onError: console.error,
    });

    const permissionTimer = setInterval(() => {
      void refreshAndSaveDevice()
        .then(async (device) => {
          if (!serverAllows(device, "canAutoUpload")) {
            console.error("Server disabled automatic upload; stopping watcher.");
            clearInterval(permissionTimer);
            await watcher.close();
          }
        })
        .catch((err) => console.error(`Permission refresh failed: ${(err as Error).message}`));
    }, 5 * 60 * 1000);

    installShutdown(async () => {
      clearInterval(permissionTimer);
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
      // Open via the one-time boot URL so the browser can mint a session
      // cookie without exposing the device token to anyone scanning ports.
      openBrowser(server.bootUrl);

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
    config.device = await refreshDeviceIdentity(config.device);
    await saveConfig(config);
    if (options.downloadDir) {
      config.downloadDir = path.resolve(options.downloadDir);
      await saveConfig(config);
    }
    const downloadDir = config.downloadDir || defaultDownloadDir();
    await ensureDir(downloadDir);

    let watcher: ReturnType<typeof startWatcher> | undefined;
    if (config.watchDir && config.autoUpload && serverAllows(config.device, "canAutoUpload")) {
      watcher = startWatcher({
        device: config.device,
        watchDir: config.watchDir,
        excludedDirs: config.downloadDir ? [config.downloadDir] : [],
        onLog: console.log,
        onError: console.error,
      });
    }

    const client = config.autoReceive && serverAllows(config.device, "canAutoReceive")
      ? new WsReceiveClient({
          device: config.device,
          config,
          onStatus: console.log,
          onDownload: (filePath) => console.log(`[cli] Received ${filePath}`),
          onPending: (count) => {
            if (count > 0) {
              console.log(`[cli] ${count} offline image(s) are waiting; run interactively to accept them.`);
            }
          },
          onError: (message) => console.error(`[cli] ${message}`),
        })
      : undefined;
    client?.start();

    const permissionTimer = setInterval(() => {
      void refreshAndSaveDevice()
        .then(async (device) => {
          if (!serverAllows(device, "canAutoReceive")) client?.stop();
          if (!serverAllows(device, "canAutoUpload")) await watcher?.close();
          if (!serverAllows(device, "canAutoReceive") && !serverAllows(device, "canAutoUpload")) {
            clearInterval(permissionTimer);
          }
        })
        .catch((err) => console.error(`Permission refresh failed: ${(err as Error).message}`));
    }, 5 * 60 * 1000);

    installShutdown(async () => {
      clearInterval(permissionTimer);
      client?.stop();
      await watcher?.close();
    });
  });

program.parse();
