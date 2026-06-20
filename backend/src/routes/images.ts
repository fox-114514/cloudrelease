import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { AppError } from "../errors.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { prisma } from "../lib/prisma.js";
import { logAudit } from "../services/audit.js";
import { generateDeliveries } from "../services/delivery.js";
import {
  createImageReadStream,
  deleteStoredImage,
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

const listImagesSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  before: z.string().datetime().optional(),
  filter: z.enum(["all", "active", "expired", "today", "week", "month"]).default("all"),
});

function isManualSource(sourceKind: string): boolean {
  return sourceKind === "manual_share";
}

function isAdminAuthorized(request: FastifyRequest): boolean {
  if (request.user?.role === "owner") return true;
  if (request.device?.permissions.canManageSpace) return true;
  return false;
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

    // Validate origin_image_id loop risk before any further processing.
    if (meta.originImageId) {
      try {
        await import("fs").then((fs) => fs.promises.unlink(stored.absolutePath));
      } catch {
        // ignore
      }
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
    const isAdmin = isAdminAuthorized(request);
    if (!request.device && !isAdmin) {
      throw new AppError("UNAUTHORIZED", "Authentication required", 401);
    }

    const { imageId } = request.params as { imageId: string };
    const ownerUserId = request.user?.ownerUserId ?? request.device!.ownerUserId;

    const image = await prisma.image.findFirst({
      where: {
        id: imageId,
        ownerUserId,
        deletedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!image) {
      throw new AppError("NOT_FOUND", "Image not found or expired", 404);
    }

    // Authorization:
    // - Admin (owner user or canManageSpace device): always allowed.
    // - Device: must have a pending/notified/downloaded delivery, or have manual download permission.
    if (!isAdmin && request.device) {
      const device = request.device;
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
    }

    const stream = createImageReadStream(image.storageKey);
    reply.header("Content-Type", image.mimeType);
    reply.header("Content-Length", String(image.fileSize));
    return reply.send(stream);
  });

  // List images (admin only).
  app.get("/images", async (request, reply) => {
    if (!request.user && !request.device) {
      throw new AppError("UNAUTHORIZED", "Authentication required", 401);
    }
    if (!isAdminAuthorized(request)) {
      throw new AppError(
        "FORBIDDEN",
        "Manage permission required to list images",
        403
      );
    }

    const query = listImagesSchema.parse(request.query);
    const ownerUserId = request.user?.ownerUserId ?? request.device!.ownerUserId;
    const now = new Date();

    // All filters exclude soft-deleted images by default. Deleted images cannot
    // be previewed (GET /download filters them out) and re-deleting them would
    // always 404, so showing them in the library is just noise. Inspect
    // audit_logs if you need deletion history.
    const where: {
      ownerUserId: string;
      deletedAt: null;
      expiresAt?: { gt: Date } | { lte: Date };
      createdAt?: { gte?: Date; lt?: Date };
    } = { ownerUserId, deletedAt: null };

    const createdAtFilter: { gte?: Date; lt?: Date } = {};

    if (query.filter === "active") {
      where.expiresAt = { gt: now };
    } else if (query.filter === "expired") {
      where.expiresAt = { lte: now };
    } else if (query.filter === "today") {
      createdAtFilter.gte = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (query.filter === "week") {
      createdAtFilter.gte = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (query.filter === "month") {
      createdAtFilter.gte = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    // "all": every non-deleted image regardless of expiry or age.

    if (query.before) {
      createdAtFilter.lt = new Date(query.before);
    }

    if (Object.keys(createdAtFilter).length > 0) {
      where.createdAt = createdAtFilter;
    }

    const rows = await prisma.image.findMany({
      where,
      include: {
        uploadDevice: { select: { id: true, name: true } },
        uploadUser: { select: { id: true, displayName: true, emailOrLogin: true } },
      },
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const items = (hasMore ? rows.slice(0, query.limit) : rows).map((img) => ({
      id: img.id,
      mimeType: img.mimeType,
      fileSize: img.fileSize,
      width: img.width,
      height: img.height,
      sha256: img.sha256,
      sourceKind: img.sourceKind,
      sourceDisplayName: img.sourceDisplayName,
      uploadedBy: {
        userId: img.uploadUserId,
        userDisplayName:
          img.uploadUser.displayName ?? img.uploadUser.emailOrLogin ?? img.uploadUserId,
        deviceId: img.uploadDeviceId,
        deviceName: img.uploadDevice.name,
      },
      createdAt: img.createdAt.toISOString(),
      expiresAt: img.expiresAt.toISOString(),
      isExpired: img.expiresAt <= now,
    }));

    reply.send({
      success: true,
      data: {
        images: items,
        nextCursor: hasMore ? items[items.length - 1].createdAt : null,
      },
    });
  });

  // Delete image (admin only).
  app.delete("/images/:imageId", async (request, reply) => {
    if (!request.user && !request.device) {
      throw new AppError("UNAUTHORIZED", "Authentication required", 401);
    }
    if (!isAdminAuthorized(request)) {
      throw new AppError(
        "FORBIDDEN",
        "Manage permission required to delete images",
        403
      );
    }

    const { imageId } = request.params as { imageId: string };
    const ownerUserId = request.user?.ownerUserId ?? request.device!.ownerUserId;

    const image = await prisma.image.findFirst({
      where: { id: imageId, ownerUserId, deletedAt: null },
    });

    if (!image) {
      throw new AppError("NOT_FOUND", "Image not found", 404);
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.image.update({
        where: { id: imageId },
        data: { deletedAt: now },
      });
      // Cascade: any pending/notified deliveries for this image become expired
      // so the cleanup task can drop them on the next pass.
      await tx.delivery.updateMany({
        where: {
          imageId,
          status: { in: ["pending", "notified"] },
        },
        data: { status: "expired" },
      });
    });

    // Best-effort file removal. deleteStoredImage silently ignores ENOENT.
    try {
      await deleteStoredImage(image.storageKey);
    } catch (err) {
      logger.warn("Failed to delete image file from storage", {
        imageId,
        storageKey: image.storageKey,
        error: String(err),
      });
    }

    await logAudit({
      ownerUserId,
      actorUserId: request.user?.userId,
      actorDeviceId: request.device?.deviceId,
      action: "image.deleted",
      targetType: "image",
      targetId: imageId,
      metadata: {
        storageKey: image.storageKey,
        mimeType: image.mimeType,
        fileSize: image.fileSize,
        sha256: image.sha256,
      },
    });

    reply.send({
      success: true,
      data: {
        imageId,
        deletedAt: now.toISOString(),
      },
    });
  });
}
