import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
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
  getImageDimensions,
  storeImage,
} from "../services/storage.js";
import {
  canDeleteImage,
  canReadImage,
  requireAnyAuth,
  requireDeviceAuth,
  resolveImageListFilter,
} from "../services/authorization.js";

const uploadImageSchema = z.object({
  sha256: z.string().length(64),
  sourceKind: z.enum(["screenshot", "manual_share", "selected_album", "unknown"]).default("unknown"),
  sourceDisplayName: z.string().max(255).optional(),
  sourceMediaIdHash: z.string().max(128).optional(),
  capturedAt: z.string().datetime().optional(),
  originImageId: z.string().uuid().optional(),
});

const listImagesSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  before: z.string().min(1).optional(),
  filter: z.enum(["all", "active", "expired", "today", "week", "month"]).default("all"),
  userId: z.string().uuid().optional(),
});

function isManualSource(sourceKind: string): boolean {
  return sourceKind === "manual_share";
}

function isAdminAuthorized(request: FastifyRequest): boolean {
  if (request.user?.role === "owner") return true;
  if (request.device?.permissions.canManageSpace) return true;
  return false;
}

function decodeImageCursor(raw: string): { createdAt: Date; id?: string } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      createdAt?: string;
      id?: string;
    };
    const createdAt = new Date(parsed.createdAt ?? "");
    if (!Number.isNaN(createdAt.getTime()) && parsed.id) return { createdAt, id: parsed.id };
  } catch {
    // Backward-compatible ISO timestamp cursor.
  }
  const createdAt = new Date(raw);
  if (Number.isNaN(createdAt.getTime())) {
    throw new AppError("INVALID_CURSOR", "Invalid image cursor", 400);
  }
  return { createdAt };
}

function encodeImageCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");
}

export async function imageRoutes(app: FastifyInstance): Promise<void> {
  app.post("/images", async (request, reply) => {
    const deviceAuth = requireDeviceAuth(request);
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

    const manual = isManualSource(meta.sourceKind);
    if (manual && !deviceAuth.permissions?.canManualUpload) {
      throw new AppError("FORBIDDEN", "Device does not have manual upload permission", 403);
    }
    if (!manual && !deviceAuth.permissions?.canAutoUpload) {
      throw new AppError("FORBIDDEN", "Device does not have auto upload permission", 403);
    }

    const imageId = randomUUID();
    await ensureStorageRoot();

    const stored = await storeImage(imageId, data.file, data.mimetype);
    let imagePersisted = false;

    try {

    if (stored.sha256 !== meta.sha256) {
      await deleteStoredImage(stored.storageKey);
      throw new AppError("HASH_MISMATCH", "Client sha256 does not match server sha256", 400);
    }

    if (meta.originImageId) {
      await deleteStoredImage(stored.storageKey);
      throw new AppError("LOOP_RISK", "Image downloaded from server cannot be auto-uploaded", 400);
    }

    const dimensions = await getImageDimensions(stored.absolutePath);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const existing = await prisma.image.findFirst({
      where: {
        ownerUserId: deviceAuth.ownerUserId,
        uploadDeviceId: deviceAuth.deviceId,
        sha256: stored.sha256,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (existing) {
      await deleteStoredImage(stored.storageKey);

      await logAudit({
        ownerUserId: deviceAuth.ownerUserId,
        actorUserId: deviceAuth.userId,
        actorDeviceId: deviceAuth.deviceId,
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
          ownerUserId: deviceAuth.ownerUserId,
          uploadUserId: deviceAuth.userId,
          uploadDeviceId: deviceAuth.deviceId,
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
    imagePersisted = true;

    await logAudit({
      ownerUserId: deviceAuth.ownerUserId,
      actorUserId: deviceAuth.userId,
      actorDeviceId: deviceAuth.deviceId,
      action: "image.uploaded",
      targetType: "image",
      targetId: image.id,
      metadata: { sha256: stored.sha256, sourceKind: meta.sourceKind, fileSize: stored.fileSize },
    });

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
    } catch (err) {
      if (!imagePersisted) {
        try {
          await deleteStoredImage(stored.storageKey);
        } catch (cleanupError) {
          logger.warn("Failed to clean up uncommitted image file", {
            imageId,
            storageKey: stored.storageKey,
            error: String(cleanupError),
          });
        }
      }
      throw err;
    }
  });

  app.get("/images/:imageId/download", async (request, reply) => {
    const actor = requireAnyAuth(request);
    const { imageId } = request.params as { imageId: string };

    const image = await prisma.image.findFirst({
      where: {
        id: imageId,
        ownerUserId: actor.ownerUserId,
        deletedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!image) {
      throw new AppError("NOT_FOUND", "Image not found or expired", 404);
    }

    // For devices, check for an active delivery; for users, just check the
    // actor matrix. canManualDownload no longer extends reach across
    // members (spec §6.10).
    let deliveryExists = false;
    if (actor.deviceId) {
      const delivery = await prisma.delivery.findFirst({
        where: {
          imageId,
          targetDeviceId: actor.deviceId,
          status: { in: ["pending", "notified", "downloaded"] },
        },
        select: { id: true },
      });
      deliveryExists = Boolean(delivery);
    }

    if (!canReadImage(actor, image, deliveryExists)) {
      // Always 404 to avoid leaking the existence of other members' images.
      throw new AppError("NOT_FOUND", "Image not found", 404);
    }

    const stream = createImageReadStream(image.storageKey);
    reply.header("Content-Type", image.mimeType);
    reply.header("Content-Length", String(image.fileSize));
    return reply.send(stream);
  });

  app.get("/images", async (request, reply) => {
    const actor = requireAnyAuth(request);
    const manualDownloadDevice = Boolean(
      request.device?.permissions.canManualDownload
    );
    if (!isAdminAuthorized(request) && !request.user && !manualDownloadDevice) {
      throw new AppError(
        "FORBIDDEN",
        "Manual download or manage permission required to list images",
        403
      );
    }

    const query = listImagesSchema.parse(request.query);
    const now = new Date();

    const filter = resolveImageListFilter(actor, query.userId);
    if (!isAdminAuthorized(request)) {
      // For child users we force the filter to their own uploads; if they
      // explicitly supplied a different userId we 403 to avoid any
      // ambiguity about whose images they're looking at.
      if (query.userId && query.userId !== actor.userId) {
        throw new AppError("FORBIDDEN", "Child users can only list their own images", 403);
      }
    } else if (query.userId) {
      const targetUser = await prisma.user.findFirst({
        where: { id: query.userId, ownerUserId: actor.ownerUserId },
      });
      if (!targetUser) {
        throw new AppError("NOT_FOUND", "Target user not found in this space", 404);
      }
      filter.uploadUserId = query.userId;
    }

    const where: Prisma.ImageWhereInput = { ownerUserId: filter.ownerUserId, deletedAt: null };
    if (filter.uploadUserId) where.uploadUserId = filter.uploadUserId;

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

    if (query.before) {
      const cursor = decodeImageCursor(query.before);
      if (cursor.id) {
        where.AND = [
          {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          },
        ];
      } else {
        createdAtFilter.lt = cursor.createdAt;
      }
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
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
        nextCursor: hasMore
          ? encodeImageCursor(rows[query.limit - 1].createdAt, rows[query.limit - 1].id)
          : null,
      },
    });
  });

  app.delete("/images/:imageId", async (request, reply) => {
    const actor = requireAnyAuth(request);

    const { imageId } = request.params as { imageId: string };

    const image = await prisma.image.findFirst({
      where: { id: imageId, ownerUserId: actor.ownerUserId, deletedAt: null },
    });

    if (!image || !canDeleteImage(actor, image)) {
      // Plain device tokens are always forbidden from deleting images
      // (spec §6.11). Child users looking at other members' images get a
      // 404 to avoid leaking existence.
      if (actor.deviceId) {
        throw new AppError("FORBIDDEN", "Device cannot delete images", 403);
      }
      throw new AppError("NOT_FOUND", "Image not found", 404);
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.image.update({
        where: { id: imageId },
        data: { deletedAt: now },
      });
      await tx.delivery.updateMany({
        where: {
          imageId,
          status: { in: ["pending", "notified"] },
        },
        data: { status: "expired" },
      });
    });

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
      ownerUserId: actor.ownerUserId,
      actorUserId: actor.userId,
      actorDeviceId: actor.deviceId,
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
