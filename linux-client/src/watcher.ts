import chokidar from "chokidar";
import path from "node:path";
import type { DeviceConfig } from "./config.js";
import { uploadSingle } from "./uploader.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export interface WatchOptions {
  device: DeviceConfig;
  watchDir: string;
  onLog?: (message: string) => void;
  onError?: (message: string) => void;
}

export function startWatcher(options: WatchOptions): chokidar.FSWatcher {
  const log = (msg: string) => options.onLog?.(`[watch] ${msg}`);
  log(`Watching ${options.watchDir}`);

  const watcher = chokidar.watch(options.watchDir, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher.on("add", async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return;

    log(`Detected new file: ${filePath}`);
    try {
      await uploadSingle({
        device: options.device,
        filePath,
        sourceKind: "screenshot",
        onLog: (msg) => log(msg),
      });
    } catch (err) {
      const message = `Upload failed for ${filePath}: ${(err as Error).message}`;
      log(message);
      options.onError?.(message);
    }
  });

  watcher.on("error", (err) => {
    const message = `Watcher error: ${err.message}`;
    log(message);
    options.onError?.(message);
  });

  return watcher;
}
