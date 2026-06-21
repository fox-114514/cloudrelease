import { app } from "electron";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DownloadRecord } from "./shared";

const HISTORY_FILE = "downloads.json";
const MAX_HISTORY = 100;

export class HistoryStore {
  private readonly historyPath: string;
  private records: DownloadRecord[] = [];
  // Serialize concurrent add()/update() so two writers can't both clobber the
  // same tmp file mid-write. processDelivery() can fan in multiple calls
  // from the same pending fetch + WS event.
  private writeChain: Promise<void> = Promise.resolve();

  constructor() {
    this.historyPath = path.join(app.getPath("userData"), HISTORY_FILE);
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.historyPath, "utf8");
      const parsed = JSON.parse(raw) as DownloadRecord[];
      this.records = Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  list(): DownloadRecord[] {
    return this.records;
  }

  find(deliveryId: string): DownloadRecord | undefined {
    return this.records.find((record) => record.deliveryId === deliveryId);
  }

  async add(record: DownloadRecord): Promise<void> {
    await this.enqueueWrite((records) => {
      const next = [record, ...records.filter((e) => e.deliveryId !== record.deliveryId)].slice(
        0,
        MAX_HISTORY,
      );
      return { next, result: undefined };
    });
  }

  async update(deliveryId: string, patch: Partial<DownloadRecord>): Promise<DownloadRecord | undefined> {
    let returned: DownloadRecord | undefined;
    await this.enqueueWrite((records) => {
      const index = records.findIndex((record) => record.deliveryId === deliveryId);
      if (index === -1) return { next: records, result: undefined };
      const updated = { ...records[index], ...patch };
      const next = records.slice();
      next[index] = updated;
      returned = updated;
      return { next, result: updated };
    });
    return returned;
  }

  private enqueueWrite(
    mutate: (records: DownloadRecord[]) => { next: DownloadRecord[]; result: DownloadRecord | undefined }
  ): Promise<void> {
    // Serialize read-modify-write inside the chain. If two callers race on
    // add(), each will see the previous call's committed state, not a stale
    // snapshot, so records aren't lost.
    const run = this.writeChain.catch(() => undefined).then(async () => {
      const { next } = mutate(this.records);
      await this.persist(next);
      this.records = next;
    });
    this.writeChain = run;
    return run;
  }

  private async persist(next: DownloadRecord[]): Promise<void> {
    // Write to a sibling temp file then rename so a crash mid-write can't leave
    // a half-written history file that loses the entire list on next load.
    // enqueueWrite() guarantees only one persist runs at a time, so the tmp
    // filename only needs to be unique across restarts (pid is enough).
    await mkdir(path.dirname(this.historyPath), { recursive: true });
    const tmpPath = `${this.historyPath}.${process.pid}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    try {
      await rename(tmpPath, this.historyPath);
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined);
      throw err;
    }
    try {
      await chmod(this.historyPath, 0o600);
    } catch {
      // Windows does not use POSIX file modes.
    }
  }
}

