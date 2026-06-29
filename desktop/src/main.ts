import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { ConfigStore } from "./config-store";
import { HistoryStore } from "./history-store";
import { logError, logInfo, logWarn } from "./logger";
import { RelayClient } from "./relay-client";
import type {
  AdminLoginInput,
  AppUpdateInfo,
  CreateBindCodeInput,
  DevicePermissions,
  DeviceProfile,
  ManualUploadResult,
  LibraryImage,
  RegisterDeviceInput,
  SaveSettingsInput,
} from "./shared";
import { DirectoryWatcher } from "./watcher";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let configStore: ConfigStore;
let historyStore: HistoryStore;
let relayClient: RelayClient;
let directoryWatcher: DirectoryWatcher | null = null;
let directoryWatcherTeardown: Promise<void> = Promise.resolve();
let permissionRefreshTimer: NodeJS.Timeout | undefined;
let isQuitting = false;
let updatePromptVersion: string | undefined;
let updateDownloadInProgress = false;

function rendererPath(file: string): string {
  return path.join(__dirname, "renderer", file);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 820,
    minHeight: 620,
    title: "StudyShot Relay",
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(rendererPath("index.html")).catch((err) => {
    logError("Failed to load renderer", { error: String(err) });
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function broadcastState(): void {
  mainWindow?.webContents.send("state:changed", relayClient.getState());
  updateTrayMenu();
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (value: string) => value.split("-")[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
  const next = parse(candidate);
  const installed = parse(current);
  for (let index = 0; index < Math.max(next.length, installed.length); index += 1) {
    const difference = (next[index] ?? 0) - (installed[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function showDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options);
}

async function promptForUpdate(release: AppUpdateInfo, manual = false): Promise<void> {
  if (!isNewerVersion(release.versionName, app.getVersion())) {
    if (manual) {
      await showDialog({
        type: "info",
        title: "检查更新",
        message: `当前已是最新版本 ${app.getVersion()}`,
      });
    }
    return;
  }
  if (!manual && updatePromptVersion === release.versionName) return;
  updatePromptVersion = release.versionName;
  const result = await showDialog({
    type: "info",
    title: "StudyShot Relay 更新",
    message: `发现新版本 ${release.versionName}`,
    detail: release.releaseNotes || "安装包由当前 StudyShot 服务器提供。下载完成并校验后将打开安装程序。",
    buttons: ["下载并安装", "稍后"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (result.response !== 0 || updateDownloadInProgress) return;

  updateDownloadInProgress = true;
  try {
    const updateDir = path.join(app.getPath("downloads"), "StudyShot Relay");
    const packagePath = await relayClient.downloadUpdate(release, updateDir);
    const ready = await showDialog({
      type: "info",
      title: "更新已下载",
      message: `已保存并校验 ${path.basename(packagePath)}`,
      detail: `位置：${packagePath}`,
      buttons: ["打开安装程序", "稍后"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (ready.response === 0) await launchUpdatePackage(packagePath);
  } catch (err) {
    await showDialog({
      type: "error",
      title: "更新失败",
      message: (err as Error).message || String(err),
    });
  } finally {
    updateDownloadInProgress = false;
  }
}

async function launchUpdatePackage(packagePath: string): Promise<void> {
  if (process.platform === "win32") {
    await spawnDetached(packagePath, []);
    isQuitting = true;
    app.quit();
    return;
  }
  if (process.platform === "linux" && packagePath.toLowerCase().endsWith(".deb")) {
    await launchDebPackage(packagePath);
    return;
  }
  if (packagePath.toLowerCase().endsWith(".appimage")) {
    await chmod(packagePath, 0o755);
    await spawnDetached(packagePath, []);
    isQuitting = true;
    app.quit();
    return;
  }
  const error = await shell.openPath(packagePath);
  if (error) throw new Error(error);
}

async function launchDebPackage(packagePath: string): Promise<void> {
  try {
    await spawnDetached("pkexec", ["apt", "install", "-y", packagePath]);
    await showDialog({
      type: "info",
      title: "系统安装已启动",
      message: "请在系统权限提示中确认安装。安装完成后重启 StudyShot Relay。",
      detail: `如果没有弹出权限提示，可在终端运行：sudo apt install ${quoteShellArg(packagePath)}`,
    });
  } catch (err) {
    logWarn("Failed to launch deb installer via pkexec", { error: String(err) });
    const error = await shell.openPath(packagePath);
    if (error) {
      throw new Error(
        `${error}\n也可以在终端运行：sudo apt install ${quoteShellArg(packagePath)}`,
      );
    }
  }
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function checkForUpdates(manual = false): Promise<void> {
  try {
    const release = await relayClient.checkForUpdate();
    if (release) await promptForUpdate(release, manual);
    else if (manual) {
      await showDialog({
        type: "info",
        title: "检查更新",
        message: "服务器当前没有发布此平台的更新包。",
      });
    }
  } catch (err) {
    if (manual) {
      await showDialog({
        type: "error",
        title: "检查更新失败",
        message: (err as Error).message || String(err),
      });
    } else {
      logWarn("Automatic update check failed", { error: String(err) });
    }
  }
}

function createTrayIcon(): Electron.NativeImage {
  const svg = `
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="7" fill="#0f7b6c"/>
      <path d="M8 10.5h16v11H8z" fill="none" stroke="#fff" stroke-width="2"/>
      <path d="M11 18l3-3 3 3 2-2 3 3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("StudyShot Relay");
  tray.on("click", () => showMainWindow());
  updateTrayMenu();
}

async function setAutoReceive(enabled: boolean): Promise<void> {
  await configStore.saveSettings({ autoReceive: enabled });
  await relayClient.handleSettingsChanged();
  broadcastState();
}

function effectiveWatchExcludedDirs(dir: string): string[] {
  const excludedDirs = [...configStore.watchExcludedDirs];
  const relativeDownload = path.relative(path.resolve(dir), path.resolve(configStore.downloadDir));
  if (
    relativeDownload === "" ||
    (!relativeDownload.startsWith("..") && !path.isAbsolute(relativeDownload))
  ) {
    excludedDirs.push(configStore.downloadDir);
  }
  return [...new Set(excludedDirs.map((value) => path.resolve(value)))];
}

function buildWatcher(dir: string): DirectoryWatcher {
  const excludedDirs = effectiveWatchExcludedDirs(dir);
  let instance: DirectoryWatcher;
  instance = new DirectoryWatcher({
    watchDir: dir,
    excludedDirs,
    onLog: (message) => logInfo(`[watch] ${message}`),
    // Single-file upload failures record themselves via appendWatchUpload
    // inside onFile below; they MUST NOT flip watch.active=false, otherwise
    // the UI would tell the user the watcher died when only one image
    // failed. Plan 0.5.1 §2.4.2.
    onUploadError: (message) => {
      logError(`[watch] ${message}`);
    },
    // Fatal watcher errors (chokidar 'error' event) tear down the watcher
    // inside DirectoryWatcher. We additionally clear our module-level
    // handle and update UI state so the user can click "start" again.
    onFatal: (message) => {
      logError(`[watch] ${message}`);
      if (directoryWatcher === instance) {
        directoryWatcher = null;
        relayClient?.updateWatchState({ active: false, lastError: message });
      }
    },
    onFile: async (filePath) => {
      if (!relayClient) return;
      try {
        const result = await relayClient.uploadScreenshotFromPath(filePath);
        relayClient.appendWatchUpload({
          fileName: result.fileName,
          uploadedAt: new Date().toISOString(),
          ok: true,
        });
        logInfo("Watch upload succeeded", { file: filePath, imageId: result.imageId });
      } catch (err) {
        const message = (err as Error).message || String(err);
        relayClient.appendWatchUpload({
          fileName: path.basename(filePath),
          uploadedAt: new Date().toISOString(),
          ok: false,
          message,
        });
        throw err;
      }
    },
  });
  return instance;
}

async function startDirectoryWatcher(): Promise<void> {
  await directoryWatcherTeardown.catch(() => undefined);
  if (directoryWatcher) {
    return;
  }
  if (!relayClient) return;
  // R0-2: don't start the file watcher while HTTP authorization is pending —
  // the onFile handler would try to upload and ship the device token over
  // plaintext. The renderer's confirmation banner lets the user resolve it.
  if (configStore.settings.httpConfirmationPending) {
    relayClient.updateWatchState({
      active: false,
      lastError: "明文 HTTP 尚未授权，请在设置中确认或切换 HTTPS 后再启动监听。",
    });
    return;
  }
  if (configStore.settings.lastKnownPermissions?.canAutoUpload === false) {
    relayClient.updateWatchState({ active: false, lastError: "服务端未允许本设备自动上传" });
    return;
  }
  const dir = configStore.watchDir;
  if (!dir) {
    relayClient.updateWatchState({ active: false, lastError: "未配置监听目录" });
    return;
  }
  directoryWatcher = buildWatcher(dir);
  try {
    await directoryWatcher.start();
    relayClient.updateWatchState({
      active: true,
      dir,
      lastError: undefined,
    });
  } catch (err) {
    const message = (err as Error).message || String(err);
    relayClient.updateWatchState({ active: false, lastError: message });
    directoryWatcher = null;
  }
}

async function stopDirectoryWatcher(): Promise<void> {
  if (!directoryWatcher) return;
  const w = directoryWatcher;
  directoryWatcher = null;
  const teardown = w.stop();
  directoryWatcherTeardown = teardown;
  try {
    await teardown;
  } finally {
    if (directoryWatcherTeardown === teardown) {
      directoryWatcherTeardown = Promise.resolve();
    }
  }
  relayClient?.updateWatchState({ active: false });
}

async function applyWatcherConfig(): Promise<void> {
  const httpPending = configStore.settings.httpConfirmationPending;
  const enabled =
    configStore.autoUpload &&
    configStore.settings.isBound &&
    !httpPending &&
    configStore.settings.lastKnownPermissions?.canAutoUpload !== false;
  relayClient?.updateWatchState({
    enabled,
    dir: configStore.watchDir,
    lastError: httpPending && configStore.autoUpload && configStore.settings.isBound
      ? "明文 HTTP 尚未授权，监听已暂停。"
      : undefined,
  });
  if (enabled) {
    if (!directoryWatcher || !directoryWatcher.matches(
      configStore.watchDir,
      effectiveWatchExcludedDirs(configStore.watchDir),
    )) {
      await stopDirectoryWatcher();
      await startDirectoryWatcher();
    }
  } else {
    await stopDirectoryWatcher();
  }
}

async function refreshPermissionsAndApply(): Promise<void> {
  if (!configStore.settings.isBound) return;
  await relayClient.refreshEffectivePermissions();
  await relayClient.handleSettingsChanged();
  await applyWatcherConfig();
  broadcastState();
}

function updateTrayMenu(): void {
  if (!tray || !relayClient) return;

  const state = relayClient.getState();
  const status = state.connection.status;
  const statusText =
    status === "connected"
      ? "已连接"
      : status === "connecting"
        ? "连接中"
        : status === "reconnecting"
          ? "重连中"
          : status === "error"
            ? "错误"
            : "未连接";

  tray.setToolTip(`StudyShot Relay - ${statusText}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `状态：${statusText}`, enabled: false },
      { type: "separator" },
      { label: "打开窗口", click: () => showMainWindow() },
      {
        label: state.settings.autoReceive ? "暂停自动接收" : "恢复自动接收",
        enabled: state.settings.isBound,
        click: () => {
          setAutoReceive(!state.settings.autoReceive).catch((err) =>
            logError("Failed to toggle auto receive from tray", { error: String(err) })
          );
        },
      },
      {
        label: state.watch.active ? "停止监听目录" : "启动监听目录",
        enabled: state.settings.isBound && Boolean(state.settings.watchDir),
        click: async () => {
          try {
            if (state.watch.active) {
              await stopDirectoryWatcher();
            } else {
              await startDirectoryWatcher();
            }
            broadcastState();
          } catch (err) {
            logError("Failed to toggle watcher from tray", { error: String(err) });
          }
        },
      },
      {
        label: "补收 pending",
        enabled: state.settings.isBound,
        click: () => {
          relayClient.fetchPending().catch((err) =>
            logError("Failed to fetch pending from tray", { error: String(err) })
          );
        },
      },
      { label: "打开下载目录", click: () => shell.openPath(configStore.downloadDir || os.homedir()) },
      {
        label: "检查更新",
        enabled: state.settings.isBound,
        click: () => { void checkForUpdates(true); },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          relayClient.disconnect();
          stopDirectoryWatcher().catch(() => undefined);
          app.quit();
        },
      },
    ])
  );
}

function registerIpcHandlers(): void {
  ipcMain.handle("state:get", () => relayClient.getState());

  ipcMain.handle("device:register", async (_event, input: RegisterDeviceInput) => {
    await relayClient.registerDevice(input);
    await applyWatcherConfig();
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("bindCode:preview", async (_event, serverBaseUrl: string, bindCode: string, allowInsecureHttp?: boolean) => {
    return relayClient.previewBindCode(serverBaseUrl, bindCode, { allowInsecureHttp: allowInsecureHttp === true });
  });

  ipcMain.handle("device:me", async () => {
    return relayClient.getDeviceMe();
  });

  ipcMain.handle("device:refreshPermissions", async () => {
    try {
      const result = await relayClient.refreshEffectivePermissions();
      await relayClient.handleSettingsChanged();
      await applyWatcherConfig();
      broadcastState();
      return result;
    } catch (err) {
      logWarn("Failed to refresh effective permissions", { error: String(err) });
      return undefined;
    }
  });

  ipcMain.handle("device:updateProfile", async (_event, profile) => {
    await relayClient.updateDeviceProfile(profile);
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("device:updateReceiveConfig", async (_event, mode, sourceDeviceIds) => {
    await relayClient.updateReceiveConfig(mode, sourceDeviceIds);
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("bind:login", async (_event, input: CreateBindCodeInput) => {
    const result = await relayClient.bindWithLogin(input);
    await applyWatcherConfig();
    broadcastState();
    return result;
  });

  ipcMain.handle("settings:save", async (_event, input: SaveSettingsInput) => {
    await configStore.saveSettings(input);
    await relayClient.handleSettingsChanged();
    await applyWatcherConfig();
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("connection:connect", async () => {
    relayClient.connect();
    return relayClient.getState();
  });

  ipcMain.handle("connection:disconnect", async () => {
    relayClient.disconnect();
    return relayClient.getState();
  });

  ipcMain.handle("deliveries:fetchPending", async () => {
    await relayClient.fetchPending();
    return relayClient.getState();
  });

  ipcMain.handle("deliveries:skipPending", async () => {
    await relayClient.skipPending();
    return relayClient.getState();
  });

  ipcMain.handle("upload:chooseAndUpload", async (): Promise<ManualUploadResult | undefined> => {
    const options = {
      title: "选择要上传的图片",
      properties: ["openFile"] as Array<"openFile">,
      filters: [
        { name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return undefined;
    }
    return relayClient.uploadManualImage(result.filePaths[0]);
  });

  ipcMain.handle("library:list", async () => relayClient.listLibraryImages());
  ipcMain.handle("library:download", async (_event, image: LibraryImage) =>
    relayClient.downloadLibraryImage(image)
  );

  ipcMain.handle("dialog:chooseDownloadDir", async () => {
    const options = {
      title: "选择下载目录",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return undefined;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("downloadDir:open", async () => {
    const dir = configStore.downloadDir;
    if (!dir) {
      throw new Error("下载目录未配置");
    }
    await shell.openPath(dir);
    return true;
  });

  ipcMain.handle("dialog:chooseWatchDir", async () => {
    const options = {
      title: "选择监听目录(自动上传新文件)",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return undefined;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("dialog:chooseWatchExcludedDir", async () => {
    const options = {
      title: "选择要排除的子文件夹",
      defaultPath: configStore.watchDir,
      properties: ["openDirectory"] as Array<"openDirectory">,
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return undefined;
    }
    const selected = path.resolve(result.filePaths[0]);
    const root = path.resolve(configStore.watchDir);
    const relative = path.relative(root, selected);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("只能排除监听目录内的子文件夹");
    }
    return selected;
  });

  ipcMain.handle("watchDir:open", async () => {
    const dir = configStore.watchDir;
    if (dir) {
      await shell.openPath(dir);
    }
    return true;
  });

  ipcMain.handle("watch:start", async () => {
    await startDirectoryWatcher();
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("watch:stop", async () => {
    await stopDirectoryWatcher();
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("watch:hideRecord", async (_event, uploadedAt: string) => {
    relayClient.hideWatchUpload(uploadedAt);
    return relayClient.getState();
  });

  ipcMain.handle("watch:clearRecords", async () => {
    relayClient.clearWatchUploads();
    return relayClient.getState();
  });

  ipcMain.handle("history:copyToClipboard", async (_event, deliveryId: string) => {
    const record = await relayClient.copyRecordToClipboard(deliveryId);
    broadcastState();
    return record;
  });

  ipcMain.handle("history:showInFolder", async (_event, deliveryId: string) => {
    const record = historyStore.find(deliveryId);
    if (!record?.savedPath) {
      throw new Error("没有可定位的本地文件");
    }
    shell.showItemInFolder(record.savedPath);
    return true;
  });

  ipcMain.handle("history:hide", async (_event, deliveryId: string) => {
    await historyStore.remove(deliveryId);
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("history:clear", async () => {
    await historyStore.clear();
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("admin:login", async (_event, input: AdminLoginInput) => {
    await relayClient.adminLogin(input);
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("admin:logout", async () => {
    relayClient.adminLogout();
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("admin:refreshDevices", async () => {
    await relayClient.adminRefreshDevices();
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("admin:updatePermissions", async (_event, deviceId: string, permissions: Partial<DevicePermissions>) => {
    await relayClient.adminUpdateDevicePermissions(deviceId, permissions);
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("admin:updateProfile", async (_event, deviceId: string, profile: DeviceProfile) => {
    await relayClient.adminUpdateDeviceProfile(deviceId, profile);
    await applyWatcherConfig();
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle(
    "admin:updateReceiveConfig",
    async (
      _event,
      deviceId: string,
      mode: "disabled" | "same_user_only" | "selected_devices" | "all_authorized_sources",
      sourceDeviceIds: string[],
    ) => {
      await relayClient.adminUpdateReceiveConfig(deviceId, mode, sourceDeviceIds);
      broadcastState();
      return relayClient.getState();
    },
  );

  ipcMain.handle("admin:renameDevice", async (_event, deviceId: string, name: string) => {
    await relayClient.adminRenameDevice(deviceId, name);
    broadcastState();
    return relayClient.getState();
  });

  ipcMain.handle("admin:revokeDevice", async (_event, deviceId: string) => {
    await relayClient.adminRevokeDevice(deviceId);
    broadcastState();
    return relayClient.getState();
  });
}

async function start(): Promise<void> {
  await app.whenReady();

  configStore = new ConfigStore();
  await configStore.load();
  historyStore = new HistoryStore();
  await historyStore.load();
  relayClient = new RelayClient(configStore, historyStore);
  relayClient.onState(() => broadcastState());
  relayClient.onUpdate((release) => { void promptForUpdate(release); });

  registerIpcHandlers();
  createWindow();
  createTray();

  // R0-2: an already-bound config with a non-loopback http:// URL that was
  // never explicitly authorized (typical 0.5.0 → 0.5.1 upgrade) must NOT
  // issue any token-bearing request at startup. We surface a confirmation
  // banner in the renderer; only after the user confirms do we connect and
  // refresh. The watcher is also gated because auto-upload would send the
  // token. The permission refresh timer keeps running but
  // refreshEffectivePermissions → getDeviceMe re-checks the gate.
  const httpConfirmationPending = configStore.settings.httpConfirmationPending;

  if (configStore.settings.isBound && !httpConfirmationPending) {
    try {
      await relayClient.refreshEffectivePermissions();
    } catch (err) {
      logWarn("Unable to refresh effective permissions at startup; using cached permissions", {
        error: String(err),
      });
    }
  }

  if (!httpConfirmationPending && configStore.settings.isBound) {
    relayClient.connect();
    void checkForUpdates(false);
  }

  await applyWatcherConfig();

  permissionRefreshTimer = setInterval(() => {
    refreshPermissionsAndApply().catch((err) => {
      logWarn("Periodic effective-permission refresh failed", { error: String(err) });
    });
  }, 5 * 60 * 1000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  logInfo("Desktop client started");
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (permissionRefreshTimer) clearInterval(permissionRefreshTimer);
  permissionRefreshTimer = undefined;
});

start().catch((err) => {
  logError("Desktop client failed to start", { error: String(err) });
  dialog.showErrorBox("StudyShot Relay", String(err));
  app.quit();
});
