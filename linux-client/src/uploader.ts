import { ApiClient } from "./api.js";
import type { AppConfig, DeviceConfig } from "./config.js";
import { loadConfig, saveConfig } from "./config.js";
import { sha256File } from "./utils.js";

export interface UploadOptions {
  device: DeviceConfig;
  filePath: string;
  sourceKind?: string;
  onLog?: (message: string) => void;
}

export async function uploadSingle(options: UploadOptions): Promise<void> {
  const api = new ApiClient(options.device);
  const config = await loadConfig();

  const sha256 = await sha256File(options.filePath);
  if ((options.sourceKind ?? "manual_share") !== "manual_share" && config.receivedHashes.includes(sha256)) {
    options.onLog?.(`Skip image received from server: ${options.filePath}`);
    return;
  }
  if (config.uploadedHashes.includes(sha256)) {
    options.onLog?.(`Skip already uploaded: ${options.filePath}`);
    return;
  }

  options.onLog?.(`Uploading ${options.filePath} ...`);
  const result = await api.uploadImage(options.filePath, options.sourceKind ?? "manual_share");

  // Reload after the network request so a concurrent Web UI settings change
  // is not overwritten by this upload's older config snapshot.
  const latestConfig = await loadConfig();
  if (!latestConfig.uploadedHashes.includes(sha256)) latestConfig.uploadedHashes.push(sha256);
  while (latestConfig.uploadedHashes.length > 5000) {
    latestConfig.uploadedHashes.shift();
  }
  await saveConfig(latestConfig);

  options.onLog?.(
    `Uploaded imageId=${result.imageId} deduplicated=${result.deduplicated} deliveries=${result.createdDeliveriesCount}`
  );
}

export async function isAlreadyUploaded(filePath: string, config: AppConfig): Promise<boolean> {
  const sha256 = await sha256File(filePath);
  return config.uploadedHashes.includes(sha256);
}

export async function recordUploadedHash(filePath: string, config: AppConfig): Promise<void> {
  const sha256 = await sha256File(filePath);
  if (!config.uploadedHashes.includes(sha256)) {
    config.uploadedHashes.push(sha256);
    while (config.uploadedHashes.length > 5000) {
      config.uploadedHashes.shift();
    }
    await saveConfig(config);
  }
}
