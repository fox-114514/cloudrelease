import { createHash } from "crypto";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import sharp from "sharp";
import type { Readable } from "stream";
import { config } from "../config.js";
import { AppError } from "../errors.js";

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export interface StoredFile {
  storageKey: string;
  sha256: string;
  mimeType: string;
  fileSize: number;
  absolutePath: string;
}

function detectMimeType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function validateMimeType(buffer: Buffer, claimedMimeType?: string): string {
  const detected = detectMimeType(buffer);
  if (!detected) {
    throw new AppError("INVALID_FILE_TYPE", "File is not a supported image", 400);
  }
  if (claimedMimeType && claimedMimeType !== detected) {
    throw new AppError("INVALID_FILE_TYPE", "Claimed MIME type does not match file content", 400);
  }
  if (!ALLOWED_MIME_TYPES.has(detected)) {
    throw new AppError("INVALID_FILE_TYPE", `Image format ${detected} is not allowed`, 400);
  }
  return detected;
}

export async function ensureStorageRoot(): Promise<void> {
  await fs.mkdir(path.join(config.STORAGE_DIR, "images"), { recursive: true });
}

export function buildStorageKey(imageId: string, sha256: string, mimeType: string): string {
  const now = new Date();
  const prefix = sha256.slice(0, 16);
  const ext = EXTENSIONS[mimeType];
  return path.join(
    "images",
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    `${imageId}_${prefix}.${ext}`
  );
}

export function getAbsolutePath(storageKey: string): string {
  const resolved = path.resolve(config.STORAGE_DIR, storageKey);
  const root = path.resolve(config.STORAGE_DIR);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new AppError("INVALID_STORAGE_KEY", "Storage key attempts path traversal", 400);
  }
  return resolved;
}

export async function storeImage(
  imageId: string,
  stream: Readable,
  claimedMimeType?: string
): Promise<StoredFile> {
  await ensureStorageRoot();

  const tmpPath = path.join(config.STORAGE_DIR, `.tmp-${imageId}`);
  const hash = createHash("sha256");
  let fileSize = 0;

  try {
    const writeStream = createWriteStream(tmpPath);

    stream.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      fileSize += chunk.length;
    });

    await pipeline(stream, writeStream);

    const sha256 = hash.digest("hex");

    // Read first bytes to detect MIME type.
    const header = Buffer.alloc(12);
    const fh = await fs.open(tmpPath, "r");
    await fh.read(header, 0, 12, 0);
    await fh.close();

    const mimeType = validateMimeType(header, claimedMimeType);

    const storageKey = buildStorageKey(imageId, sha256, mimeType);
    const absolutePath = getAbsolutePath(storageKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.rename(tmpPath, absolutePath);

    return { storageKey, sha256, mimeType, fileSize, absolutePath };
  } catch (err) {
    // Clean up temp file on any error.
    try {
      await fs.unlink(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

export function createImageReadStream(storageKey: string): Readable {
  const absolutePath = getAbsolutePath(storageKey);
  return createReadStream(absolutePath);
}

export async function deleteStoredImage(storageKey: string): Promise<void> {
  try {
    await fs.unlink(getAbsolutePath(storageKey));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
}

export async function getImageDimensions(
  absolutePath: string
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(absolutePath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new AppError("INVALID_IMAGE", "Could not determine image dimensions", 400);
  }
  return { width: metadata.width, height: metadata.height };
}
