import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type * as WebSocket from "ws";
import { hashToken } from "../lib/crypto.js";
import { shouldUpdateLastSeen } from "../lib/last-seen.js";
import { prisma } from "../lib/prisma.js";
import {
  defaultUpdateChannel,
  getClientRelease,
  isChannelAllowedForPlatform,
  isUpdateChannel,
} from "../services/client-update.js";

interface WsClient {
  deviceId: string;
  socket: WebSocket.WebSocket;
  // Wall-clock timestamp of the last inbound message we saw from this client.
  // Updated on hello/ping (and ignored if the type is something else). The
  // heartbeat sweeper uses this to decide which sockets are stale.
  lastClientActivityAt: number;
  // Bounded ring of message timestamps for per-socket rate limiting. A
  // client that bursts past MAX_MESSAGES_PER_WINDOW inside the rolling
  // window gets disconnected with 1008 so a real misbehaviour can't be
  // hidden by a slow drain.
  messageTimestamps: number[];
}

const connections = new Map<string, WsClient>();
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;

// ws.Server option: any inbound frame whose payload exceeds this is
// rejected by the underlying parser before it can reach the message
// handler, so a hostile or buggy client can't hold a long-poll socket
// open while streaming a multi-megabyte blob. The current protocol only
// exchanges tiny hello/ping JSON, so 8 KiB is generous.
export const WS_MAX_PAYLOAD_BYTES = 8 * 1024;

// Rolling per-socket message budget. The heartbeat contract expects one
// ping per 25-30 s, so 30 messages / 30 s tolerates bursty reconnect
// probes without leaving headroom for a tight flood loop.
const WS_MAX_MESSAGES_PER_WINDOW = 30;
const WS_WINDOW_MS = 30_000;

function isRateLimited(client: WsClient, now: number): boolean {
  const cutoff = now - WS_WINDOW_MS;
  const recent = client.messageTimestamps.filter((ts) => ts > cutoff);
  recent.push(now);
  client.messageTimestamps = recent;
  return recent.length > WS_MAX_MESSAGES_PER_WINDOW;
}

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

        try {
          if (client.socket.readyState !== 1) continue;
          client.socket.send(JSON.stringify(event));
        } catch {
          // A broken socket must not prevent later target devices from being
          // notified. This delivery remains pending for reconnect recovery.
          continue;
        }

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
  app.get("/api/v1/ws", { websocket: true }, async (socket: WebSocket.WebSocket, req: FastifyRequest) => {
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
      // 1008 is reserved for invalid/revoked credentials. A distinct code
      // prevents the displaced client from deleting an otherwise valid bind.
      existing.socket.close(4001, "New connection established elsewhere");
      connections.delete(device.id);
    }

    const client: WsClient = {
      deviceId: device.id,
      socket,
      lastClientActivityAt: Date.now(),
      messageTimestamps: [],
    };
    connections.set(device.id, client);

    // HTTP auth uses the same helper so a connection burst (each connect
    // used to write lastSeenAt) doesn't produce extra DB writes while the
    // device is flapping between networks.
    if (shouldUpdateLastSeen(device.lastSeenAt)) {
      await prisma.device.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });
    }

    socket.on("message", (raw: Buffer) => {
      // Per-frame size is bounded by ws.MaxPayload, but reaffirm here so
      // the behaviour is obvious inside the handler and stays correct if
      // someone raises the limit later without re-reading this path.
      if (raw.length > WS_MAX_PAYLOAD_BYTES) {
        socket.close(1009, "Payload too large");
        return;
      }
      if (isRateLimited(client, Date.now())) {
        socket.close(1008, "Rate limited");
        return;
      }
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "hello") {
          client.lastClientActivityAt = Date.now();
          socket.send(
            JSON.stringify({
              type: "hello.ack",
              serverTime: new Date().toISOString(),
            })
          );
          const requestedChannel = isUpdateChannel(msg.updateChannel)
            ? msg.updateChannel
            : defaultUpdateChannel(device.platform);
          if (requestedChannel && isChannelAllowedForPlatform(requestedChannel, device.platform)) {
            void getClientRelease(requestedChannel)
              .then((release) => {
                if (!release || socket.readyState !== 1) return;
                socket.send(JSON.stringify({ type: "app.update.available", release }));
              })
              .catch(() => undefined);
          }
        } else if (msg.type === "ping") {
          client.lastClientActivityAt = Date.now();
          socket.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    socket.on("close", () => {
      const current = connections.get(device.id);
      if (current?.socket === socket) {
        connections.delete(device.id);
      }
    });

    socket.on("error", () => {
      const current = connections.get(device.id);
      if (current?.socket === socket) {
        connections.delete(device.id);
      }
    });
  });

  // Heartbeat checker: disconnect stale clients.
  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const [deviceId, client] of connections.entries()) {
      if (now - client.lastClientActivityAt > HEARTBEAT_TIMEOUT_MS) {
        client.socket.close(1001, "Heartbeat timeout");
        connections.delete(deviceId);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  app.addHook("onClose", async () => {
    clearInterval(heartbeatTimer);
  });
});
