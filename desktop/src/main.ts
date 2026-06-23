import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import os from "node:os";
import path from "node:path";
import { ConfigStore } from "./config-store";
import { HistoryStore } from "./history-store";
import { logError, logInfo, logWarn } from "./logger";
import { RelayClient } from "./relay-client";
import type {
  AdminLoginInput,
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
let permissionRefreshTimer: NodeJS.Timeout | undefined;
let isQuitting = false;

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
      sandbox: false,
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
  return new DirectoryWatcher({
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
      directoryWatcher = null;
      relayClient?.updateWatchState({ active: false, lastError: message });
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
}

async function startDirectoryWatcher(): Promise<void> {
  if (directoryWatcher) {
    return;
  }
  if (!relayClient) return;
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
  await w.stop();
  relayClient?.updateWatchState({ active: false });
}

async function applyWatcherConfig(): Promise<void> {
  const enabled =
    configStore.autoUpload &&
    configStore.settings.isBound &&
    configStore.settings.lastKnownPermissions?.canAutoUpload !== false;
  relayClient?.updateWatchState({
    enabled,
    dir: configStore.watchDir,
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

  registerIpcHandlers();
  createWindow();
  createTray();

  if (configStore.settings.isBound) {
    try {
      await relayClient.refreshEffectivePermissions();
    } catch (err) {
      logWarn("Unable to refresh effective permissions at startup; using cached permissions", {
        error: String(err),
      });
    }
  }

  if (
    configStore.autoReceive &&
    configStore.settings.isBound &&
    configStore.settings.lastKnownPermissions?.canAutoReceive !== false
  ) {
    relayClient.connect();
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
