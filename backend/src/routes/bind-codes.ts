import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { generateRandomToken, hashToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { logAudit } from "../services/audit.js";

const MAX_BIND_CODE_TTL_SECONDS = 3600;
const DEFAULT_BIND_CODE_TTL_SECONDS = 600;

const createBindCodeSchema = z.object({
  purpose: z.enum(["bind_device", "invite_child_user"]).default("bind_device"),
  userId: z.string().uuid().optional(),
  deviceNameHint: z.string().max(100).optional(),
  expiresInSeconds: z
    .number()
    .int()
    .positive()
    .max(MAX_BIND_CODE_TTL_SECONDS, `expiresInSeconds must be <= ${MAX_BIND_CODE_TTL_SECONDS}`)
    .default(DEFAULT_BIND_CODE_TTL_SECONDS),
});

const previewBindCodeSchema = z.object({
  bindCode: z.string().min(1),
});

/**
 * Resolve the actor for bind-code creation.
 *
 * - Owner user token: can target any same-space member.
 * - Child user token: can only target themselves.
 * - canManageSpace device: can target any same-space member.
 * - canCreateInvite device: can only target its own user.
 * - no auth: 401.
 */
function resolveBindCodeActor(request: { user?: { role: string; userId: string; ownerUserId: string }; device?: { deviceId: string; userId: string; ownerUserId: string; permissions: { canManageSpace: boolean; canCreateInvite: boolean } } }) {
  if (request.user) {
    return {
      ownerUserId: request.user.ownerUserId,
      actorUserId: request.user.userId,
      actorDeviceId: undefined as string | undefined,
      isOwner: request.user.role === "owner",
      canManageOtherUsers: request.user.role === "owner",
    };
  }

  if (request.device) {
    const perms = request.device.permissions;
    if (!perms.canManageSpace && !perms.canCreateInvite) {
      throw new AppError(
        "FORBIDDEN",
        "Only owner users or devices with invite/manage permission can create bind codes",
        403
      );
    }
    return {
      ownerUserId: request.device.ownerUserId,
      actorUserId: request.device.userId,
      actorDeviceId: request.device.deviceId,
      isOwner: false,
      canManageOtherUsers: perms.canManageSpace,
    };
  }

  throw new AppError("UNAUTHORIZED", "Authentication required", 401);
}

export async function bindCodeRoutes(app: FastifyInstance): Promise<void> {
  // Public preview endpoint that lets a registering device confirm the
  // target user before consuming the code. Does not consume the code.
  app.post("/bind-codes/preview", async (request, reply) => {
    const body = previewBindCodeSchema.parse(request.body);
    // Trim but preserve case (matches device/register behaviour).
    const rawCode = body.bindCode.trim();
    const codeHash = hashToken(rawCode);

    const bindCode = await prisma.bindCode.findUnique({ where: { codeHash } });
    if (!bindCode || bindCode.usedAt || bindCode.expiresAt < new Date()) {
      throw new AppError("INVALID_BIND_CODE", "Bind code is invalid, expired, or already used", 400);
    }
    if (bindCode.purpose !== "bind_device") {
      throw new AppError("INVALID_BIND_CODE", "Bind code is not for device registration", 400);
    }

    const targetUser = await prisma.user.findFirst({
      where: { id: bindCode.targetUserId, ownerUserId: bindCode.ownerUserId, disabledAt: null },
    });
    if (!targetUser) {
      // Don't leak the existence of disabled users; treat as invalid code.
      throw new AppError("INVALID_BIND_CODE", "Bind code is invalid, expired, or already used", 400);
    }

    const owner = await prisma.user.findUnique({
      where: { id: bindCode.ownerUserId },
      select: { displayName: true },
    });

    const spaceDisplayName = owner?.displayName?.trim() || "StudyShot 空间";

    reply.send({
      success: true,
      data: {
        expiresAt: bindCode.expiresAt.toISOString(),
        space: {
          ownerUserId: bindCode.ownerUserId,
          displayName: spaceDisplayName,
        },
        targetUser: {
          id: targetUser.id,
          role: targetUser.role,
          displayName: targetUser.displayName,
        },
      },
    });
  });

  app.post("/bind-codes", async (request, reply) => {
    const actor = resolveBindCodeActor(request);
    const body = createBindCodeSchema.parse(request.body);

    // `invite_child_user` codes can still be issued by owner tokens for
    // forward compatibility, but only `bind_device` codes are consumed by
    // /devices/register. The unused invite flow is intentionally left
    // unimplemented per spec §22.

    let targetUserId = body.userId ?? actor.actorUserId;

    if (!actor.canManageOtherUsers && targetUserId !== actor.actorUserId) {
      throw new AppError(
        "FORBIDDEN",
        "This caller can only create bind codes for its own user",
        403
      );
    }

    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId, ownerUserId: actor.ownerUserId },
    });
    if (!targetUser) {
      throw new AppError("NOT_FOUND", "Target user not found in this space", 404);
    }
    if (targetUser.disabledAt) {
      throw new AppError("TARGET_USER_DISABLED", "Target user is disabled", 409);
    }

    const rawCode = generateRandomToken(24);
    const codeHash = hashToken(rawCode);
    const expiresAt = new Date(Date.now() + body.expiresInSeconds * 1000);

    const bindCode = await prisma.bindCode.create({
      data: {
        ownerUserId: actor.ownerUserId,
        createdByUserId: actor.actorUserId,
        targetUserId: targetUser.id,
        codeHash,
        purpose: body.purpose,
        targetRole: targetUser.role,
        expiresAt,
      },
    });

    await logAudit({
      ownerUserId: actor.ownerUserId,
      actorUserId: actor.actorUserId,
      actorDeviceId: actor.actorDeviceId,
      action: "bind_code.created",
      targetType: "bind_code",
      targetId: bindCode.id,
      metadata: {
        purpose: body.purpose,
        targetUserId: targetUser.id,
        targetRole: targetUser.role,
        expiresInSeconds: body.expiresInSeconds,
      },
    });

    reply.status(201).send({
      success: true,
      data: {
        bindCode: rawCode,
        expiresAt: expiresAt.toISOString(),
        targetUser: {
          id: targetUser.id,
          role: targetUser.role,
          displayName: targetUser.displayName,
        },
      },
    });
  });
}
