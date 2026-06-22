interface RecentDelivery {
    deliveryId: string;
    imageId: string;
    fileName: string;
    sourceDevice: string;
    size: number;
    savedAt: string;
}
export declare function recordRecentDelivery(entry: RecentDelivery): void;
export declare function startWebServer(port?: number): Promise<{
    url: string;
    close: () => Promise<void>;
}>;
export declare function openBrowser(url: string): void;
export {};
//# sourceMappingURL=server.d.ts.map