import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors.js";
import { requireDeviceAuth } from "../services/authorization.js";
import {
  getClientRelease,
  isChannelAllowedForPlatform,
  isUpdateChannel,
  openClientPackage,
  type UpdateChannel,
} from "../services/client-update.js";

async function resolveChannel(request: FastifyRequest, rawChannel: unknown) {
  requireDeviceAuth(request);
  if (!isUpdateChannel(rawChannel)) {
    throw new AppError("INVALID_UPDATE_CHANNEL", "Unknown update channel", 404);
  }
  const platform = request.device?.platform;
  if (!platform || !isChannelAllowedForPlatform(rawChannel, platform)) {
    throw new AppError("UPDATE_CHANNEL_FORBIDDEN", "Update channel does not match this device", 403);
  }
  return rawChannel;
}

async function sendPackage(channel: UpdateChannel, reply: FastifyReply) {
  const release = await getClientRelease(channel);
  if (!release) throw new AppError("UPDATE_NOT_AVAILABLE", `${channel} update is not available`, 404);
  reply
    .header("Content-Type", contentTypeFor(release.fileName))
    .header("Content-Length", release.fileSize)
    .header("Content-Disposition", `attachment; filename="${release.fileName}"`)
    .header("Cache-Control", "private, no-store");
  return reply.send(openClientPackage(channel));
}

export async function updateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/updates/android", async (request) => {
    await resolveChannel(request, "android");
    const release = await getClientRelease("android");
    return { success: true, data: { available: release !== null, release } };
  });

  app.get("/updates/android/apk", async (request, reply) => {
    await resolveChannel(request, "android");
    return sendPackage("android", reply);
  });

  app.get<{ Params: { channel: string } }>("/updates/:channel", async (request) => {
    const channel = await resolveChannel(request, request.params.channel);
    const release = await getClientRelease(channel);
    return { success: true, data: { available: release !== null, release } };
  });

  app.get<{ Params: { channel: string } }>("/updates/:channel/package", async (request, reply) => {
    const channel = await resolveChannel(request, request.params.channel);
    return sendPackage(channel, reply);
  });
}

function contentTypeFor(fileName: string): string {
  if (fileName.toLowerCase().endsWith(".apk")) return "application/vnd.android.package-archive";
  if (fileName.toLowerCase().endsWith(".deb")) return "application/vnd.debian.binary-package";
  return "application/octet-stream";
}
