import chokidar from "chokidar";
import type { DeviceConfig } from "./config.js";
export interface WatchOptions {
    device: DeviceConfig;
    watchDir: string;
    onLog?: (message: string) => void;
    onError?: (message: string) => void;
}
export declare function startWatcher(options: WatchOptions): chokidar.FSWatcher;
//# sourceMappingURL=watcher.d.ts.map