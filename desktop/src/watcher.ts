import chokidar from "chokidar";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export interface WatcherOptions {
  watchDir: string;
  excludedDirs?: string[];
  onFile: (filePath: string) => Promise<void> | void;
  onLog?: (message: string) => void;
  onError?: (message: string) => void;
}

export class DirectoryWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private queue: Promise<void> = Promise.resolve();
  private currentDir: string | null = null;

  constructor(private readonly options: WatcherOptions) {}

  get isWatching(): boolean {
    return this.watcher !== null;
  }

  get dir(): string | null {
    return this.currentDir;
  }

  matches(watchDir: string, excludedDirs: string[]): boolean {
    if (this.currentDir !== watchDir) return false;
    const current = (this.options.excludedDirs ?? []).map((value) => path.resolve(value)).sort();
    const next = excludedDirs.map((value) => path.resolve(value)).sort();
    return current.length === next.length && current.every((value, index) => value === next[index]);
  }

  async start(): Promise<void> {
    if (this.watcher) {
      await this.stop();
    }
    const log = (msg: string) => this.options.onLog?.(msg);
    log(`开始监听 ${this.options.watchDir}`);
    this.currentDir = this.options.watchDir;

    this.watcher = chokidar.watch(this.options.watchDir, {
      ignored: (candidate) => this.shouldIgnore(candidate),
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100,
      },
    });

    this.watcher.on("add", (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) {
        return;
      }
      log(`检测到新文件: ${filePath}`);
      this.queue = this.queue.then(async () => {
        try {
          await this.options.onFile(filePath);
        } catch (err) {
          const message = `上传失败 ${filePath}: ${(err as Error).message}`;
          log(message);
          this.options.onError?.(message);
        }
      });
    });

    this.watcher.on("error", (err) => {
      const message = `监听错误: ${err.message}`;
      log(message);
      this.options.onError?.(message);
    });
  }

  private shouldIgnore(candidate: string): boolean {
    const resolved = path.resolve(candidate);
    const relativeToRoot = path.relative(path.resolve(this.options.watchDir), resolved);
    if (relativeToRoot.split(path.sep).some((segment) => segment.startsWith("."))) {
      return true;
    }
    return (this.options.excludedDirs ?? []).some((excludedDir) => {
      const excluded = path.resolve(excludedDir);
      const relative = path.relative(excluded, resolved);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
  }

  async stop(): Promise<void> {
    if (!this.watcher) {
      return;
    }
    const log = (msg: string) => this.options.onLog?.(msg);
    log("停止监听");
    const w = this.watcher;
    this.watcher = null;
    this.currentDir = null;
    try {
      await this.queue.catch(() => undefined);
    } catch {
      // ignore
    }
    try {
      await w.close();
    } catch (err) {
      log(`关闭监听器出错: ${(err as Error).message}`);
    }
  }
}
