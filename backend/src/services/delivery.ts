import type { Image, Device, DevicePermission, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export async function generateDeliveries(
  image: Image,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const db = tx ?? prisma;

  const targetDevices = await db.device.findMany({
    where: {
      ownerUserId: image.ownerUserId,
      revokedAt: null,
      user: {
        disabledAt: null,
      },
      NOT: { id: image.uploadDeviceId },
      permissions: {
        canAutoReceive: true,
      },
    },
    include: { permissions: true, user: true },
  });

  const selectedTargets = targetDevices.filter(
    (target) => target.permissions?.autoReceiveScope === "selected_devices"
  );
  const selectedRules = selectedTargets.length > 0
    ? await db.receiveSourceRule.findMany({
        where: {
          sourceDeviceId: image.uploadDeviceId,
          targetDeviceId: { in: selectedTargets.map((target) => target.id) },
          enabled: true,
        },
        select: { targetDeviceId: true },
      })
    : [];
  const selectedTargetIds = new Set(selectedRules.map((rule) => rule.targetDeviceId));

  const deliveryTargets = targetDevices.filter((target) =>
    shouldReceiveFrom(target, image.uploadUserId, selectedTargetIds)
  );

  if (deliveryTargets.length === 0) {
    return 0;
  }

  const created = await db.delivery.createMany({
    data: deliveryTargets.map((target) => ({
      imageId: image.id,
      targetDeviceId: target.id,
      status: "pending",
    })),
    // The schema enforces @@unique([imageId, targetDeviceId]) as a
    // belt-and-suspenders guard against duplicate deliveries even if a
    // future retry path re-enters this function for an existing image.
    // Today there is exactly one caller (POST /images, inside the same
    // transaction that created the image), so inserts are always fresh;
    // skipDuplicates only matters once that invariant ever changes.
    skipDuplicates: true,
  });

  return created.count;
}

function shouldReceiveFrom(
  target: Device & { permissions: DevicePermission | null },
  sourceUserId: string,
  selectedTargetIds: Set<string>
): boolean {
  const scope = target.permissions?.autoReceiveScope ?? "disabled";

  switch (scope) {
    case "disabled":
      return false;
    case "all_authorized_sources":
      return true;
    case "same_user_only":
      return target.userId === sourceUserId;
    case "selected_devices":
      return selectedTargetIds.has(target.id);
    default:
      return false;
  }
}
