import { app } from "electron";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DownloadRecord } from "./shared";

const HISTORY_FILE = "downloads.json";
const MAX_HISTORY = 100;

export class HistoryStore {
  private readonly historyPath: string;
  private records: DownloadRecord[] = [];

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
    this.records = [
      record,
      ...this.records.filter((existing) => existing.deliveryId !== record.deliveryId),
    ].slice(0, MAX_HISTORY);
    await this.persist();
  }

  async update(deliveryId: string, patch: Partial<DownloadRecord>): Promise<DownloadRecord | undefined> {
    const index = this.records.findIndex((record) => record.deliveryId === deliveryId);
    if (index === -1) return undefined;
    const updated = { ...this.records[index], ...patch };
    this.records[index] = updated;
    await this.persist();
    return updated;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.historyPath), { recursive: true });
    await writeFile(this.historyPath, `${JSON.stringify(this.records, null, 2)}\n`, {
      mode: 0o600,
    });
    try {
      await chmod(this.historyPath, 0o600);
    } catch {
      // Windows does not use POSIX file modes.
    }
  }
}

