import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { generateRandomToken, hashToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { logAudit } from "../services/audit.js";

const createBindCodeSchema = z.object({
  purpose: z.enum(["bind_device", "invite_child_user"]).default("bind_device"),
  userId: z.string().uuid().optional(),
  deviceNameHint: z.string().optional(),
  expiresInSeconds: z.number().int().positive().default(600),
});

export async function bindCodeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/bind-codes", async (request, reply) => {
    // Authentication: either an owner user token, or a device token with invite/manage permission.
    // Child users cannot use a plain user token to create bind codes; they must act through a
    // specific permitted device so that permissions stay device-bound.
    const isOwnerUser = request.user?.role === "owner";
    const deviceHasPermission =
      request.device &&
      (request.device.permissions.canCreateInvite || request.device.permissions.canManageSpace);

    if (!isOwnerUser && !deviceHasPermission) {
      throw new AppError(
        "FORBIDDEN",
        "Only owner users or devices with invite/manage permission can create bind codes",
        403
      );
    }

    // The actor is whichever identity is making the request.
    const actorUserId = request.user?.userId ?? request.device!.userId;
    const actorDeviceId = request.device?.deviceId;
    const ownerUserId = request.user?.ownerUserId ?? request.device!.ownerUserId;

    const body = createBindCodeSchema.parse(request.body);
    let targetUserId = body.userId ?? actorUserId;

    // Permission boundary for choosing the target user:
    // - Owner user token: can create bind codes for any user in the space.
    // - Device with canManageSpace: can create bind codes for any user in the space.
    // - Device with only canCreateInvite: can only create bind codes for itself.
    const canManageOtherUsers = isOwnerUser || request.device?.permissions.canManageSpace;
    if (!canManageOtherUsers && targetUserId !== actorUserId) {
      throw new AppError(
        "FORBIDDEN",
        "This device can only create bind codes for its own user",
        403
      );
    }

    // Target user must belong to the same owner space.
    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId, ownerUserId },
    });

    if (!targetUser) {
      throw new AppError("NOT_FOUND", "Target user not found", 404);
    }

    const rawCode = generateRandomToken(24);
    const codeHash = hashToken(rawCode);
    const expiresAt = new Date(Date.now() + body.expiresInSeconds * 1000);

    const bindCode = await prisma.bindCode.create({
      data: {
        ownerUserId,
        createdByUserId: actorUserId,
        targetUserId: targetUser.id,
        codeHash,
        purpose: body.purpose,
        targetRole: targetUser.role,
        expiresAt,
      },
    });

    await logAudit({
      ownerUserId,
      actorUserId,
      actorDeviceId,
      action: "bind_code.created",
      targetType: "bind_code",
      targetId: bindCode.id,
      metadata: {
        purpose: body.purpose,
        targetUserId: targetUser.id,
        deviceNameHint: body.deviceNameHint,
        expiresInSeconds: body.expiresInSeconds,
      },
    });

    reply.status(201).send({
      success: true,
      data: {
        bindCode: rawCode,
        expiresAt: expiresAt.toISOString(),
      },
    });
  });
}
