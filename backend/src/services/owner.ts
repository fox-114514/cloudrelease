import { config } from "../config.js";
import { hashPassword } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../logger.js";

export async function ensureInitialOwner(): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { emailOrLogin: config.INITIAL_OWNER_LOGIN },
  });

  if (existing) {
    logger.info("Initial owner already exists, not overwriting password", {
      ownerLogin: config.INITIAL_OWNER_LOGIN,
    });
    return;
  }

  const owner = await prisma.user.create({
    data: {
      ownerUserId: "self",
      role: "owner",
      emailOrLogin: config.INITIAL_OWNER_LOGIN,
      passwordHash: await hashPassword(config.INITIAL_OWNER_PASSWORD),
      displayName: "Owner",
    },
  });

  // Self-reference: the owner user owns its own space.
  await prisma.user.update({
    where: { id: owner.id },
    data: { ownerUserId: owner.id },
  });

  logger.info("Initial owner created", { ownerLogin: config.INITIAL_OWNER_LOGIN });
}
