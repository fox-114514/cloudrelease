import type { DeviceConfig } from "./config.js";
export interface DeliveryPayload {
    deliveryId: string;
    image: {
        id: string;
        mimeType: string;
        fileSize: number;
        width?: number;
        height?: number;
        sha256: string;
    };
    source: {
        uploadDeviceId: string;
        uploadDeviceName: string;
    };
    createdAt: string;
    expiresAt: string;
}
export interface UploadResult {
    imageId: string;
    deduplicated: boolean;
    createdDeliveriesCount: number;
}
export interface PendingDeliveriesResult {
    deliveries: DeliveryPayload[];
    totalPending?: number;
    hasMore?: boolean;
}
export declare function createImageUploadForm(filePath: string, sourceKind: string): Promise<FormData>;
export declare class ApiClient {
    private readonly device;
    constructor(device: DeviceConfig);
    private authHeaders;
    healthz(): Promise<{
        status: string;
    }>;
    getPendingDeliveries(): Promise<PendingDeliveriesResult>;
    ackDelivery(deliveryId: string, status: "downloaded" | "failed" | "skipped"): Promise<void>;
    downloadImage(imageId: string): Promise<ReadableStream<Uint8Array>>;
    uploadImage(filePath: string, sourceKind?: string): Promise<UploadResult>;
}
//# sourceMappingURL=api.d.ts.map