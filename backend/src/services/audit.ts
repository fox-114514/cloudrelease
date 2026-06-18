import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export async function logAudit(opts: {
  ownerUserId: string;
  actorUserId?: string;
  actorDeviceId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      ownerUserId: opts.ownerUserId,
      actorUserId: opts.actorUserId,
      actorDeviceId: opts.actorDeviceId,
      action: opts.action,
      targetType: opts.targetType,
      targetId: opts.targetId,
      metadataJson: (opts.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
