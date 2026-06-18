import { prisma } from "../lib/prisma.js";

beforeEach(async () => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (process.env.NODE_ENV !== "test" || !databaseUrl.includes("_test")) {
    throw new Error(
      "Refusing to reset database outside the test environment. NODE_ENV must be test and DATABASE_URL must point to a test database."
    );
  }

  // Delete in an order that respects foreign keys.
  await prisma.auditLog.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.image.deleteMany();
  await prisma.receiveSourceRule.deleteMany();
  await prisma.devicePermission.deleteMany();
  await prisma.device.deleteMany();
  await prisma.bindCode.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
