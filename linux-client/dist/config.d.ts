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
    watchDir?: string;
    downloadDir?: string;
    uploadedHashes: string[];
}
export declare function loadConfig(): Promise<AppConfig>;
export declare function saveConfig(config: AppConfig): Promise<void>;
export declare function bindDevice(serverBaseUrl: string, bindCode: string, deviceName: string, profile?: string): Promise<DeviceConfig>;
export declare function previewBindCode(serverBaseUrl: string, bindCode: string): Promise<BindCodePreview>;
export declare function bindWithLogin(serverBaseUrl: string, login: string, password: string, deviceName: string, profile?: string): Promise<DeviceConfig>;
export declare function refreshDeviceIdentity(device: DeviceConfig): Promise<DeviceConfig>;
export declare function serverAllows(device: DeviceConfig, permission: "canAutoUpload" | "canManualUpload" | "canAutoReceive"): boolean;
export declare function unbind(): Promise<void>;
//# sourceMappingURL=config.d.ts.map