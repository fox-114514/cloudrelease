import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { verifyUserToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

export interface UserAuth {
  userId: string;
  ownerUserId: string;
  role: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: UserAuth;
  }
}

export const optionalUserAuth = fp(async (app: FastifyInstance) => {
  app.decorateRequest("user", undefined);

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return;
    }

    const token = authHeader.slice(7);
    // Device tokens are base64url random strings without dots. Only process JWTs here.
    if (!token.includes(".")) {
      return;
    }

    try {
      const payload = verifyUserToken(token);
      if (payload.type !== "user") {
        reply.status(401).send({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Invalid token type" },
        });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user || user.disabledAt) {
        reply.status(401).send({
          success: false,
          error: { code: "UNAUTHORIZED", message: "User disabled or not found" },
        });
        return;
      }

      request.user = {
        userId: user.id,
        ownerUserId: user.ownerUserId,
        role: user.role,
      };
    } catch {
      reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
      });
    }
  });
});
