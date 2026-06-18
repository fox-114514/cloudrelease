export declare function normalizeBaseUrl(raw: string): string;
export declare function wsUrl(baseUrl: string): string;
export declare function apiUrl(baseUrl: string, pathname: string): string;
export declare function sanitizeFilePart(value: string): string;
export declare function extensionForMime(mimeType: string): string;
export declare function sha256File(filePath: string): Promise<string>;
export declare function sha256Buffer(buffer: Buffer): string;
export declare function detectImageMimeType(buffer: Buffer): string | undefined;
export declare function detectImageMimeTypeFromPath(filePath: string): string;
export declare function ensureDir(dir: string): Promise<void>;
export declare function configDir(): string;
export declare function defaultDownloadDir(): string;
export declare function formatTimestamp(input: string): string;
//# sourceMappingURL=utils.d.ts.map