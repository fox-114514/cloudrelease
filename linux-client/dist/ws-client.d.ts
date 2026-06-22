import type { AppConfig, DeviceConfig } from "./config.js";
export interface WsClientOptions {
    device: DeviceConfig;
    config: AppConfig;
    onStatus?: (status: string) => void;
    onDownload?: (filePath: string, imageId: string, deliveryId: string, sourceDeviceName: string) => void;
    onPending?: (count: number) => void;
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
    private downloadedUnacked;
    private liveDeliveryChain;
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
    checkPending(): Promise<number>;
    acceptPending(): Promise<void>;
    skipPending(): Promise<void>;
    private drainPending;
    private pendingDelivery;
    private downloadWithRetries;
    private downloadOnce;
    private writeImageWithUniqueSuffix;
    private writeImageExclusive;
    private recordReceivedHash;
    private shouldReconnect;
    private scheduleReconnect;
    private clearReconnect;
    private log;
}
//# sourceMappingURL=ws-client.d.ts.map