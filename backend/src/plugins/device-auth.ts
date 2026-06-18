import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { hashToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";

export interface DeviceAuth {
  deviceId: string;
  userId: string;
  ownerUserId: string;
  role: string;
  permissions: {
    canAutoUpload: boolean;
    canManualUpload: boolean;
    canAutoReceive: boolean;
    canManualDownload: boolean;
    canManageSpace: boolean;
    canCreateInvite: boolean;
    autoUploadScope: string;
    autoReceiveScope: string;
  };
}

declare module "fastify" {
  interface FastifyRequest {
    device?: DeviceAuth;
  }
}

export const optionalDeviceAuth = fp(async (app: FastifyInstance) => {
  app.decorateRequest("device", undefined);

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return;
    }

    const token = authHeader.slice(7);
    // User tokens are JWTs (contain dots). Device tokens are base64url random strings without dots.
    // Skip JWTs so user auth can handle them without conflict.
    if (token.includes(".")) {
      return;
    }

    const tokenHash = hashToken(token);

    const device = await prisma.device.findUnique({
      where: { deviceTokenHash: tokenHash },
      include: { permissions: true, user: true },
    });

    if (!device) {
      reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid device token" },
      });
      return;
    }

    if (device.revokedAt) {
      reply.status(401).send({
        success: false,
        error: { code: "DEVICE_REVOKED", message: "Device has been revoked" },
      });
      return;
    }

    if (device.user.disabledAt) {
      reply.status(403).send({
        success: false,
        error: { code: "USER_DISABLED", message: "User account is disabled" },
      });
      return;
    }

    await prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    request.device = {
      deviceId: device.id,
      userId: device.userId,
      ownerUserId: device.ownerUserId,
      role: device.user.role,
      permissions: {
        canAutoUpload: device.permissions?.canAutoUpload ?? false,
        canManualUpload: device.permissions?.canManualUpload ?? false,
        canAutoReceive: device.permissions?.canAutoReceive ?? false,
        canManualDownload: device.permissions?.canManualDownload ?? false,
        canManageSpace: device.permissions?.canManageSpace ?? false,
        canCreateInvite: device.permissions?.canCreateInvite ?? false,
        autoUploadScope: device.permissions?.autoUploadScope ?? "screenshot_only",
        autoReceiveScope: device.permissions?.autoReceiveScope ?? "disabled",
      },
    };
  });
});
