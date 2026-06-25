import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export const UPDATE_CHANNELS = ["android", "windows", "linux-desktop", "linux-cli"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export interface ClientRelease {
  channel: UpdateChannel;
  versionCode?: number;
  versionName: string;
  releaseNotes: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  downloadPath: string;
}

interface ReleaseConfig {
  packagePath?: string;
  versionCode?: number;
  versionName?: string;
  releaseNotes: string;
}

const cache = new Map<UpdateChannel, { key: string; release: ClientRelease }>();
const pending = new Map<UpdateChannel, { key: string; promise: Promise<ClientRelease> }>();

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return typeof value === "string" && UPDATE_CHANNELS.includes(value as UpdateChannel);
}

export function defaultUpdateChannel(platform: string): UpdateChannel | null {
  if (platform === "android") return "android";
  if (platform === "windows") return "windows";
  if (platform === "linux") return "linux-desktop";
  return null;
}

export function isChannelAllowedForPlatform(channel: UpdateChannel, platform: string): boolean {
  if (platform === "android") return channel === "android";
  if (platform === "windows") return channel === "windows";
  if (platform === "linux") return channel === "linux-desktop" || channel === "linux-cli";
  return false;
}

export async function getClientRelease(channel: UpdateChannel): Promise<ClientRelease | null> {
  const releaseConfig = releaseConfigFor(channel);
  if (!releaseConfig.packagePath || !releaseConfig.versionName) return null;
  if (channel === "android" && !releaseConfig.versionCode) return null;
  const configuredRelease = {
    ...releaseConfig,
    packagePath: releaseConfig.packagePath,
    versionName: releaseConfig.versionName,
  };

  const file = await stat(configuredRelease.packagePath).catch(() => null);
  if (!file?.isFile()) return null;
  const key = [
    configuredRelease.packagePath,
    file.size,
    file.mtimeMs,
    releaseConfig.versionCode ?? "",
    configuredRelease.versionName,
    configuredRelease.releaseNotes,
  ].join(":");

  const cached = cache.get(channel);
  if (cached?.key === key) return cached.release;
  const existing = pending.get(channel);
  if (existing?.key === key) return existing.promise;

  const promise = buildRelease(channel, configuredRelease, file.size).then((release) => {
    cache.set(channel, { key, release });
    pending.delete(channel);
    return release;
  }).catch((error) => {
    pending.delete(channel);
    throw error;
  });
  pending.set(channel, { key, promise });
  return promise;
}

export function openClientPackage(channel: UpdateChannel) {
  const packagePath = releaseConfigFor(channel).packagePath;
  if (!packagePath) throw new Error(`${channel} update is not configured`);
  return createReadStream(packagePath);
}

async function buildRelease(
  channel: UpdateChannel,
  releaseConfig: ReleaseConfig & { packagePath: string; versionName: string },
  fileSize: number,
): Promise<ClientRelease> {
  return {
    channel,
    ...(releaseConfig.versionCode ? { versionCode: releaseConfig.versionCode } : {}),
    versionName: releaseConfig.versionName,
    releaseNotes: releaseConfig.releaseNotes,
    fileName: safePackageName(path.basename(releaseConfig.packagePath), channel, releaseConfig.versionName),
    fileSize,
    sha256: await hashFile(releaseConfig.packagePath),
    downloadPath: channel === "android"
      ? "/api/v1/updates/android/apk"
      : `/api/v1/updates/${channel}/package`,
  };
}

function releaseConfigFor(channel: UpdateChannel): ReleaseConfig {
  switch (channel) {
    case "android":
      return {
        packagePath: config.ANDROID_UPDATE_APK_PATH,
        versionCode: config.ANDROID_UPDATE_VERSION_CODE,
        versionName: config.ANDROID_UPDATE_VERSION_NAME,
        releaseNotes: config.ANDROID_UPDATE_RELEASE_NOTES,
      };
    case "windows":
      return {
        packagePath: config.WINDOWS_UPDATE_PACKAGE_PATH,
        versionName: config.WINDOWS_UPDATE_VERSION_NAME,
        releaseNotes: config.WINDOWS_UPDATE_RELEASE_NOTES,
      };
    case "linux-desktop":
      return {
        packagePath: config.LINUX_DESKTOP_UPDATE_PACKAGE_PATH,
        versionName: config.LINUX_DESKTOP_UPDATE_VERSION_NAME,
        releaseNotes: config.LINUX_DESKTOP_UPDATE_RELEASE_NOTES,
      };
    case "linux-cli":
      return {
        packagePath: config.LINUX_CLI_UPDATE_PACKAGE_PATH,
        versionName: config.LINUX_CLI_UPDATE_VERSION_NAME,
        releaseNotes: config.LINUX_CLI_UPDATE_RELEASE_NOTES,
      };
  }
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

function safePackageName(original: string, channel: UpdateChannel, versionName: string): string {
  const extension = channel === "android" ? ".apk" : channel === "windows" ? ".exe" : ".deb";
  const candidate = path.extname(original) ? original : `studyshot-relay-${channel}-${versionName}${extension}`;
  return candidate.replace(/[^a-zA-Z0-9._-]/g, "_");
}
