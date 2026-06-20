import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async () => {
    return {
      status: "ok",
      service: "studyshot-relay-backend",
      version: "0.3.0",
      timestamp: new Date().toISOString(),
    };
  });
}
