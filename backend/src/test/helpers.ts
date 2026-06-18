import type { FastifyInstance } from "fastify";
import { createHash } from "crypto";
import sharp from "sharp";
import { hashPassword } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";

export async function createOwner(
  login: string,
  password: string,
  opts: { displayName?: string } = {}
): Promise<{ id: string; ownerUserId: string }> {
  const user = await prisma.user.create({
    data: {
      ownerUserId: "self",
      role: "owner",
      emailOrLogin: login,
      passwordHash: await hashPassword(password),
      displayName: opts.displayName ?? "Owner",
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { ownerUserId: user.id },
  });
  return { id: user.id, ownerUserId: user.id };
}

export async function createChildUser(
  ownerUserId: string,
  login: string,
  password: string,
  opts: { displayName?: string } = {}
): Promise<{ id: string; ownerUserId: string }> {
  const user = await prisma.user.create({
    data: {
      ownerUserId,
      role: "child",
      emailOrLogin: login,
      passwordHash: await hashPassword(password),
      displayName: opts.displayName ?? "Child",
    },
  });
  return { id: user.id, ownerUserId: user.ownerUserId };
}

export async function login(app: FastifyInstance, login: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { login, password },
  });
  const body = JSON.parse(res.payload);
  if (!body.success) {
    throw new Error(`Login failed: ${JSON.stringify(body.error)}`);
  }
  return body.data.accessToken as string;
}

export async function createBindCode(
  app: FastifyInstance,
  token: string,
  opts: { userId?: string; purpose?: "bind_device" | "invite_child_user"; expiresInSeconds?: number } = {}
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/bind-codes",
    headers: { authorization: `Bearer ${token}` },
    payload: opts,
  });
  const body = JSON.parse(res.payload);
  if (!body.success) {
    throw new Error(`Create bind code failed: ${JSON.stringify(body.error)}`);
  }
  return body.data.bindCode as string;
}

export async function registerDevice(
  app: FastifyInstance,
  bindCode: string,
  opts: { deviceName?: string; platform?: "android" | "windows" | "linux" } = {}
): Promise<{ deviceId: string; deviceToken: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/devices/register",
    payload: {
      bindCode,
      deviceName: opts.deviceName ?? "Test Device",
      platform: opts.platform ?? "android",
      osVersion: "14",
      appVersion: "0.1.0",
    },
  });
  const body = JSON.parse(res.payload);
  if (!body.success) {
    throw new Error(`Register device failed: ${JSON.stringify(body.error)}`);
  }
  return {
    deviceId: body.data.deviceId,
    deviceToken: body.data.deviceToken,
  };
}

export async function updateDevicePermissions(
  app: FastifyInstance,
  token: string,
  deviceId: string,
  permissions: Record<string, boolean | string>
): Promise<void> {
  const res = await app.inject({
    method: "PATCH",
    url: `/api/v1/devices/${deviceId}/permissions`,
    headers: { authorization: `Bearer ${token}` },
    payload: permissions,
  });
  const body = JSON.parse(res.payload);
  if (!body.success) {
    throw new Error(`Update permissions failed: ${JSON.stringify(body.error)}`);
  }
}

export function buildMultipartBody(
  parts: { name: string; value: string }[],
  file: { fieldName: string; filename: string; contentType: string; buffer: Buffer },
  boundary: string
): Buffer {
  const chunks: Buffer[] = [];

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`));
    chunks.push(Buffer.from(part.value));
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(
    Buffer.from(
      `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n`
    )
  );
  chunks.push(Buffer.from(`Content-Type: ${file.contentType}\r\n\r\n`));
  chunks.push(file.buffer);
  chunks.push(Buffer.from("\r\n"));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return Buffer.concat(chunks);
}

export async function createTestImage(opts: { color?: string } = {}): Promise<{ buffer: Buffer; sha256: string }> {
  const buffer = await sharp({
    create: {
      width: 10,
      height: 10,
      channels: 3,
      background: opts.color ?? "#ff0000",
    },
  })
    .png()
    .toBuffer();
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return { buffer, sha256 };
}
