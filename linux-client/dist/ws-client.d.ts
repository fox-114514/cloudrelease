import type { AppConfig, DeviceConfig } from "./config.js";
export interface WsClientOptions {
    device: DeviceConfig;
    config: AppConfig;
    onStatus?: (status: string) => void;
    onDownload?: (filePath: string, imageId: string) => void;
    onError?: (message: string) => void;
}
export declare class WsReceiveClient {
    private readonly options;
    private socket?;
    private reconnectTimer?;
    private heartbeatTimer?;
    private reconnectDelayMs;
    private destroyed;
    private processing;
    private api;
    constructor(options: WsClientOptions);
    start(): void;
    stop(): void;
    private connect;
    private startHeartbeat;
    private stopHeartbeat;
    private handleMessage;
    private handleImageCreated;
    private parseDelivery;
    private fetchPending;
    private downloadWithRetries;
    private downloadOnce;
    private uniquePath;
    private shouldReconnect;
    private scheduleReconnect;
    private clearReconnect;
    private log;
}
//# sourceMappingURL=ws-client.d.ts.map