import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../errors.js";
import { prisma } from "../lib/prisma.js";

const ackBodySchema = z.object({
  status: z.enum(["downloaded", "failed", "skipped"]),
  errorMessage: z.string().max(1000).optional(),
  localPathHint: z.string().max(500).optional(),
});

export async function deliveryRoutes(app: FastifyInstance): Promise<void> {
  // Get pending deliveries for the current device.
  app.get("/deliveries/pending", async (request, reply) => {
    if (!request.device) {
      throw new AppError("UNAUTHORIZED", "Device authentication required", 401);
    }

    const where: Prisma.DeliveryWhereInput = {
      targetDeviceId: request.device.deviceId,
      status: { in: ["pending", "notified"] },
      image: {
        deletedAt: null,
        expiresAt: { gt: new Date() },
      },
    };
    const [deliveries, totalPending] = await prisma.$transaction([
      prisma.delivery.findMany({
        where,
        include: { image: { include: { uploadDevice: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
      }),
      prisma.delivery.count({ where }),
    ]);

    reply.send({
      success: true,
      data: {
        totalPending,
        hasMore: totalPending > deliveries.length,
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
          createdAt: d.image.createdAt.toISOString(),
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

    if (!["pending", "notified"].includes(delivery.status)) {
      if (delivery.status === body.status) {
        return reply.send({
          success: true,
          data: { deliveryId: delivery.id, status: delivery.status },
        });
      }
      throw new AppError(
        "DELIVERY_ALREADY_ACKED",
        `Delivery is already ${delivery.status}`,
        409,
      );
    }

    const transition = await prisma.delivery.updateMany({
      where: { id: deliveryId, status: { in: ["pending", "notified"] } },
      data: {
        status: body.status,
        failureReason: body.status === "failed" ? body.errorMessage : null,
        downloadedAt: body.status === "downloaded" ? new Date() : undefined,
      },
    });
    const updated = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    if (transition.count === 0 && updated.status !== body.status) {
      throw new AppError(
        "DELIVERY_ALREADY_ACKED",
        `Delivery is already ${updated.status}`,
        409,
      );
    }

    reply.send({
      success: true,
      data: {
        deliveryId: updated.id,
        status: updated.status,
      },
    });
  });
}
