import type { DeviceConfig } from "./config.js";
export interface DeliveryPayload {
    id: string;
    imageId: string;
    status: string;
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
export declare class ApiClient {
    private readonly device;
    constructor(device: DeviceConfig);
    private authHeaders;
    healthz(): Promise<{
        status: string;
    }>;
    getPendingDeliveries(): Promise<{
        deliveries: DeliveryPayload[];
    }>;
    ackDelivery(deliveryId: string, status: "downloaded" | "failed"): Promise<void>;
    downloadImage(imageId: string): Promise<ReadableStream<Uint8Array>>;
    uploadImage(filePath: string, sourceKind?: string): Promise<UploadResult>;
}
//# sourceMappingURL=api.d.ts.map