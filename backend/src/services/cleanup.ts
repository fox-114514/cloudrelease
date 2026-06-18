import { prisma } from "../lib/prisma.js";
import { logger } from "../logger.js";
import { deleteStoredImage } from "./storage.js";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function startCleanupTask(): void {
  const run = async (): Promise<void> => {
    try {
      const now = new Date();

      const expiredImages = await prisma.image.findMany({
        where: {
          expiresAt: { lte: now },
          deletedAt: null,
        },
      });

      for (const image of expiredImages) {
        try {
          await deleteStoredImage(image.storageKey);
        } catch (err) {
          logger.error("Failed to delete expired image file", {
            imageId: image.id,
            error: String(err),
          });
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.image.updateMany({
          where: { expiresAt: { lte: now }, deletedAt: null },
          data: { deletedAt: now },
        });

        await tx.delivery.updateMany({
          where: {
            status: { in: ["pending", "notified"] },
            image: { deletedAt: { not: null } },
          },
          data: { status: "expired" },
        });
      });

      logger.info("Cleanup task completed", { expiredImages: expiredImages.length });
    } catch (err) {
      logger.error("Cleanup task failed", { error: String(err) });
    }
  };

  // Run once at startup, then periodically.
  run().catch(() => undefined);
  setInterval(run, CLEANUP_INTERVAL_MS);
}
