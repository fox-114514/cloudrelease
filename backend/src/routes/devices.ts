import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { generateRandomToken, hashToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { closeConnectionsForDevice } from "../plugins/ws.js";
import { logAudit } from "../services/audit.js";

const registerDeviceSchema = z.object({
  bindCode: z.string().trim().min(1),
  deviceName: z.string().min(1).max(100),
  platform: z.enum(["android", "windows", "linux"]),
  osVersion: z.string().default(""),
  appVersion: z.string().default(""),
  clientGeneratedDeviceId: z.string().uuid().optional(),
});

const updatePermissionsSchema = z.object({
  canAutoUpload: z.boolean().optional(),
  canManualUpload: z.boolean().optional(),
  canAutoReceive: z.boolean().optional(),
  canManualDownload: z.boolean().optional(),
  canManageSpace: z.boolean().optional(),
  canCreateInvite: z.boolean().optional(),
  autoUploadScope: z.enum(["screenshot_only", "selected_album", "manual_share_only", "all_images"]).optional(),
  autoReceiveScope: z.enum(["disabled", "all_authorized_sources", "same_user_only", "selected_devices"]).optional(),
});

const updateDeviceSchema = z.object({
  name: z.string().min(1).max(100),
});

const receiveSourceRuleSchema = z.object({
  enabled: z.boolean().default(true),
});

function getAuthContext(request: FastifyRequest): {
  ownerUserId: string;
  userId: string;
  deviceId?: string;
  isOwner: boolean;
  canManageSpace: boolean;
} {
  if (request.user) {
    return {
      ownerUserId: request.user.ownerUserId,
      userId: request.user.userId,
      isOwner: request.user.role === "owner",
      canManageSpace: false,
    };
  }

  if (request.device) {
    // Device tokens are never treated as owner, even if the owning user is owner.
    // Management actions require the device itself to have canManageSpace.
    return {
      ownerUserId: request.device.ownerUserId,
      userId: request.device.userId,
      deviceId: request.device.deviceId,
      isOwner: false,
      canManageSpace: request.device.permissions.canManageSpace,
    };
  }

  throw new AppError("UNAUTHORIZED", "Authentication required", 401);
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // Public endpoint: register a new device using a bind code.
  app.post("/devices/register", async (request, reply) => {
    const body = registerDeviceSchema.parse(request.body);

    const codeHash = hashToken(body.bindCode);
    const bindCode = await prisma.bindCode.findUnique({
      where: { codeHash },
    });

    if (!bindCode || bindCode.usedAt || bindCode.expiresAt < new Date()) {
      throw new AppError("INVALID_BIND_CODE", "Bind code is invalid, expired, or already used", 400);
    }

    if (bindCode.purpose !== "bind_device") {
      throw new AppError("INVALID_BIND_CODE", "Bind code is not for device registration", 400);
    }

    const targetUser = await prisma.user.findFirst({
      where: {
        id: bindCode.targetUserId,
        ownerUserId: bindCode.ownerUserId,
      },
    });

    if (!targetUser) {
      throw new AppError("INVALID_BIND_CODE", "Bind code target user not found", 400);
    }

    const deviceToken = generateRandomToken(32);
    const deviceTokenHash = hashToken(deviceToken);

    const device = await prisma.$transaction(async (tx) => {
      const newDevice = await tx.device.create({
        data: {
          id: body.clientGeneratedDeviceId,
          ownerUserId: bindCode.ownerUserId,
          userId: targetUser.id,
          name: body.deviceName,
          platform: body.platform,
          appVersion: body.appVersion,
          osVersion: body.osVersion,
          deviceTokenHash,
        },
      });

      await tx.devicePermission.create({
        data: {
          deviceId: newDevice.id,
          canAutoUpload: false,
          canManualUpload: true,
          canAutoReceive: false,
          canManualDownload: false,
          canManageSpace: false,
          canCreateInvite: false,
          autoUploadScope: "screenshot_only",
          autoReceiveScope: "disabled",
        },
      });

      const markUsed = await tx.bindCode.updateMany({
        where: {
          id: bindCode.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: {
          usedAt: new Date(),
          usedByDeviceId: newDevice.id,
        },
      });

      if (markUsed.count !== 1) {
        throw new AppError("INVALID_BIND_CODE", "Bind code was already used or expired", 400);
      }

      return newDevice;
    });

    await logAudit({
      ownerUserId: device.ownerUserId,
      actorUserId: undefined,
      actorDeviceId: device.id,
      action: "device.registered",
      targetType: "device",
      targetId: device.id,
      metadata: {
        platform: body.platform,
        deviceName: body.deviceName,
      },
    });

    reply.status(201).send({
      success: true,
      data: {
        deviceId: device.id,
        deviceToken,
        permissions: {
          canAutoUpload: false,
          canManualUpload: true,
          canAutoReceive: false,
          canManualDownload: false,
          canManageSpace: false,
          canCreateInvite: false,
          autoUploadScope: "screenshot_only",
          autoReceiveScope: "disabled",
        },
        user: {
          id: targetUser.id,
          ownerUserId: targetUser.ownerUserId,
          role: targetUser.role,
          displayName: targetUser.displayName,
        },
      },
    });
  });

  // List devices in the current owner space.
  app.get("/devices", async (request, reply) => {
    const auth = getAuthContext(request);

    // Permission boundary:
    // - Owner user token: can list all devices in the space.
    // - Device token: can only list devices if it has canManageSpace.
    // - Child user token: can only list their own devices.
    if (auth.deviceId && !auth.canManageSpace) {
      throw new AppError("FORBIDDEN", "Device does not have manage permission", 403);
    }

    let where: { ownerUserId: string; deletedAt: null; userId?: string } = {
      ownerUserId: auth.ownerUserId,
      deletedAt: null,
    };
    if (!auth.isOwner && !auth.canManageSpace) {
      where.userId = auth.userId;
    }

    const devices = await prisma.device.findMany({
      where,
      include: { permissions: true, user: true },
      orderBy: { createdAt: "desc" },
    });

    reply.send({
      success: true,
      data: {
        devices: devices.map((d) => ({
          id: d.id,
          ownerUserId: d.ownerUserId,
          userId: d.userId,
          userDisplayName: d.user.displayName,
          name: d.name,
          platform: d.platform,
          appVersion: d.appVersion,
          osVersion: d.osVersion,
          lastSeenAt: d.lastSeenAt?.toISOString(),
          createdAt: d.createdAt.toISOString(),
          revokedAt: d.revokedAt?.toISOString(),
          permissions: d.permissions,
        })),
      },
    });
  });

  // Update device metadata.
  app.patch("/devices/:deviceId", async (request, reply) => {
    const auth = getAuthContext(request);

    if (!auth.isOwner && !auth.canManageSpace) {
      throw new AppError("FORBIDDEN", "Insufficient permission to manage device", 403);
    }

    const { deviceId } = request.params as { deviceId: string };
    const body = updateDeviceSchema.parse(request.body);

    const device = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null },
    });

    if (!device) {
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    const updated = await prisma.device.update({
      where: { id: deviceId },
      data: { name: body.name },
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.userId,
      actorDeviceId: auth.deviceId,
      action: "device.updated",
      targetType: "device",
      targetId: deviceId,
      metadata: { name: body.name },
    });

    reply.send({
      success: true,
      data: {
        device: {
          id: updated.id,
          name: updated.name,
        },
      },
    });
  });

  // Update device permissions.
  app.patch("/devices/:deviceId/permissions", async (request, reply) => {
    const auth = getAuthContext(request);

    // Only owner users or devices with manage permission can change permissions.
    if (!auth.isOwner && !auth.canManageSpace) {
      throw new AppError("FORBIDDEN", "Insufficient permission to manage device permissions", 403);
    }

    const { deviceId } = request.params as { deviceId: string };
    const body = updatePermissionsSchema.parse(request.body);

    const device = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null },
    });

    if (!device) {
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    const updated = await prisma.devicePermission.update({
      where: { deviceId },
      data: body,
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.userId,
      actorDeviceId: auth.deviceId,
      action: "device.permissions_updated",
      targetType: "device",
      targetId: deviceId,
      metadata: body,
    });

    reply.send({
      success: true,
      data: { permissions: updated },
    });
  });

  app.get("/devices/:deviceId/receive-sources", async (request, reply) => {
    const auth = getAuthContext(request);
    if (!auth.isOwner && !auth.canManageSpace) {
      throw new AppError("FORBIDDEN", "Insufficient permission to view receive source rules", 403);
    }

    const { deviceId } = request.params as { deviceId: string };
    const targetDevice = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null },
    });
    if (!targetDevice) {
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    const rules = await prisma.receiveSourceRule.findMany({
      where: { targetDeviceId: deviceId },
      include: { sourceDevice: true },
      orderBy: { createdAt: "asc" },
    });

    reply.send({
      success: true,
      data: {
        rules: rules.map((rule) => ({
          targetDeviceId: rule.targetDeviceId,
          sourceDeviceId: rule.sourceDeviceId,
          sourceDeviceName: rule.sourceDevice.name,
          enabled: rule.enabled,
          createdAt: rule.createdAt.toISOString(),
        })),
      },
    });
  });

  app.put("/devices/:deviceId/receive-sources/:sourceDeviceId", async (request, reply) => {
    const auth = getAuthContext(request);
    if (!auth.isOwner && !auth.canManageSpace) {
      throw new AppError("FORBIDDEN", "Insufficient permission to manage receive source rules", 403);
    }

    const { deviceId, sourceDeviceId } = request.params as { deviceId: string; sourceDeviceId: string };
    const body = receiveSourceRuleSchema.parse(request.body);

    if (deviceId === sourceDeviceId) {
      throw new AppError("INVALID_RECEIVE_SOURCE", "Device cannot receive from itself", 400);
    }

    const devices = await prisma.device.findMany({
      where: {
        id: { in: [deviceId, sourceDeviceId] },
        ownerUserId: auth.ownerUserId,
        deletedAt: null,
      },
    });

    if (devices.length !== 2) {
      throw new AppError("NOT_FOUND", "Target or source device not found", 404);
    }

    const rule = await prisma.receiveSourceRule.upsert({
      where: {
        targetDeviceId_sourceDeviceId: {
          targetDeviceId: deviceId,
          sourceDeviceId,
        },
      },
      create: {
        targetDeviceId: deviceId,
        sourceDeviceId,
        enabled: body.enabled,
      },
      update: {
        enabled: body.enabled,
      },
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.userId,
      actorDeviceId: auth.deviceId,
      action: "device.receive_source_rule_updated",
      targetType: "device",
      targetId: deviceId,
      metadata: { sourceDeviceId, enabled: rule.enabled },
    });

    reply.send({
      success: true,
      data: {
        rule: {
          targetDeviceId: rule.targetDeviceId,
          sourceDeviceId: rule.sourceDeviceId,
          enabled: rule.enabled,
          createdAt: rule.createdAt.toISOString(),
        },
      },
    });
  });

  app.delete("/devices/:deviceId/receive-sources/:sourceDeviceId", async (request, reply) => {
    const auth = getAuthContext(request);
    if (!auth.isOwner && !auth.canManageSpace) {
      throw new AppError("FORBIDDEN", "Insufficient permission to manage receive source rules", 403);
    }

    const { deviceId, sourceDeviceId } = request.params as { deviceId: string; sourceDeviceId: string };
    const targetDevice = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null },
    });
    if (!targetDevice) {
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    await prisma.receiveSourceRule.deleteMany({
      where: { targetDeviceId: deviceId, sourceDeviceId },
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.userId,
      actorDeviceId: auth.deviceId,
      action: "device.receive_source_rule_deleted",
      targetType: "device",
      targetId: deviceId,
      metadata: { sourceDeviceId },
    });

    reply.send({ success: true, data: { removed: true } });
  });

  // Revoke a device.
  app.post("/devices/:deviceId/revoke", async (request, reply) => {
    const auth = getAuthContext(request);

    if (!auth.isOwner && !auth.canManageSpace) {
      throw new AppError("FORBIDDEN", "Insufficient permission to revoke device", 403);
    }

    const { deviceId } = request.params as { deviceId: string };
    const device = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null },
    });

    if (!device) {
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    await prisma.device.update({
      where: { id: deviceId },
      data: { revokedAt: new Date() },
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.userId,
      actorDeviceId: auth.deviceId,
      action: "device.revoked",
      targetType: "device",
      targetId: deviceId,
    });

    await closeConnectionsForDevice(deviceId);

    reply.send({
      success: true,
      data: { revokedAt: new Date().toISOString() },
    });
  });

  // Hide a revoked device from management while preserving image/audit history.
  app.delete("/devices/:deviceId", async (request, reply) => {
    const auth = getAuthContext(request);
    if (!auth.isOwner && !auth.canManageSpace) {
      throw new AppError("FORBIDDEN", "Insufficient permission to delete device", 403);
    }

    const { deviceId } = request.params as { deviceId: string };
    const device = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null },
    });
    if (!device) {
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }
    if (!device.revokedAt) {
      throw new AppError("DEVICE_NOT_REVOKED", "Device must be revoked before deletion", 409);
    }

    const deletedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.receiveSourceRule.deleteMany({
        where: {
          OR: [{ targetDeviceId: deviceId }, { sourceDeviceId: deviceId }],
        },
      });
      await tx.delivery.updateMany({
        where: {
          targetDeviceId: deviceId,
          status: { in: ["pending", "notified"] },
        },
        data: {
          status: "skipped",
          failureReason: "Target device deleted",
        },
      });
      await tx.device.update({
        where: { id: deviceId },
        data: { deletedAt },
      });
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.userId,
      actorDeviceId: auth.deviceId,
      action: "device.deleted",
      targetType: "device",
      targetId: deviceId,
    });

    await closeConnectionsForDevice(deviceId);
    reply.send({ success: true, data: { deletedAt: deletedAt.toISOString() } });
  });
}
