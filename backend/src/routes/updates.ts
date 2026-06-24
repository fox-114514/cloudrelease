import type { FastifyInstance } from "fastify";
import { AppError } from "../errors.js";
import { requireDeviceAuth } from "../services/authorization.js";
import { getAndroidRelease, openAndroidApk } from "../services/android-update.js";

export async function updateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/updates/android", async (request) => {
    requireDeviceAuth(request);
    const release = await getAndroidRelease();
    return { success: true, data: { available: release !== null, release } };
  });

  app.get("/updates/android/apk", async (request, reply) => {
    requireDeviceAuth(request);
    const release = await getAndroidRelease();
    if (!release) {
      throw new AppError("UPDATE_NOT_AVAILABLE", "Android update is not available", 404);
    }
    reply
      .header("Content-Type", "application/vnd.android.package-archive")
      .header("Content-Length", release.fileSize)
      .header("Content-Disposition", `attachment; filename="${release.fileName}"`)
      .header("Cache-Control", "private, no-store");
    return reply.send(openAndroidApk());
  });
}
