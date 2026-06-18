export interface DeviceConfig {
    serverBaseUrl: string;
    deviceId: string;
    deviceToken: string;
    deviceName: string;
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
export declare function bindDevice(serverBaseUrl: string, bindCode: string, deviceName: string): Promise<DeviceConfig>;
export declare function unbind(): Promise<void>;
//# sourceMappingURL=config.d.ts.map