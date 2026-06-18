import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { errorHandler } from "./errors.js";
import { optionalDeviceAuth } from "./plugins/device-auth.js";
import { optionalUserAuth } from "./plugins/auth.js";
import { wsPlugin } from "./plugins/ws.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { bindCodeRoutes } from "./routes/bind-codes.js";
import { deliveryRoutes } from "./routes/deliveries.js";
import { deviceRoutes } from "./routes/devices.js";
import { healthRoutes } from "./routes/health.js";
import { imageRoutes } from "./routes/images.js";


export async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    logger: false,
    bodyLimit: config.MAX_IMAGE_SIZE_MB * 1024 * 1024,
  });

  app.setErrorHandler(errorHandler);

  await app.register(rateLimit, {
    max: 1000,
    timeWindow: "1 minute",
  });

  if (config.CORS_ALLOWED_ORIGINS) {
    await app.register(cors, {
      origin: config.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()),
    });
  }

  await app.register(optionalUserAuth);
  await app.register(optionalDeviceAuth);
  await app.register(multipart, {
    limits: {
      fileSize: config.MAX_IMAGE_SIZE_MB * 1024 * 1024,
      files: 1,
    },
  });
  await app.register(websocket);

  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(adminRoutes, { prefix: "/api/v1" });
  await app.register(authRoutes, { prefix: "/api/v1" });
  await app.register(bindCodeRoutes, { prefix: "/api/v1" });
  await app.register(deviceRoutes, { prefix: "/api/v1" });
  await app.register(imageRoutes, { prefix: "/api/v1" });
  await app.register(deliveryRoutes, { prefix: "/api/v1" });
  await app.register(wsPlugin, { prefix: "/api/v1" });

  return app;
}
