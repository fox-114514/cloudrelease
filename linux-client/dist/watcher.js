import chokidar from "chokidar";
import path from "node:path";
import { uploadSingle } from "./uploader.js";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
export function startWatcher(options) {
    const log = (msg) => options.onLog?.(`[watch] ${msg}`);
    log(`Watching ${options.watchDir}`);
    const watcher = chokidar.watch(options.watchDir, {
        ignored: (candidate) => {
            if (/(^|[/\\])\../.test(candidate))
                return true;
            const resolved = path.resolve(candidate);
            return (options.excludedDirs ?? []).some((excludedDir) => {
                const excluded = path.resolve(excludedDir);
                const relative = path.relative(excluded, resolved);
                return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
            });
        },
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100,
        },
    });
    // Serialize uploads so concurrent chokidar events don't race on the
    // shared uploadedHashes array in config.json.
    let queue = Promise.resolve();
    watcher.on("add", (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(ext))
            return;
        log(`Detected new file: ${filePath}`);
        queue = queue.then(async () => {
            try {
                await uploadSingle({
                    device: options.device,
                    filePath,
                    sourceKind: "screenshot",
                    onLog: (msg) => log(msg),
                });
            }
            catch (err) {
                const message = `Upload failed for ${filePath}: ${err.message}`;
                log(message);
                options.onError?.(message);
            }
        });
    });
    watcher.on("error", (err) => {
        const message = `Watcher error: ${err.message}`;
        log(message);
        options.onError?.(message);
    });
    const originalClose = watcher.close.bind(watcher);
    watcher.close = async () => {
        await queue.catch(() => undefined);
        await originalClose();
    };
    return watcher;
}
//# sourceMappingURL=watcher.js.map