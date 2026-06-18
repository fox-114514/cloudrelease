import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { apiUrl, sha256File } from "./utils.js";
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

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text
    ? (JSON.parse(text) as { success: boolean; data?: T; error?: { code: string; message: string } })
    : { success: true };
  if (!response.ok || !body.success) {
    throw new ApiError(
      response.status,
      body.error?.code ?? `HTTP_${response.status}`,
      body.error?.message ?? response.statusText
    );
  }
  return body.data as T;
}

export class ApiClient {
  constructor(private readonly device: DeviceConfig) {}

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.device.deviceToken}`,
    };
  }

  async healthz(): Promise<{ status: string }> {
    const response = await fetch(apiUrl(this.device.serverBaseUrl, "/api/v1/healthz"));
    return parseEnvelope(response);
  }

  async getPendingDeliveries(): Promise<{ deliveries: DeliveryPayload[] }> {
    const response = await fetch(
      apiUrl(this.device.serverBaseUrl, "/api/v1/deliveries/pending"),
      { headers: this.authHeaders() }
    );
    return parseEnvelope(response);
  }

  async ackDelivery(deliveryId: string, status: "downloaded" | "failed"): Promise<void> {
    const response = await fetch(
      apiUrl(this.device.serverBaseUrl, `/api/v1/deliveries/${deliveryId}/ack`),
      {
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }
    );
    await parseEnvelope(response);
  }

  async downloadImage(imageId: string): Promise<ReadableStream<Uint8Array>> {
    const response = await fetch(
      apiUrl(this.device.serverBaseUrl, `/api/v1/images/${imageId}/download`),
      { headers: this.authHeaders() }
    );
    if (!response.ok) {
      const body = await response.text();
      let error: { code?: string; message?: string } | undefined;
      try {
        error = JSON.parse(body).error;
      } catch {
        // ignore
      }
      throw new ApiError(
        response.status,
        error?.code ?? `HTTP_${response.status}`,
        error?.message ?? response.statusText
      );
    }
    if (!response.body) {
      throw new Error("Empty response body");
    }
    return response.body;
  }

  async uploadImage(filePath: string, sourceKind = "manual_share"): Promise<UploadResult> {
    const sha256 = await sha256File(filePath);
    const stats = await fs.stat(filePath);
    const form = new FormData();
    form.append("sha256", sha256);
    form.append("sourceKind", sourceKind);
    const buffer = await fs.readFile(filePath);
    const blob = new Blob([buffer]);
    const fileName = filePath.split("/").pop() || "image";
    form.append("image", blob, fileName);

    const response = await fetch(apiUrl(this.device.serverBaseUrl, "/api/v1/images"), {
      method: "POST",
      headers: this.authHeaders(),
      body: form as unknown as RequestInit["body"],
    });

    return parseEnvelope(response);
  }
}
