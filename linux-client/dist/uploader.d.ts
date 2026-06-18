import type { AppConfig, DeviceConfig } from "./config.js";
export interface UploadOptions {
    device: DeviceConfig;
    filePath: string;
    sourceKind?: string;
    onLog?: (message: string) => void;
}
export declare function uploadSingle(options: UploadOptions): Promise<void>;
export declare function isAlreadyUploaded(filePath: string, config: AppConfig): Promise<boolean>;
export declare function recordUploadedHash(filePath: string, config: AppConfig): Promise<void>;
//# sourceMappingURL=uploader.d.ts.map