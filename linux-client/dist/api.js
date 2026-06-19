import fs from "node:fs/promises";
import { apiUrl, sha256File } from "./utils.js";
class ApiError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "ApiError";
    }
}
async function parseEnvelope(response) {
    const text = await response.text();
    if (!text) {
        if (!response.ok) {
            throw new ApiError(response.status, `HTTP_${response.status}`, response.statusText);
        }
        return undefined;
    }
    let body;
    try {
        body = JSON.parse(text);
    }
    catch {
        throw new ApiError(response.status, "INVALID_JSON", `Server returned non-JSON response: ${text.slice(0, 200)}`);
    }
    if (!response.ok || body.success !== true) {
        throw new ApiError(response.status, body.error?.code ?? `HTTP_${response.status}`, body.error?.message ?? response.statusText);
    }
    return body.data;
}
export class ApiClient {
    device;
    constructor(device) {
        this.device = device;
    }
    authHeaders() {
        return {
            Authorization: `Bearer ${this.device.deviceToken}`,
        };
    }
    async healthz() {
        const response = await fetch(apiUrl(this.device.serverBaseUrl, "/api/v1/healthz"));
        return parseEnvelope(response);
    }
    async getPendingDeliveries() {
        const response = await fetch(apiUrl(this.device.serverBaseUrl, "/api/v1/deliveries/pending"), { headers: this.authHeaders() });
        return parseEnvelope(response);
    }
    async ackDelivery(deliveryId, status) {
        const response = await fetch(apiUrl(this.device.serverBaseUrl, `/api/v1/deliveries/${deliveryId}/ack`), {
            method: "POST",
            headers: { ...this.authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
        });
        await parseEnvelope(response);
    }
    async downloadImage(imageId) {
        const response = await fetch(apiUrl(this.device.serverBaseUrl, `/api/v1/images/${imageId}/download`), { headers: this.authHeaders() });
        if (!response.ok) {
            const body = await response.text();
            let error;
            try {
                error = JSON.parse(body).error;
            }
            catch {
                // ignore
            }
            throw new ApiError(response.status, error?.code ?? `HTTP_${response.status}`, error?.message ?? response.statusText);
        }
        if (!response.body) {
            throw new Error("Empty response body");
        }
        return response.body;
    }
    async uploadImage(filePath, sourceKind = "manual_share") {
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
            body: form,
        });
        return parseEnvelope(response);
    }
}
//# sourceMappingURL=api.js.map