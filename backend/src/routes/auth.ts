import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { verifyPassword } from "../lib/crypto.js";
import { signUserToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

const loginBodySchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/login", async (request, reply) => {
    const body = loginBodySchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { emailOrLogin: body.login },
    });

    if (!user || !user.passwordHash) {
      throw new AppError("INVALID_CREDENTIALS", "Invalid login or password", 401);
    }

    if (user.disabledAt) {
      throw new AppError("USER_DISABLED", "User account is disabled", 403);
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      throw new AppError("INVALID_CREDENTIALS", "Invalid login or password", 401);
    }

    const accessToken = signUserToken({
      userId: user.id,
      ownerUserId: user.ownerUserId,
      role: user.role,
    });

    reply.status(200).send({
      success: true,
      data: {
        accessToken,
        user: {
          id: user.id,
          ownerUserId: user.ownerUserId,
          role: user.role,
          displayName: user.displayName,
          emailOrLogin: user.emailOrLogin,
        },
      },
    });
  });
}
