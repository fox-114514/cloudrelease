import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export interface AndroidRelease {
  versionCode: number;
  versionName: string;
  releaseNotes: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  downloadPath: string;
}

let cached: { key: string; release: AndroidRelease } | undefined;

export async function getAndroidRelease(): Promise<AndroidRelease | null> {
  const apkPath = config.ANDROID_UPDATE_APK_PATH;
  const versionCode = config.ANDROID_UPDATE_VERSION_CODE;
  const versionName = config.ANDROID_UPDATE_VERSION_NAME;
  if (!apkPath || !versionCode || !versionName) return null;

  const file = await stat(apkPath).catch(() => null);
  if (!file?.isFile()) return null;

  const key = `${apkPath}:${file.size}:${file.mtimeMs}:${versionCode}:${versionName}:${config.ANDROID_UPDATE_RELEASE_NOTES}`;
  if (cached?.key === key) return cached.release;

  const release: AndroidRelease = {
    versionCode,
    versionName,
    releaseNotes: config.ANDROID_UPDATE_RELEASE_NOTES,
    fileName: safeApkName(path.basename(apkPath), versionName),
    fileSize: file.size,
    sha256: await hashFile(apkPath),
    downloadPath: "/api/v1/updates/android/apk",
  };
  cached = { key, release };
  return release;
}

export function openAndroidApk() {
  const apkPath = config.ANDROID_UPDATE_APK_PATH;
  if (!apkPath) throw new Error("Android update is not configured");
  return createReadStream(apkPath);
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function safeApkName(original: string, versionName: string): string {
  const candidate = original.toLowerCase().endsWith(".apk")
    ? original
    : `studyshot-relay-${versionName}.apk`;
  return candidate.replace(/[^a-zA-Z0-9._-]/g, "_");
}
