import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type * as WebSocket from "ws";
import { hashToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";

interface WsClient {
  deviceId: string;
  socket: WebSocket.WebSocket;
  lastPongAt: number;
}

const connections = new Map<string, WsClient>();
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;

export function notifyDevicesForImage(imageId: string): void {
  // Fire-and-forget notification; failures are handled by pending deliveries fallback.
  prisma.delivery
    .findMany({
      where: { imageId, status: { in: ["pending", "notified"] } },
      include: { image: { include: { uploadDevice: true } } },
    })
    .then((deliveries) => {
      for (const delivery of deliveries) {
        const client = connections.get(delivery.targetDeviceId);
        if (!client) continue;

        const event = {
          type: "image.created",
          eventId: `${delivery.id}-${Date.now()}`,
          deliveryId: delivery.id,
          image: {
            id: delivery.image.id,
            mimeType: delivery.image.mimeType,
            fileSize: delivery.image.fileSize,
            width: delivery.image.width,
            height: delivery.image.height,
            sha256: delivery.image.sha256,
          },
          source: {
            uploadUserId: delivery.image.uploadUserId,
            uploadDeviceId: delivery.image.uploadDeviceId,
            uploadDeviceName: delivery.image.uploadDevice.name,
          },
          createdAt: delivery.image.createdAt.toISOString(),
          expiresAt: delivery.image.expiresAt.toISOString(),
        };

        client.socket.send(JSON.stringify(event));

        prisma.delivery
          .update({
            where: { id: delivery.id },
            data: { status: "notified", notifiedAt: new Date() },
          })
          .catch(() => {
            // ignore notification state update failures
          });
      }
    })
    .catch(() => {
      // ignore lookup failures; clients will fall back to pending deliveries
    });
}

export async function closeConnectionsForDevice(deviceId: string): Promise<void> {
  const client = connections.get(deviceId);
  if (client) {
    client.socket.close(1008, "Device revoked");
    connections.delete(deviceId);
  }
}

export const wsPlugin = fp(async (app: FastifyInstance) => {
  app.get("/ws", { websocket: true }, async (socket: WebSocket.WebSocket, req: FastifyRequest) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      socket.close(1008, "Missing authorization");
      return;
    }

    const token = authHeader.slice(7);
    if (token.includes(".")) {
      socket.close(1008, "Use device token for WebSocket");
      return;
    }

    const tokenHash = hashToken(token);
    const device = await prisma.device.findUnique({
      where: { deviceTokenHash: tokenHash },
      include: { permissions: true, user: true },
    });

    if (!device || device.revokedAt || device.user.disabledAt) {
      socket.close(1008, "Invalid or revoked device");
      return;
    }

    // Close any existing connection for this device.
    const existing = connections.get(device.id);
    if (existing) {
      existing.socket.close(1008, "New connection established");
      connections.delete(device.id);
    }

    const client: WsClient = {
      deviceId: device.id,
      socket,
      lastPongAt: Date.now(),
    };
    connections.set(device.id, client);

    await prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "hello") {
          socket.send(
            JSON.stringify({
              type: "hello.ack",
              serverTime: new Date().toISOString(),
            })
          );
        } else if (msg.type === "ping") {
          client.lastPongAt = Date.now();
          socket.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    socket.on("close", () => {
      connections.delete(device.id);
    });

    socket.on("error", () => {
      connections.delete(device.id);
    });
  });

  // Heartbeat checker: disconnect stale clients.
  setInterval(() => {
    const now = Date.now();
    for (const [deviceId, client] of connections.entries()) {
      if (now - client.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
        client.socket.close(1001, "Heartbeat timeout");
        connections.delete(deviceId);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
});
