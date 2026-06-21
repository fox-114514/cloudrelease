import { contextBridge, ipcRenderer } from "electron";
import type {
  AdminLoginInput,
  BindCodePreview,
  CreateBindCodeInput,
  DevicePermissions,
  DeviceProfile,
  DeviceSelfInfo,
  ManualUploadResult,
  RegisterDeviceInput,
  RendererState,
  SaveSettingsInput,
} from "./shared";

const api = {
  getState: (): Promise<RendererState> => ipcRenderer.invoke("state:get"),
  registerDevice: (input: RegisterDeviceInput): Promise<RendererState> =>
    ipcRenderer.invoke("device:register", input),
  previewBindCode: (serverBaseUrl: string, bindCode: string): Promise<BindCodePreview> =>
    ipcRenderer.invoke("bindCode:preview", serverBaseUrl, bindCode),
  getDeviceMe: (): Promise<DeviceSelfInfo> => ipcRenderer.invoke("device:me"),
  refreshEffectivePermissions: (): Promise<DeviceSelfInfo | undefined> =>
    ipcRenderer.invoke("device:refreshPermissions"),
  updateDeviceProfile: (profile: DeviceProfile): Promise<RendererState> =>
    ipcRenderer.invoke("device:updateProfile", profile),
  updateReceiveConfig: (
    mode: "disabled" | "same_user_only" | "selected_devices" | "all_authorized_sources",
    sourceDeviceIds: string[]
  ): Promise<RendererState> =>
    ipcRenderer.invoke("device:updateReceiveConfig", mode, sourceDeviceIds),
  bindWithLogin: (input: CreateBindCodeInput): Promise<DeviceSelfInfo> =>
    ipcRenderer.invoke("bind:login", input),
  saveSettings: (input: SaveSettingsInput): Promise<RendererState> =>
    ipcRenderer.invoke("settings:save", input),
  connect: (): Promise<RendererState> => ipcRenderer.invoke("connection:connect"),
  disconnect: (): Promise<RendererState> => ipcRenderer.invoke("connection:disconnect"),
  fetchPending: (): Promise<RendererState> => ipcRenderer.invoke("deliveries:fetchPending"),
  chooseAndUploadImage: (): Promise<ManualUploadResult | undefined> =>
    ipcRenderer.invoke("upload:chooseAndUpload"),
  chooseDownloadDir: (): Promise<string | undefined> => ipcRenderer.invoke("dialog:chooseDownloadDir"),
  openDownloadDir: (): Promise<boolean> => ipcRenderer.invoke("downloadDir:open"),
  chooseWatchDir: (): Promise<string | undefined> => ipcRenderer.invoke("dialog:chooseWatchDir"),
  chooseWatchExcludedDir: (): Promise<string | undefined> =>
    ipcRenderer.invoke("dialog:chooseWatchExcludedDir"),
  openWatchDir: (): Promise<boolean> => ipcRenderer.invoke("watchDir:open"),
  startWatcher: (): Promise<RendererState> => ipcRenderer.invoke("watch:start"),
  stopWatcher: (): Promise<RendererState> => ipcRenderer.invoke("watch:stop"),
  copyHistoryToClipboard: (deliveryId: string): Promise<unknown> =>
    ipcRenderer.invoke("history:copyToClipboard", deliveryId),
  showHistoryInFolder: (deliveryId: string): Promise<boolean> =>
    ipcRenderer.invoke("history:showInFolder", deliveryId),
  adminLogin: (input: AdminLoginInput): Promise<RendererState> => ipcRenderer.invoke("admin:login", input),
  adminLogout: (): Promise<RendererState> => ipcRenderer.invoke("admin:logout"),
  adminRefreshDevices: (): Promise<RendererState> => ipcRenderer.invoke("admin:refreshDevices"),
  adminUpdatePermissions: (
    deviceId: string,
    permissions: Partial<DevicePermissions>
  ): Promise<RendererState> => ipcRenderer.invoke("admin:updatePermissions", deviceId, permissions),
  adminUpdateProfile: (deviceId: string, profile: DeviceProfile): Promise<RendererState> =>
    ipcRenderer.invoke("admin:updateProfile", deviceId, profile),
  adminUpdateReceiveConfig: (
    deviceId: string,
    mode: "disabled" | "same_user_only" | "selected_devices" | "all_authorized_sources",
    sourceDeviceIds: string[],
  ): Promise<RendererState> =>
    ipcRenderer.invoke("admin:updateReceiveConfig", deviceId, mode, sourceDeviceIds),
  adminRenameDevice: (deviceId: string, name: string): Promise<RendererState> =>
    ipcRenderer.invoke("admin:renameDevice", deviceId, name),
  adminRevokeDevice: (deviceId: string): Promise<RendererState> =>
    ipcRenderer.invoke("admin:revokeDevice", deviceId),
  onStateChanged: (listener: (state: RendererState) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: RendererState): void => {
      try {
        listener(state);
      } catch (err) {
        console.error("[studyshot] state:changed listener threw:", err);
      }
    };
    ipcRenderer.on("state:changed", wrapped);
    return () => ipcRenderer.removeListener("state:changed", wrapped);
  },
};

contextBridge.exposeInMainWorld("studyshot", api);

export type StudyShotApi = typeof api;
