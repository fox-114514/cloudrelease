import type { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { z } from "zod";
import { AppError } from "../errors.js";
import { verifyPassword } from "../lib/crypto.js";
import { signUserToken } from "../lib/jwt.js";
import { logger } from "../logger.js";
import { prisma } from "../lib/prisma.js";

const loginBodySchema = z.object({
  login: z.string().trim().min(1).max(190),
  password: z.string().min(1).max(1024),
});

// A dummy bcrypt hash of a random value, precomputed at module load. When the
// login lookup misses (no such user), we still run a real bcrypt.compare so
// the response timing doesn't trivially leak user existence. bcrypt rounds=12
// means ~250ms per compare, which is enough to flatten the timing difference.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(
  Math.random().toString(36) + Date.now().toString(36),
  12,
);

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Per-route limiter for /auth/login. Default is 5 attempts per minute per
  // IP. Configurable via env LOGIN_RATE_LIMIT_MAX / LOGIN_RATE_LIMIT_WINDOW.
  const max = Number.parseInt(process.env.LOGIN_RATE_LIMIT_MAX ?? "5", 10) || 5;
  const timeWindow = process.env.LOGIN_RATE_LIMIT_WINDOW ?? "1 minute";

  app.post(
    "/auth/login",
    {
      config: {
        // @fastify/rate-limit picks this up.
        rateLimit: { max, timeWindow },
      },
    },
    async (request, reply) => {
      const body = loginBodySchema.parse(request.body);
      // Always normalise to a string for log correlation; never log the raw
      // password, the JWT, or the full request body.
      const ip = request.ip;

      const user = await prisma.user.findUnique({
        where: { emailOrLogin: body.login },
      });

      if (!user || !user.passwordHash) {
        // Burn time on a real bcrypt compare so user-existence probing can't
        // be done via response timing. The result is discarded.
        await verifyPassword(body.password, DUMMY_BCRYPT_HASH);
        logger.warn("login.failed", { reason: "no_user_or_no_hash", login: body.login, ip });
        throw new AppError("INVALID_CREDENTIALS", "Invalid login or password", 401);
      }

      if (user.disabledAt) {
        logger.warn("login.failed", { reason: "user_disabled", userId: user.id, ip });
        throw new AppError("USER_DISABLED", "User account is disabled", 403);
      }

      const valid = await verifyPassword(body.password, user.passwordHash);
      if (!valid) {
        logger.warn("login.failed", { reason: "wrong_password", userId: user.id, ip });
        throw new AppError("INVALID_CREDENTIALS", "Invalid login or password", 401);
      }

      const accessToken = signUserToken({
        userId: user.id,
        ownerUserId: user.ownerUserId,
        role: user.role,
      });

      logger.info("login.success", { userId: user.id, role: user.role, ip });

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
    },
  );
}
