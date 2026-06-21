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
  watchDir: string;
  watchExcludedDirs: string[];
  autoReceive: boolean;
  autoUpload: boolean;
  copyToClipboard: boolean;
  showNotification: boolean;
  startAtLogin: boolean;
  isBound: boolean;
  tokenStorage: "safeStorage" | "plainFile" | "none";
  tokenStorageWarning?: string;
  boundUser?: BoundUserInfo;
  lastKnownProfile?: string;
  lastKnownPermissions?: DevicePermissions;
  permissionsFetchedAt?: string;
}

export interface BoundUserInfo {
  id: string;
  ownerUserId: string;
  role: string;
  displayName?: string;
}

export type DeviceProfile =
  | "manual_only"
  | "upload_only"
  | "receive_own"
  | "sync_own"
  | "custom";

export const SELECTABLE_DEVICE_PROFILES: DeviceProfile[] = [
  "manual_only",
  "upload_only",
  "receive_own",
  "sync_own",
];

export interface BindCodeTargetUser {
  id: string;
  role: string;
  displayName?: string;
}

export interface BindCodePreview {
  expiresAt: string;
  space: {
    ownerUserId: string;
    displayName: string;
  };
  targetUser: BindCodeTargetUser;
}

export interface DeviceSelfInfo {
  device: {
    id: string;
    name: string;
    platform: string;
    appVersion: string;
    osVersion: string;
    createdAt: string;
    lastSeenAt?: string;
    revokedAt?: string;
  };
  user: BoundUserInfo;
  profile: DeviceProfile;
  permissions: DevicePermissions;
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
  watch: WatchState;
}

export interface WatchState {
  enabled: boolean;
  active: boolean;
  dir: string;
  lastEvent?: string;
  lastError?: string;
  recentUploads: WatchUploadEvent[];
}

export interface WatchUploadEvent {
  fileName: string;
  uploadedAt: string;
  ok: boolean;
  message?: string;
}

export interface RegisterDeviceInput {
  serverBaseUrl: string;
  bindCode: string;
  deviceName: string;
  profile?: DeviceProfile;
}

export interface CreateBindCodeInput {
  serverBaseUrl: string;
  login: string;
  password: string;
  deviceNameHint?: string;
  profile?: DeviceProfile;
}

export interface CreateBindCodeResult {
  bindCode: string;
  expiresAt: string;
  targetUser?: BindCodeTargetUser;
}

export interface SaveSettingsInput {
  serverBaseUrl?: string;
  deviceName?: string;
  downloadDir?: string;
  watchDir?: string;
  watchExcludedDirs?: string[];
  autoReceive?: boolean;
  autoUpload?: boolean;
  copyToClipboard?: boolean;
  showNotification?: boolean;
  startAtLogin?: boolean;
  boundUser?: BoundUserInfo;
  lastKnownProfile?: DeviceProfile;
  lastKnownPermissions?: DevicePermissions;
  permissionsFetchedAt?: string;
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
  user?: BoundUserInfo;
  lastError?: string;
  devices: ManagedDevice[];
}

export interface ManagedDevice {
  id: string;
  userId: string;
  userDisplayName: string;
  userRole?: string;
  name: string;
  platform: string;
  appVersion: string;
  osVersion: string;
  lastSeenAt?: string;
  createdAt: string;
  revokedAt?: string;
  profile?: DeviceProfile;
  receiveSourceDeviceIds?: string[];
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
