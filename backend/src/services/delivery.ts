import type { Image, Device, DevicePermission, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

type DbClient = Prisma.TransactionClient | typeof prisma;

export async function generateDeliveries(
  image: Image,
  tx?: Prisma.TransactionClient
): Promise<string[]> {
  const db = tx ?? prisma;

  const targetDevices = await db.device.findMany({
    where: {
      ownerUserId: image.ownerUserId,
      revokedAt: null,
      NOT: { id: image.uploadDeviceId },
      permissions: {
        canAutoReceive: true,
      },
    },
    include: { permissions: true },
  });

  const deliveryIds: string[] = [];

  for (const target of targetDevices) {
    if (!(await shouldReceiveFrom(db, target, image.uploadDeviceId, image.uploadUserId))) {
      continue;
    }

    const delivery = await db.delivery.create({
      data: {
        imageId: image.id,
        targetDeviceId: target.id,
        status: "pending",
      },
    });
    deliveryIds.push(delivery.id);
  }

  return deliveryIds;
}

async function shouldReceiveFrom(
  db: DbClient,
  target: Device & { permissions: DevicePermission | null },
  sourceDeviceId: string,
  sourceUserId: string
): Promise<boolean> {
  const scope = target.permissions?.autoReceiveScope ?? "disabled";

  switch (scope) {
    case "disabled":
      return false;
    case "all_authorized_sources":
      return true;
    case "same_user_only":
      return target.userId === sourceUserId;
    case "selected_devices":
      {
        const rule = await db.receiveSourceRule.findUnique({
          where: {
            targetDeviceId_sourceDeviceId: {
              targetDeviceId: target.id,
              sourceDeviceId,
            },
          },
        });
        return rule?.enabled ?? false;
      }
    default:
      return false;
  }
}
