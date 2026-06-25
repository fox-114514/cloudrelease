export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stopped"
  | "error";

export const CLIENT_VERSION = "0.5.1";

export type Platform = "windows" | "linux";

export type UpdateChannel = "windows" | "linux-desktop";

export interface AppUpdateInfo {
  channel: UpdateChannel;
  versionName: string;
  releaseNotes: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  downloadPath: string;
}

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
  /**
   * True when the user explicitly allowed plaintext HTTP for the server URL.
   * Defaults to false; the renderer shows a persistent warning banner when
   * the stored serverBaseUrl is a non-loopback http:// URL.
   */
  allowInsecureHttp: boolean;
  /**
   * Set by the config store when the stored serverBaseUrl is a non-loopback
   * http:// URL. The renderer surfaces a persistent banner while this is true.
   */
  insecureHttpWarning?: string;
  /**
   * R0-2: True when an already-bound config uses a non-loopback http:// URL
   * but allowInsecureHttp has not been set. Until the user explicitly
   * confirms (or switches to https://), the client MUST NOT issue any
   * network request that carries the device token. Surfaces a confirmation
   * banner in the renderer.
   */
  httpConfirmationPending: boolean;
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
  sha256?: string;
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
  pendingOfflineCount: number;
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
  /** Set to true to allow non-loopback http:// URLs. */
  allowInsecureHttp?: boolean;
}

export interface CreateBindCodeInput {
  serverBaseUrl: string;
  login: string;
  password: string;
  deviceNameHint?: string;
  profile?: DeviceProfile;
  /** Set to true to allow non-loopback http:// URLs. */
  allowInsecureHttp?: boolean;
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
  allowInsecureHttp?: boolean;
}

export interface ManualUploadResult {
  imageId: string;
  deduplicated: boolean;
  createdDeliveriesCount: number;
  expiresAt: string;
  fileName: string;
  sha256: string;
}

export interface LibraryImage {
  id: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  sourceDisplayName?: string;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
  uploadedBy: {
    userDisplayName: string;
    deviceName: string;
  };
}

export interface ImageLibraryPage {
  images: LibraryImage[];
  nextCursor?: string;
}

export interface ManualLibraryDownloadResult {
  imageId: string;
  savedPath: string;
  copiedToClipboard: boolean;
}

export interface AdminLoginInput {
  serverBaseUrl: string;
  login: string;
  password: string;
  /** Set to true to allow non-loopback http:// URLs. */
  allowInsecureHttp?: boolean;
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
