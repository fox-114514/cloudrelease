import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { AppError } from "../errors.js";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { logAudit } from "../services/audit.js";
import { generateDeliveries } from "../services/delivery.js";
import {
  createImageReadStream,
  ensureStorageRoot,
  getAbsolutePath,
  getImageDimensions,
  storeImage,
} from "../services/storage.js";

const uploadImageSchema = z.object({
  sha256: z.string().length(64),
  sourceKind: z.enum(["screenshot", "manual_share", "selected_album", "unknown"]).default("unknown"),
  sourceDisplayName: z.string().optional(),
  sourceMediaIdHash: z.string().optional(),
  capturedAt: z.string().datetime().optional(),
  originImageId: z.string().uuid().optional(),
});

function isManualSource(sourceKind: string): boolean {
  return sourceKind === "manual_share";
}

export async function imageRoutes(app: FastifyInstance): Promise<void> {
  // Upload image.
  app.post("/images", async (request, reply) => {
    if (!request.device) {
      throw new AppError("UNAUTHORIZED", "Device authentication required", 401);
    }

    const device = request.device;
    const data = await request.file({ limits: { fileSize: request.server?.initialConfig.bodyLimit } });
    if (!data) {
      throw new AppError("MISSING_FILE", "No image file provided", 400);
    }

    const fields: Record<string, string | undefined> = {};
    for (const [key, field] of Object.entries(data.fields)) {
      if (field && "value" in field && field.value) {
        fields[key] = String(field.value);
      }
    }

    const meta = uploadImageSchema.parse(fields);

    // Permission check based on upload mode.
    const manual = isManualSource(meta.sourceKind);
    if (manual && !device.permissions.canManualUpload) {
      throw new AppError("FORBIDDEN", "Device does not have manual upload permission", 403);
    }
    if (!manual && !device.permissions.canAutoUpload) {
      throw new AppError("FORBIDDEN", "Device does not have auto upload permission", 403);
    }

    const imageId = randomUUID();
    await ensureStorageRoot();

    const stored = await storeImage(imageId, data.file, data.mimetype);

    if (stored.sha256 !== meta.sha256) {
      // Clean up stored file on hash mismatch.
      const abs = getAbsolutePath(stored.storageKey);
      try {
        await import("fs").then((fs) => fs.promises.unlink(abs));
      } catch {
        // ignore
      }
      throw new AppError("HASH_MISMATCH", "Client sha256 does not match server sha256", 400);
    }

    // Validate origin_image_id loop risk.
    if (meta.originImageId) {
      throw new AppError("LOOP_RISK", "Image downloaded from server cannot be auto-uploaded", 400);
    }

    const dimensions = await getImageDimensions(stored.absolutePath);

    // Deduplication: same owner space, same upload device, same sha256 within last hour.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const existing = await prisma.image.findFirst({
      where: {
        ownerUserId: device.ownerUserId,
        uploadDeviceId: device.deviceId,
        sha256: stored.sha256,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (existing) {
      // Clean up the just-stored duplicate file.
      try {
        await import("fs").then((fs) => fs.promises.unlink(stored.absolutePath));
      } catch {
        // ignore
      }

      await logAudit({
        ownerUserId: device.ownerUserId,
        actorUserId: device.userId,
        actorDeviceId: device.deviceId,
        action: "image.upload_deduplicated",
        targetType: "image",
        targetId: existing.id,
        metadata: { sha256: stored.sha256, sourceKind: meta.sourceKind },
      });

      return reply.status(200).send({
        success: true,
        data: {
          imageId: existing.id,
          deduplicated: true,
          createdDeliveriesCount: 0,
          expiresAt: existing.expiresAt.toISOString(),
        },
      });
    }

    const expiresAt = new Date(Date.now() + config.DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const image = await prisma.$transaction(async (tx) => {
      const created = await tx.image.create({
        data: {
          id: imageId,
          ownerUserId: device.ownerUserId,
          uploadUserId: device.userId,
          uploadDeviceId: device.deviceId,
          originImageId: meta.originImageId ?? null,
          sha256: stored.sha256,
          mimeType: stored.mimeType,
          fileSize: stored.fileSize,
          width: dimensions.width,
          height: dimensions.height,
          storageKey: stored.storageKey,
          sourceKind: meta.sourceKind,
          sourceDisplayName: meta.sourceDisplayName,
          sourceMediaIdHash: meta.sourceMediaIdHash,
          expiresAt,
        },
      });

      await generateDeliveries(created, tx);
      return created;
    });

    await logAudit({
      ownerUserId: device.ownerUserId,
      actorUserId: device.userId,
      actorDeviceId: device.deviceId,
      action: "image.uploaded",
      targetType: "image",
      targetId: image.id,
      metadata: { sha256: stored.sha256, sourceKind: meta.sourceKind, fileSize: stored.fileSize },
    });

    // Notify online target devices.
    const { notifyDevicesForImage } = await import("../plugins/ws.js");
    notifyDevicesForImage(image.id);

    reply.status(201).send({
      success: true,
      data: {
        imageId: image.id,
        deduplicated: false,
        createdDeliveriesCount: await prisma.delivery.count({ where: { imageId: image.id } }),
        expiresAt: expiresAt.toISOString(),
      },
    });
  });

  // Download image.
  app.get("/images/:imageId/download", async (request, reply) => {
    if (!request.device) {
      throw new AppError("UNAUTHORIZED", "Device authentication required", 401);
    }

    const { imageId } = request.params as { imageId: string };
    const device = request.device;

    const image = await prisma.image.findFirst({
      where: {
        id: imageId,
        ownerUserId: device.ownerUserId,
        deletedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!image) {
      throw new AppError("NOT_FOUND", "Image not found or expired", 404);
    }

    // Authorization: device must have a pending/notified/downloaded delivery for this image,
    // or have manual download permission.
    const delivery = await prisma.delivery.findFirst({
      where: {
        imageId,
        targetDeviceId: device.deviceId,
        status: { in: ["pending", "notified", "downloaded"] },
      },
    });

    if (!delivery && !device.permissions.canManualDownload) {
      throw new AppError("FORBIDDEN", "Device is not authorized to download this image", 403);
    }

    const stream = createImageReadStream(image.storageKey);
    reply.header("Content-Type", image.mimeType);
    reply.header("Content-Length", String(image.fileSize));
    return reply.send(stream);
  });
}
