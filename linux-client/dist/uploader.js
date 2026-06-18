import { ApiClient } from "./api.js";
import { loadConfig, saveConfig } from "./config.js";
import { sha256File } from "./utils.js";
export async function uploadSingle(options) {
    const api = new ApiClient(options.device);
    const config = await loadConfig();
    const sha256 = await sha256File(options.filePath);
    if (config.uploadedHashes.includes(sha256)) {
        options.onLog?.(`Skip already uploaded: ${options.filePath}`);
        return;
    }
    options.onLog?.(`Uploading ${options.filePath} ...`);
    const result = await api.uploadImage(options.filePath, options.sourceKind ?? "manual_share");
    config.uploadedHashes.push(sha256);
    while (config.uploadedHashes.length > 5000) {
        config.uploadedHashes.shift();
    }
    await saveConfig(config);
    options.onLog?.(`Uploaded imageId=${result.imageId} deduplicated=${result.deduplicated} deliveries=${result.createdDeliveriesCount}`);
}
export async function isAlreadyUploaded(filePath, config) {
    const sha256 = await sha256File(filePath);
    return config.uploadedHashes.includes(sha256);
}
export async function recordUploadedHash(filePath, config) {
    const sha256 = await sha256File(filePath);
    if (!config.uploadedHashes.includes(sha256)) {
        config.uploadedHashes.push(sha256);
        while (config.uploadedHashes.length > 5000) {
            config.uploadedHashes.shift();
        }
        await saveConfig(config);
    }
}
//# sourceMappingURL=uploader.js.map