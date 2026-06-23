export interface HttpSafetyOpts {
    /**
     * Whether the caller has explicitly opted into plaintext HTTP for non-
     * loopback hosts. Bind/preview/login/identity-refresh will reject http://
     * for non-loopback hosts unless this is true. Loopback is always allowed.
     */
    allowInsecureHttp?: boolean;
}
export interface DeviceConfig {
    serverBaseUrl: string;
    deviceId: string;
    deviceToken: string;
    deviceName: string;
    user?: BoundUserInfo;
    profile?: string;
    permissions?: DevicePermissions;
    permissionsFetchedAt?: string;
}
export interface BoundUserInfo {
    id: string;
    ownerUserId: string;
    role: string;
    displayName?: string;
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
export interface BindCodePreview {
    expiresAt: string;
    space: {
        ownerUserId: string;
        displayName: string;
    };
    targetUser: {
        id: string;
        role: string;
        displayName?: string;
    };
}
export interface AppConfig {
    device?: DeviceConfig;
    autoUpload: boolean;
    autoReceive: boolean;
    copyToClipboard: boolean;
    watchDir?: string;
    downloadDir?: string;
    uploadedHashes: string[];
    receivedHashes: string[];
    /**
     * Whether the user explicitly allowed plaintext HTTP for the stored
     * serverBaseUrl. Set via the launch Web UI checkbox or the CLI's
     * --allow-insecure-http flag at bind time. Refreshes against an already-
     * bound device inherit this setting.
     */
    allowInsecureHttp: boolean;
}
export declare function loadConfig(): Promise<AppConfig>;
export declare function saveConfig(config: AppConfig): Promise<void>;
export declare function bindDevice(serverBaseUrl: string, bindCode: string, deviceName: string, profile?: string, opts?: HttpSafetyOpts): Promise<DeviceConfig>;
export declare function previewBindCode(serverBaseUrl: string, bindCode: string, opts?: HttpSafetyOpts): Promise<BindCodePreview>;
export declare function bindWithLogin(serverBaseUrl: string, login: string, password: string, deviceName: string, profile?: string, opts?: HttpSafetyOpts): Promise<DeviceConfig>;
export declare function refreshDeviceIdentity(device: DeviceConfig): Promise<DeviceConfig>;
export declare function serverAllows(device: DeviceConfig, permission: "canAutoUpload" | "canManualUpload" | "canAutoReceive"): boolean;
export declare function unbind(): Promise<void>;
//# sourceMappingURL=config.d.ts.map