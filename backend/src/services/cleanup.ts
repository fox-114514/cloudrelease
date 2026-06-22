import { prisma } from "../lib/prisma.js";
import { logger } from "../logger.js";
import { executeImageCleanup } from "./cleanup-policy.js";
import { deleteStoredImage } from "./storage.js";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export async function cleanupOnce(now = new Date()): Promise<void> {
  const stats = await executeImageCleanup(
    {
      markExpired: async (cleanupTime) => {
        return prisma.$transaction(async (tx) => {
          const updated = await tx.image.updateMany({
            where: { expiresAt: { lte: cleanupTime }, deletedAt: null },
            data: { deletedAt: cleanupTime },
          });
          await tx.delivery.updateMany({
            where: {
              status: { in: ["pending", "notified"] },
              image: { deletedAt: { not: null } },
            },
            data: { status: "expired" },
          });
          return updated.count;
        });
      },
      findNewlyDeleted: (cleanupTime) =>
        prisma.image.findMany({
          where: { deletedAt: cleanupTime },
          select: { id: true, storageKey: true },
        }),
      findDeletedBefore: (cutoff) =>
        prisma.image.findMany({
          where: { deletedAt: { lt: cutoff, not: null } },
          select: { id: true, storageKey: true },
          orderBy: { deletedAt: "asc" },
        }),
      deleteStoredImage,
      hardDeleteImage: async (imageId) => {
        const result = await prisma.image.deleteMany({ where: { id: imageId } });
        return result.count === 1;
      },
      warn: (message, metadata) => logger.warn(message, metadata),
    },
    now,
  );

  logger.info("Cleanup task completed", { ...stats });
}

export function startCleanupTask(): void {
  const run = async (): Promise<void> => {
    try {
      await cleanupOnce();
    } catch (err) {
      logger.error("Cleanup task failed", { error: String(err) });
    }
  };

  // Run once at startup, then periodically.
  run().catch(() => undefined);
  setInterval(run, CLEANUP_INTERVAL_MS);
}
