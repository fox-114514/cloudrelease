import { buildApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { startCleanupTask } from "./services/cleanup.js";
import { ensureInitialOwner } from "./services/owner.js";

async function start(): Promise<void> {
  const app = await buildApp();

  try {
    await ensureInitialOwner();
    startCleanupTask();
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info(`Server listening on ${config.HOST}:${config.PORT}`, {
      nodeEnv: config.NODE_ENV,
      publicBaseUrl: config.PUBLIC_BASE_URL,
    });
  } catch (err) {
    logger.error("Failed to start server", { error: String(err) });
    process.exit(1);
  }
}

start();
