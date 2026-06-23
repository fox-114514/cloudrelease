import { buildApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { prisma } from "./lib/prisma.js";
import { startCleanupTask } from "./services/cleanup.js";
import { ensureInitialOwner } from "./services/owner.js";

async function start(): Promise<void> {
  const app = await buildApp();

  let stopping = false;
  const stopCleanup = startCleanupTask();

  // Graceful shutdown on SIGTERM/SIGINT. We stop accepting new requests,
  // close the HTTP server (which @fastify/websocket wires into its
  // close() to terminate WS connections), then clean up the timer and
  // Prisma. The whole sequence has a hard upper bound so a misbehaving
  // keepalive can't block container runtime shutdown indefinitely.
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("Shutdown triggered", { signal });
    stopCleanup();
    // app.close() also closes the underlying socket server and the WS
    // plugin's connections, per @fastify/websocket's hook registration.
    const forceExit = setTimeout(() => {
      logger.error("Shutdown timed out, forcing exit", { signal });
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    try {
      await app.close();
    } catch (err) {
      logger.error("Error during app.close()", { error: String(err) });
    }
    try {
      await prisma.$disconnect();
    } catch (err) {
      logger.error("Error disconnecting Prisma", { error: String(err) });
    }
    clearTimeout(forceExit);
    logger.info("Shutdown complete", { signal });
    process.exit(0);
  };
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });

  try {
    await ensureInitialOwner();
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info(`Server listening on ${config.HOST}:${config.PORT}`, {
      nodeEnv: config.NODE_ENV,
      publicBaseUrl: config.PUBLIC_BASE_URL,
    });
  } catch (err) {
    logger.error("Failed to start server", { error: String(err) });
    stopCleanup();
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  }
}

start();
