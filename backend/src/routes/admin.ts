import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { hashPassword } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { logAudit } from "../services/audit.js";

function getManageContext(request: FastifyRequest): {
  ownerUserId: string;
  actorUserId: string;
  actorDeviceId?: string;
} {
  if (request.user?.role === "owner") {
    return {
      ownerUserId: request.user.ownerUserId,
      actorUserId: request.user.userId,
    };
  }

  if (request.device?.permissions.canManageSpace) {
    return {
      ownerUserId: request.device.ownerUserId,
      actorUserId: request.device.userId,
      actorDeviceId: request.device.deviceId,
    };
  }

  if (request.user || request.device) {
    throw new AppError("FORBIDDEN", "Manage permission required", 403);
  }

  throw new AppError("UNAUTHORIZED", "Authentication required", 401);
}

const createChildUserSchema = z.object({
  login: z.string().trim().min(1).max(190),
  password: z.string().min(8),
  displayName: z.string().trim().min(1).max(100).optional(),
});

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  disabled: z.boolean().optional(),
});

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const addGroupMemberSchema = z.object({
  userId: z.string().uuid(),
});

const listAuditQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users", async (request, reply) => {
    const auth = getManageContext(request);

    const users = await prisma.user.findMany({
      where: { ownerUserId: auth.ownerUserId },
      include: { devices: true },
      orderBy: { createdAt: "asc" },
    });

    reply.send({
      success: true,
      data: {
        users: users.map((user) => ({
          id: user.id,
          ownerUserId: user.ownerUserId,
          role: user.role,
          displayName: user.displayName,
          emailOrLogin: user.emailOrLogin,
          disabledAt: user.disabledAt?.toISOString(),
          createdAt: user.createdAt.toISOString(),
          deviceCount: user.devices.length,
        })),
      },
    });
  });

  app.post("/users", async (request, reply) => {
    const auth = getManageContext(request);
    const body = createChildUserSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { emailOrLogin: body.login } });
    if (existing) {
      throw new AppError("LOGIN_EXISTS", "Login already exists", 409);
    }

    const user = await prisma.user.create({
      data: {
        ownerUserId: auth.ownerUserId,
        role: "child",
        emailOrLogin: body.login,
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName ?? "Child",
      },
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.actorUserId,
      actorDeviceId: auth.actorDeviceId,
      action: "user.created",
      targetType: "user",
      targetId: user.id,
      metadata: { role: user.role },
    });

    reply.status(201).send({
      success: true,
      data: {
        user: {
          id: user.id,
          ownerUserId: user.ownerUserId,
          role: user.role,
          displayName: user.displayName,
          emailOrLogin: user.emailOrLogin,
          createdAt: user.createdAt.toISOString(),
        },
      },
    });
  });

  app.patch("/users/:userId", async (request, reply) => {
    const auth = getManageContext(request);
    const { userId } = request.params as { userId: string };
    const body = updateUserSchema.parse(request.body);

    const user = await prisma.user.findFirst({
      where: { id: userId, ownerUserId: auth.ownerUserId },
    });
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found", 404);
    }
    if (user.role === "owner" && body.disabled === true) {
      throw new AppError("FORBIDDEN", "Owner user cannot be disabled", 403);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        displayName: body.displayName,
        disabledAt: body.disabled === undefined ? user.disabledAt : body.disabled ? new Date() : null,
      },
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.actorUserId,
      actorDeviceId: auth.actorDeviceId,
      action: "user.updated",
      targetType: "user",
      targetId: userId,
      metadata: body,
    });

    reply.send({
      success: true,
      data: {
        user: {
          id: updated.id,
          role: updated.role,
          displayName: updated.displayName,
          disabledAt: updated.disabledAt?.toISOString(),
        },
      },
    });
  });

  app.get("/groups", async (request, reply) => {
    const auth = getManageContext(request);

    const groups = await prisma.group.findMany({
      where: { ownerUserId: auth.ownerUserId },
      include: { members: true },
      orderBy: { createdAt: "asc" },
    });

    reply.send({
      success: true,
      data: {
        groups: groups.map((group) => ({
          id: group.id,
          name: group.name,
          createdAt: group.createdAt.toISOString(),
          memberUserIds: group.members.map((member) => member.userId),
        })),
      },
    });
  });

  app.post("/groups", async (request, reply) => {
    const auth = getManageContext(request);
    const body = createGroupSchema.parse(request.body);

    const group = await prisma.group.create({
      data: {
        ownerUserId: auth.ownerUserId,
        name: body.name,
      },
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.actorUserId,
      actorDeviceId: auth.actorDeviceId,
      action: "group.created",
      targetType: "group",
      targetId: group.id,
      metadata: { name: group.name },
    });

    reply.status(201).send({
      success: true,
      data: {
        group: {
          id: group.id,
          name: group.name,
          createdAt: group.createdAt.toISOString(),
        },
      },
    });
  });

  app.post("/groups/:groupId/members", async (request, reply) => {
    const auth = getManageContext(request);
    const { groupId } = request.params as { groupId: string };
    const body = addGroupMemberSchema.parse(request.body);

    const group = await prisma.group.findFirst({
      where: { id: groupId, ownerUserId: auth.ownerUserId },
    });
    const user = await prisma.user.findFirst({
      where: { id: body.userId, ownerUserId: auth.ownerUserId },
    });

    if (!group || !user) {
      throw new AppError("NOT_FOUND", "Group or user not found", 404);
    }

    const member = await prisma.groupMember.upsert({
      where: {
        groupId_userId: {
          groupId,
          userId: body.userId,
        },
      },
      create: {
        groupId,
        userId: body.userId,
      },
      update: {},
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.actorUserId,
      actorDeviceId: auth.actorDeviceId,
      action: "group.member_added",
      targetType: "group",
      targetId: groupId,
      metadata: { userId: body.userId },
    });

    reply.status(201).send({
      success: true,
      data: {
        member: {
          groupId: member.groupId,
          userId: member.userId,
          createdAt: member.createdAt.toISOString(),
        },
      },
    });
  });

  app.delete("/groups/:groupId/members/:userId", async (request, reply) => {
    const auth = getManageContext(request);
    const { groupId, userId } = request.params as { groupId: string; userId: string };

    const group = await prisma.group.findFirst({
      where: { id: groupId, ownerUserId: auth.ownerUserId },
    });
    if (!group) {
      throw new AppError("NOT_FOUND", "Group not found", 404);
    }

    await prisma.groupMember.deleteMany({
      where: { groupId, userId },
    });

    await logAudit({
      ownerUserId: auth.ownerUserId,
      actorUserId: auth.actorUserId,
      actorDeviceId: auth.actorDeviceId,
      action: "group.member_removed",
      targetType: "group",
      targetId: groupId,
      metadata: { userId },
    });

    reply.send({ success: true, data: { removed: true } });
  });

  app.get("/audit-logs", async (request, reply) => {
    const auth = getManageContext(request);
    const query = listAuditQuerySchema.parse(request.query);

    const logs = await prisma.auditLog.findMany({
      where: { ownerUserId: auth.ownerUserId },
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });

    reply.send({
      success: true,
      data: {
        logs: logs.map((log) => ({
          id: log.id,
          actorUserId: log.actorUserId,
          actorDeviceId: log.actorDeviceId,
          action: log.action,
          targetType: log.targetType,
          targetId: log.targetId,
          metadata: log.metadataJson,
          createdAt: log.createdAt.toISOString(),
        })),
      },
    });
  });
}
