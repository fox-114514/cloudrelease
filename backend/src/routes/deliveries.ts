import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { prisma } from "../lib/prisma.js";

const ackBodySchema = z.object({
  status: z.enum(["downloaded", "failed", "skipped"]),
  errorMessage: z.string().optional(),
  localPathHint: z.string().optional(),
});

export async function deliveryRoutes(app: FastifyInstance): Promise<void> {
  // Get pending deliveries for the current device.
  app.get("/deliveries/pending", async (request, reply) => {
    if (!request.device) {
      throw new AppError("UNAUTHORIZED", "Device authentication required", 401);
    }

    const deliveries = await prisma.delivery.findMany({
      where: {
        targetDeviceId: request.device.deviceId,
        status: { in: ["pending", "notified"] },
        image: {
          deletedAt: null,
          expiresAt: { gt: new Date() },
        },
      },
      include: { image: { include: { uploadDevice: true } } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    reply.send({
      success: true,
      data: {
        deliveries: deliveries.map((d) => ({
          deliveryId: d.id,
          image: {
            id: d.image.id,
            mimeType: d.image.mimeType,
            fileSize: d.image.fileSize,
            width: d.image.width,
            height: d.image.height,
            sha256: d.image.sha256,
          },
          source: {
            uploadUserId: d.image.uploadUserId,
            uploadDeviceId: d.image.uploadDeviceId,
            uploadDeviceName: d.image.uploadDevice.name,
          },
          createdAt: d.createdAt.toISOString(),
          expiresAt: d.image.expiresAt.toISOString(),
        })),
      },
    });
  });

  // ACK a delivery.
  app.post("/deliveries/:deliveryId/ack", async (request, reply) => {
    if (!request.device) {
      throw new AppError("UNAUTHORIZED", "Device authentication required", 401);
    }

    const { deliveryId } = request.params as { deliveryId: string };
    const body = ackBodySchema.parse(request.body);

    const delivery = await prisma.delivery.findFirst({
      where: {
        id: deliveryId,
        targetDeviceId: request.device.deviceId,
      },
    });

    if (!delivery) {
      throw new AppError("NOT_FOUND", "Delivery not found", 404);
    }

    const updated = await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: body.status,
        failureReason: body.errorMessage,
        downloadedAt: body.status === "downloaded" ? new Date() : delivery.downloadedAt,
      },
    });

    reply.send({
      success: true,
      data: {
        deliveryId: updated.id,
        status: updated.status,
      },
    });
  });
}
