import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { generateRandomToken, hashToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { closeConnectionsForDevice } from "../plugins/ws.js";
import { logAudit } from "../services/audit.js";
import {
  ensureCanModifyPermissions,
  MUTABLE_RUNTIME_FIELDS,
  PRIVILEGED_PERMISSION_FIELDS,
  requireAnyAuth,
} from "../services/authorization.js";
import {
  inferDeviceProfile,
  isSelectableDeviceProfile,
  LEGACY_DEFAULT_PROFILE,
  permissionsForProfile,
  SELECTABLE_DEVICE_PROFILES,
  type SelectableDeviceProfile,
} from "../services/device-profiles.js";

const registerDeviceSchema = z.object({
  bindCode: z.string().trim().min(1).max(256),
  deviceName: z.string().trim().min(1).max(100),
  platform: z.enum(["android", "windows", "linux"]),
  osVersion: z.string().max(120).default(""),
  appVersion: z.string().max(80).default(""),
  clientGeneratedDeviceId: z.string().uuid().optional(),
  profile: z.enum(SELECTABLE_DEVICE_PROFILES).optional(),
});

const updateDeviceNameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const deviceProfileSchema = z.object({
  profile: z.enum(SELECTABLE_DEVICE_PROFILES),
});

const receiveConfigSchema = z.object({
  mode: z.enum(["disabled", "same_user_only", "selected_devices", "all_authorized_sources"]),
  sourceDeviceIds: z.array(z.string().uuid()).optional(),
});

const updatePermissionsSchema = z
  .object({
    canAutoUpload: z.boolean().optional(),
    canManualUpload: z.boolean().optional(),
    canAutoReceive: z.boolean().optional(),
    canManualDownload: z.boolean().optional(),
    canManageSpace: z.boolean().optional(),
    canCreateInvite: z.boolean().optional(),
    autoUploadScope: z
      .enum(["screenshot_only", "selected_album", "manual_share_only", "all_images"])
      .optional(),
    autoReceiveScope: z
      .enum(["disabled", "all_authorized_sources", "same_user_only", "selected_devices"])
      .optional(),
  })
  .strict();

const receiveSourceRuleSchema = z.object({
  enabled: z.boolean().default(true),
});

interface DeviceAuthContext {
  ownerUserId: string;
  userId: string;
  deviceId?: string;
  isOwner: boolean;
  canManageSpace: boolean;
}

function getDeviceAuthContext(request: FastifyRequest): DeviceAuthContext {
  if (request.user) {
    return {
      ownerUserId: request.user.ownerUserId,
      userId: request.user.userId,
      isOwner: request.user.role === "owner",
      canManageSpace: false,
    };
  }

  if (request.device) {
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

function serializePermissions(permissions: {
  canAutoUpload: boolean;
  canManualUpload: boolean;
  canAutoReceive: boolean;
  canManualDownload: boolean;
  canManageSpace: boolean;
  canCreateInvite: boolean;
  autoUploadScope: string;
  autoReceiveScope: string;
}) {
  return {
    canAutoUpload: permissions.canAutoUpload,
    canManualUpload: permissions.canManualUpload,
    canAutoReceive: permissions.canAutoReceive,
    canManualDownload: permissions.canManualDownload,
    canManageSpace: permissions.canManageSpace,
    canCreateInvite: permissions.canCreateInvite,
    autoUploadScope: permissions.autoUploadScope,
    autoReceiveScope: permissions.autoReceiveScope,
  };
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
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

    if (!targetUser || targetUser.disabledAt) {
      // Disabled users must not be able to register new devices, even if a
      // pre-disabled bind code is still floating around.
      throw new AppError("INVALID_BIND_CODE", "Bind code target user is unavailable", 400);
    }

    const deviceToken = generateRandomToken(32);
    const deviceTokenHash = hashToken(deviceToken);

    // A child member's new device must be useful without an owner having to
    // repair its permissions afterwards.  When an older client omits a
    // profile, default child devices to same-user receiving; owner devices
    // keep the legacy fallback for backwards compatibility.
    const profile = body.profile
      ? permissionsForProfile(body.profile)
      : targetUser.role === "child"
        ? permissionsForProfile("receive_own")
        : LEGACY_DEFAULT_PROFILE;

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
          canAutoUpload: profile.canAutoUpload,
          canManualUpload: profile.canManualUpload,
          canAutoReceive: profile.canAutoReceive,
          // Child members naturally own manual upload/download rights for
          // images uploaded by their own user. Authorization still prevents
          // this permission from crossing member or owner-space boundaries.
          canManualDownload: targetUser.role === "child",
          canManageSpace: false,
          canCreateInvite: false,
          autoUploadScope: profile.autoUploadScope,
          autoReceiveScope: profile.autoReceiveScope,
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
        targetUserId: targetUser.id,
        profile: body.profile ?? "custom",
      },
    });

    const persistedPermissions = await prisma.devicePermission.findUniqueOrThrow({
      where: { deviceId: device.id },
    });

    reply.status(201).send({
      success: true,
      data: {
        deviceId: device.id,
        deviceToken,
        profile: body.profile ?? inferDeviceProfile(persistedPermissions),
        permissions: serializePermissions(persistedPermissions),
        user: {
          id: targetUser.id,
          ownerUserId: targetUser.ownerUserId,
          role: targetUser.role,
          displayName: targetUser.displayName,
        },
      },
    });
  });

  app.get("/devices/me", async (request, reply) => {
    if (!request.device) {
      throw new AppError("DEVICE_AUTH_REQUIRED", "Device authentication required", 401);
    }

    const device = await prisma.device.findFirst({
      where: { id: request.device.deviceId, deletedAt: null },
      include: { permissions: true, user: true },
    });
    if (!device) {
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    const profile = inferDeviceProfile(device.permissions);

    reply.send({
      success: true,
      data: {
        device: {
          id: device.id,
          name: device.name,
          platform: device.platform,
          appVersion: device.appVersion,
          osVersion: device.osVersion,
          createdAt: device.createdAt.toISOString(),
          lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
          revokedAt: device.revokedAt?.toISOString() ?? null,
        },
        user: {
          id: device.user.id,
          ownerUserId: device.user.ownerUserId,
          role: device.user.role,
          displayName: device.user.displayName,
        },
        profile,
        permissions: serializePermissions(device.permissions ?? {
          canAutoUpload: false,
          canManualUpload: true,
          canAutoReceive: false,
          canManualDownload: false,
          canManageSpace: false,
          canCreateInvite: false,
          autoUploadScope: "screenshot_only",
          autoReceiveScope: "disabled",
        }),
      },
    });
  });

  app.get("/devices", async (request, reply) => {
    const auth = getDeviceAuthContext(request);

    if (auth.deviceId && !auth.canManageSpace) {
      throw new AppError("FORBIDDEN", "Device does not have manage permission", 403);
    }

    const where: { ownerUserId: string; deletedAt: null; userId?: string } = {
      ownerUserId: auth.ownerUserId,
      deletedAt: null,
    };
    if (!auth.isOwner && !auth.canManageSpace) {
      where.userId = auth.userId;
    }

    const devices = await prisma.device.findMany({
      where,
      include: {
        permissions: true,
        user: true,
        receiveRulesAsTarget: {
          where: {
            enabled: true,
            sourceDevice: { revokedAt: null, deletedAt: null },
          },
          select: { sourceDeviceId: true },
        },
      },
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
          userRole: d.user.role,
          name: d.name,
          platform: d.platform,
          appVersion: d.appVersion,
          osVersion: d.osVersion,
          lastSeenAt: d.lastSeenAt?.toISOString(),
          createdAt: d.createdAt.toISOString(),
          revokedAt: d.revokedAt?.toISOString(),
          profile: inferDeviceProfile(d.permissions),
          receiveSourceDeviceIds: d.receiveRulesAsTarget.map((rule) => rule.sourceDeviceId),
          permissions: serializePermissions(d.permissions ?? {
            canAutoUpload: false,
            canManualUpload: true,
            canAutoReceive: false,
            canManualDownload: false,
            canManageSpace: false,
            canCreateInvite: false,
            autoUploadScope: "screenshot_only",
            autoReceiveScope: "disabled",
          }),
        })),
      },
    });
  });

  app.patch("/devices/:deviceId", async (request, reply) => {
    const auth = getDeviceAuthContext(request);
    const { deviceId } = request.params as { deviceId: string };
    const body = updateDeviceNameSchema.parse(request.body);

    const device = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null, revokedAt: null },
    });

    if (!device) {
      // Don't reveal existence to non-admins: 404 for child users looking
      // at other members, 403 for plain device tokens.
      if (auth.deviceId) {
        throw new AppError("FORBIDDEN", "Device cannot manage other devices", 403);
      }
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    const isSelfDevice = !auth.deviceId && auth.userId === device.userId;
    const allowed =
      auth.isOwner || (auth.deviceId && auth.canManageSpace) || isSelfDevice;
    if (!allowed) {
      if (auth.deviceId) {
        throw new AppError("FORBIDDEN", "Device cannot manage other devices", 403);
      }
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

  app.patch("/devices/:deviceId/profile", async (request, reply) => {
    const auth = getDeviceAuthContext(request);
    const { deviceId } = request.params as { deviceId: string };
    const body = deviceProfileSchema.parse(request.body);

    if (!isSelectableDeviceProfile(body.profile)) {
      throw new AppError("INVALID_DEVICE_PROFILE", "Invalid device profile", 400);
    }

    const device = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null, revokedAt: null },
    });
    if (!device) {
      if (auth.deviceId) {
        throw new AppError("FORBIDDEN", "Device cannot manage other devices", 403);
      }
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    const isSelfDevice = !auth.deviceId && auth.userId === device.userId;
    const allowed =
      auth.isOwner || (auth.deviceId && auth.canManageSpace) || isSelfDevice;
    if (!allowed) {
      if (auth.deviceId) {
        throw new AppError("FORBIDDEN", "Device cannot manage other devices", 403);
      }
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    const patch = permissionsForProfile(body.profile as SelectableDeviceProfile);

    const updated = await prisma.devicePermission.update({
      where: { deviceId },
      data: {
        canAutoUpload: patch.canAutoUpload,
        canManualUpload: patch.canManualUpload,
        canAutoReceive: patch.canAutoReceive,
        autoUploadScope: patch.autoUploadScope,
        autoReceiveScope: patch.autoReceiveScope,
      },
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.userId,
      actorDeviceId: auth.deviceId,
      action: "device.profile_updated",
      targetType: "device",
      targetId: deviceId,
      metadata: { profile: body.profile },
    });

    reply.send({
      success: true,
      data: {
        profile: body.profile,
        permissions: serializePermissions(updated),
      },
    });
  });

  app.put("/devices/:deviceId/receive-config", async (request, reply) => {
    const auth = getDeviceAuthContext(request);
    const { deviceId } = request.params as { deviceId: string };
    const body = receiveConfigSchema.parse(request.body);

    const target = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null, revokedAt: null },
    });
    if (!target) {
      if (auth.deviceId) {
        throw new AppError("FORBIDDEN", "Device cannot manage other devices", 403);
      }
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    const isSelfDevice = !auth.deviceId && auth.userId === target.userId;
    const canManageTarget =
      auth.isOwner || (auth.deviceId && auth.canManageSpace) || isSelfDevice;
    if (!canManageTarget) {
      if (auth.deviceId) {
        throw new AppError("FORBIDDEN", "Device cannot manage other devices", 403);
      }
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    // Child users cannot opt into all_authorized_sources because that
    // explicitly crosses members (spec §6.8).
    if (
      body.mode === "all_authorized_sources" &&
      !auth.isOwner &&
      !(auth.deviceId && auth.canManageSpace)
    ) {
      throw new AppError(
        "FORBIDDEN",
        "Only owner users or canManageSpace devices can configure all_authorized_sources",
        403
      );
    }

    if (body.mode === "selected_devices") {
      if (!body.sourceDeviceIds || body.sourceDeviceIds.length === 0) {
        throw new AppError(
          "INVALID_RECEIVE_CONFIG",
          "selected_devices requires at least one sourceDeviceId",
          400
        );
      }
      const uniqueSourceDeviceIds = [...new Set(body.sourceDeviceIds)];
      if (uniqueSourceDeviceIds.length !== body.sourceDeviceIds.length || uniqueSourceDeviceIds.includes(deviceId)) {
        throw new AppError(
          "INVALID_RECEIVE_CONFIG",
          "Source devices must be unique and cannot include the target device",
          400
        );
      }
      const sources = await prisma.device.findMany({
        where: {
          id: { in: uniqueSourceDeviceIds },
          ownerUserId: auth.ownerUserId,
          revokedAt: null,
          deletedAt: null,
        },
      });
      if (sources.length !== uniqueSourceDeviceIds.length) {
        throw new AppError("NOT_FOUND", "Source device not found in this space", 404);
      }
      // Child users are not allowed to mix in another member's sources.
      if (!auth.isOwner && !(auth.deviceId && auth.canManageSpace)) {
        const crossUser = sources.find((s) => s.userId !== target.userId);
        if (crossUser) {
          throw new AppError("CROSS_USER_SOURCE_FORBIDDEN", "Cross-user source not allowed", 404);
        }
      }
    }

    const updatedPermission = await prisma.$transaction(async (tx) => {
      const scopePatch = (() => {
        switch (body.mode) {
          case "disabled":
            return { canAutoReceive: false, autoReceiveScope: "disabled" as const };
          case "same_user_only":
            return { canAutoReceive: true, autoReceiveScope: "same_user_only" as const };
          case "selected_devices":
            return { canAutoReceive: true, autoReceiveScope: "selected_devices" as const };
          case "all_authorized_sources":
            return { canAutoReceive: true, autoReceiveScope: "all_authorized_sources" as const };
        }
      })();

      const permission = await tx.devicePermission.update({
        where: { deviceId },
        data: scopePatch,
      });

      await tx.receiveSourceRule.deleteMany({ where: { targetDeviceId: deviceId } });

      if (body.mode === "selected_devices" && body.sourceDeviceIds) {
        await tx.receiveSourceRule.createMany({
          data: body.sourceDeviceIds.map((sourceDeviceId) => ({
            targetDeviceId: deviceId,
            sourceDeviceId,
            enabled: true,
          })),
        });
      }

      return permission;
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.userId,
      actorDeviceId: auth.deviceId,
      action: "device.receive_config_updated",
      targetType: "device",
      targetId: deviceId,
      metadata: {
        mode: body.mode,
        sourceDeviceIds: body.sourceDeviceIds ?? [],
      },
    });

    reply.send({
      success: true,
      data: {
        mode: body.mode,
        sourceDeviceIds: body.mode === "selected_devices" ? body.sourceDeviceIds ?? [] : [],
        permissions: serializePermissions(updatedPermission),
      },
    });
  });

  app.patch("/devices/:deviceId/permissions", async (request, reply) => {
    const actor = requireAnyAuth(request);
    const { deviceId } = request.params as { deviceId: string };
    const body = updatePermissionsSchema.parse(request.body);

    const device = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: actor.ownerUserId, deletedAt: null },
    });
    if (!device) {
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    const isChildManagingOwnDevice =
      !actor.deviceId && actor.role === "child" && actor.userId === device.userId;
    if (isChildManagingOwnDevice) {
      // Profiles and receive-config are the safe paths for automatic receive
      // settings. Child users may directly control only the two manual rights
      // on devices belonging to themselves.
      const childMutableFields = new Set(["canManualUpload", "canManualDownload"]);
      const unsupported = Object.keys(body).find((field) => !childMutableFields.has(field));
      if (unsupported) {
        throw new AppError(
          "CHILD_PERMISSION_FIELD_FORBIDDEN",
          `Child users cannot directly modify ${unsupported}; use a device profile or receive-config`,
          403
        );
      }
    } else {
      ensureCanModifyPermissions(actor, body);
    }

    const data: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      data[key] = (body as Record<string, unknown>)[key];
    }

    const updated = await prisma.devicePermission.update({
      where: { deviceId },
      data,
    });

    await logAudit({
      ownerUserId: actor.ownerUserId,
      actorUserId: actor.userId,
      actorDeviceId: actor.deviceId,
      action: "device.permissions_updated",
      targetType: "device",
      targetId: deviceId,
      metadata: data,
    });

    reply.send({
      success: true,
      data: {
        profile: inferDeviceProfile(updated),
        permissions: serializePermissions(updated),
        allowedFields: {
          runtime: [...MUTABLE_RUNTIME_FIELDS],
          privileged: [...PRIVILEGED_PERMISSION_FIELDS],
        },
      },
    });
  });

  app.get("/devices/:deviceId/receive-sources", async (request, reply) => {
    const auth = getDeviceAuthContext(request);
    const { deviceId } = request.params as { deviceId: string };
    const targetDevice = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null },
    });
    if (!targetDevice) {
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }
    const isSelfDevice = !auth.deviceId && auth.userId === targetDevice.userId;
    if (!auth.isOwner && !auth.canManageSpace && !isSelfDevice) {
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
    const auth = getDeviceAuthContext(request);
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
    const auth = getDeviceAuthContext(request);
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

  app.post("/devices/:deviceId/revoke", async (request, reply) => {
    const auth = getDeviceAuthContext(request);
    const { deviceId } = request.params as { deviceId: string };

    const device = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null },
    });

    if (!device) {
      if (auth.deviceId) {
        throw new AppError("FORBIDDEN", "Device cannot manage other devices", 403);
      }
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    const isSelfDevice = !auth.deviceId && auth.userId === device.userId;
    const allowed =
      auth.isOwner || (auth.deviceId && auth.canManageSpace) || isSelfDevice;
    if (!allowed) {
      if (auth.deviceId) {
        throw new AppError("FORBIDDEN", "Device cannot manage other devices", 403);
      }
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

  app.delete("/devices/:deviceId", async (request, reply) => {
    const auth = getDeviceAuthContext(request);
    const { deviceId } = request.params as { deviceId: string };

    const device = await prisma.device.findFirst({
      where: { id: deviceId, ownerUserId: auth.ownerUserId, deletedAt: null },
    });
    if (!device) {
      if (auth.deviceId) {
        throw new AppError("FORBIDDEN", "Device cannot manage other devices", 403);
      }
      throw new AppError("NOT_FOUND", "Device not found", 404);
    }

    const isSelfDevice = !auth.deviceId && auth.userId === device.userId;
    const allowed =
      auth.isOwner || (auth.deviceId && auth.canManageSpace) || isSelfDevice;
    if (!allowed) {
      if (auth.deviceId) {
        throw new AppError("FORBIDDEN", "Device cannot manage other devices", 403);
      }
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
