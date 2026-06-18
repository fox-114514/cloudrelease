export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stopped"
  | "error";

export type Platform = "windows" | "linux";

export interface DevicePermissions {
  canAutoUpload: boolean;
  canManualUpload: boolean;
  canAutoReceive: boolean;
  canManualDownload: boolean;
  canManageSpace: boolean;
  canCreateInvite: boolean;
  autoUploadScope: string;
  autoReceiveScope: string;
}

export interface RendererSettings {
  serverBaseUrl: string;
  deviceId?: string;
  deviceName: string;
  downloadDir: string;
  autoReceive: boolean;
  copyToClipboard: boolean;
  showNotification: boolean;
  startAtLogin: boolean;
  isBound: boolean;
  tokenStorage: "safeStorage" | "plainFile" | "none";
  tokenStorageWarning?: string;
}

export interface ConnectionState {
  status: ConnectionStatus;
  lastConnectedAt?: string;
  nextRetryAt?: string;
  lastError?: string;
}

export interface DownloadRecord {
  deliveryId: string;
  imageId: string;
  sourceDeviceName: string;
  savedPath?: string;
  receivedAt: string;
  copiedToClipboard: boolean;
  clipboardError?: string;
  status: "downloaded" | "failed" | "skipped";
  error?: string;
}

export interface RendererState {
  settings: RendererSettings;
  connection: ConnectionState;
  recentDownloads: DownloadRecord[];
  admin: AdminState;
}

export interface RegisterDeviceInput {
  serverBaseUrl: string;
  bindCode: string;
  deviceName: string;
}

export interface CreateBindCodeInput {
  serverBaseUrl: string;
  login: string;
  password: string;
  deviceNameHint?: string;
}

export interface CreateBindCodeResult {
  bindCode: string;
  expiresAt: string;
}

export interface SaveSettingsInput {
  serverBaseUrl?: string;
  deviceName?: string;
  downloadDir?: string;
  autoReceive?: boolean;
  copyToClipboard?: boolean;
  showNotification?: boolean;
  startAtLogin?: boolean;
}

export interface ManualUploadResult {
  imageId: string;
  deduplicated: boolean;
  createdDeliveriesCount: number;
  expiresAt: string;
  fileName: string;
  sha256: string;
}

export interface AdminLoginInput {
  serverBaseUrl: string;
  login: string;
  password: string;
}

export interface AdminState {
  isLoggedIn: boolean;
  login?: string;
  lastError?: string;
  devices: ManagedDevice[];
}

export interface ManagedDevice {
  id: string;
  userId: string;
  userDisplayName: string;
  name: string;
  platform: string;
  appVersion: string;
  osVersion: string;
  lastSeenAt?: string;
  createdAt: string;
  revokedAt?: string;
  permissions: DevicePermissions;
}

export interface ImageMeta {
  id: string;
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  sha256: string;
}

export interface DeliveryPayload {
  deliveryId: string;
  image: ImageMeta;
  source: {
    uploadUserId: string;
    uploadDeviceId: string;
    uploadDeviceName?: string;
  };
  createdAt: string;
  expiresAt: string;
}

export interface ImageCreatedEvent extends DeliveryPayload {
  type: "image.created";
  eventId: string;
}
