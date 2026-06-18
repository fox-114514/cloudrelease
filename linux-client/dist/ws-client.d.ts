import type { AppConfig, DeviceConfig } from "./config.js";
export interface WsClientOptions {
    device: DeviceConfig;
    config: AppConfig;
    onStatus?: (status: string) => void;
    onDownload?: (filePath: string) => void;
    onError?: (message: string) => void;
}
export declare class WsReceiveClient {
    private readonly options;
    private socket?;
    private reconnectTimer?;
    private reconnectDelayMs;
    private destroyed;
    private processing;
    private api;
    constructor(options: WsClientOptions);
    start(): void;
    stop(): void;
    private connect;
    private handleMessage;
    private handleImageCreated;
    private fetchPending;
    private downloadAndAck;
    private shouldReconnect;
    private scheduleReconnect;
    private log;
}
//# sourceMappingURL=ws-client.d.ts.map