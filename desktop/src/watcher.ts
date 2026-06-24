import chokidar from "chokidar";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export interface WatcherOptions {
  watchDir: string;
  excludedDirs?: string[];
  onFile: (filePath: string) => Promise<void> | void;
  onLog?: (message: string) => void;
  /**
   * Called for transient errors that should NOT stop the watcher — e.g. a
   * single upload failure. The watcher keeps running so subsequent valid
   * images can still upload.
   */
  onUploadError?: (message: string) => void;
  /**
   * Called for unrecoverable errors emitted by the underlying chokidar
   * watcher (FSWatcher 'error' event). After this callback the watcher is
   * already torn down and the caller must clear its handle so the user can
   * click "start" again.
   */
  onFatal?: (message: string) => void;
}

export class DirectoryWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private queue: Promise<void> = Promise.resolve();
  private currentDir: string | null = null;
  private readonly onFatal?: (message: string) => void;
  /**
   * Shared teardown promise. It deduplicates repeated fatal events and lets
   * start()/stop() wait until the old filesystem handle has actually closed.
   */
  private fatalTeardown: Promise<void> | null = null;

  constructor(private readonly options: WatcherOptions) {
    this.onFatal = options.onFatal;
  }

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
    await this.fatalTeardown?.catch(() => undefined);
    if (this.watcher) {
      await this.stop();
    }
    const log = (msg: string) => this.options.onLog?.(msg);
    log(`开始监听 ${this.options.watchDir}`);
    this.currentDir = this.options.watchDir;
    // Re-arm for a fresh watcher instance. A previous fatal error on an
    // older watcher must not disable this new one.

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
          // Single-file upload failure: record it without tearing down the
          // watcher. The watcher stays alive so the next valid image can
          // still be uploaded.
          const message = `上传失败 ${filePath}: ${(err as Error).message}`;
          log(message);
          this.options.onUploadError?.(message);
        }
      });
    });

    this.watcher.on("error", (err) => {
      const message = `监听器致命错误: ${err.message}`;
      log(message);
      void this.handleFatal(message).catch((closeErr) => {
        log(`关闭致命监听器时出错: ${(closeErr as Error).message}`);
      });
    });
  }

  /**
   * R0-6 §1-2: fatal teardown keeps the FSWatcher reference, clears public
   * state first so isWatching flips to false, then closes the underlying
   * watcher, and only after close() resolves notifies onFatal. §3: the
   * fatalTeardown promise makes this idempotent across repeated error events
   * and concurrent start()/stop() calls.
   */
  private async handleFatal(message: string): Promise<void> {
    if (this.fatalTeardown) {
      await this.fatalTeardown;
      return;
    }
    // §1: keep the reference so we can close() it.
    const w = this.watcher;
    // §1: flip public state to stopped BEFORE close() so callers see
    // isWatching=false immediately and can prepare to re-create.
    this.watcher = null;
    this.currentDir = null;
    const teardown = (async () => {
      if (w) {
        await this.queue.catch(() => undefined);
        await w.close().catch(() => undefined);
      }
      // Notify only after the original watcher is closed. A caller that
      // starts again while close() is pending waits on [fatalTeardown].
      this.onFatal?.(message);
    })();
    this.fatalTeardown = teardown;
    try {
      await teardown;
    } finally {
      if (this.fatalTeardown === teardown) this.fatalTeardown = null;
    }
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
    // If fatal teardown already owns the handle, wait for it instead of
    // double-closing or returning while the filesystem handle is still live.
    if (this.fatalTeardown) {
      await this.fatalTeardown.catch(() => undefined);
      return;
    }
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
