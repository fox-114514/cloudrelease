import type { ApiClient, ClientRelease } from "./api.js";
export declare const CLIENT_VERSION = "0.5.1";
export declare function isNewerVersion(candidate: string, current?: string): boolean;
export declare function defaultUpdateDir(): string;
export declare function downloadUpdate(api: ApiClient, release: ClientRelease, targetDir?: string): Promise<string>;
export declare function openUpdatePackage(packagePath: string): Promise<void>;
//# sourceMappingURL=update.d.ts.map