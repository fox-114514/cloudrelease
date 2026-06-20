import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { buildApp } from "../app.js";
import {
  createOwner,
  createChildUser,
  login,
  createBindCode,
  registerDevice,
  updateDevicePermissions,
} from "../test/helpers.js";
import { prisma } from "../lib/prisma.js";

describe("POST /api/v1/devices/register", () => {
  it("registers a device with a valid bind code", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/register",
      payload: {
        bindCode,
        deviceName: "Test Tablet",
        platform: "android",
        osVersion: "14",
        appVersion: "0.1.0",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.deviceToken).toBeDefined();
    expect(body.data.permissions.canManualUpload).toBe(true);
  });

  it("preserves bind-code case while ignoring copied surrounding whitespace", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/register",
      payload: {
        bindCode: `  ${bindCode}\n`,
        deviceName: "Copied Code Tablet",
        platform: "android",
        osVersion: "14",
        appVersion: "0.4.1",
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it("rejects an already-used bind code", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);
    await registerDevice(app, bindCode);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/register",
      payload: {
        bindCode,
        deviceName: "Second Tablet",
        platform: "android",
        osVersion: "14",
        appVersion: "0.1.0",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe("INVALID_BIND_CODE");
  });

  it("rejects invite_child_user bind codes", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token, { purpose: "invite_child_user" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/register",
      payload: {
        bindCode,
        deviceName: "Test Tablet",
        platform: "android",
        osVersion: "14",
        appVersion: "0.1.0",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe("INVALID_BIND_CODE");
  });
});

describe("GET /api/v1/devices", () => {
  it("allows owner user token to list all devices", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);
    await registerDevice(app, bindCode);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.devices).toHaveLength(1);
  });

  it("forbids a device without canManageSpace from listing devices", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);
    const { deviceToken } = await registerDevice(app, bindCode);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { authorization: `Bearer ${deviceToken}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("allows a device with canManageSpace to list all devices in the space", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    const owner = await createOwner(loginName, "password");
    const child = await createChildUser(owner.ownerUserId, `child-${randomUUID()}`, "password");
    const token = await login(app, loginName, "password");

    const ownerBindCode = await createBindCode(app, token);
    const { deviceId: ownerDeviceId, deviceToken } = await registerDevice(app, ownerBindCode);
    await updateDevicePermissions(app, token, ownerDeviceId, { canManageSpace: true });

    const childBindCode = await createBindCode(app, token, { userId: child.id });
    await registerDevice(app, childBindCode);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { authorization: `Bearer ${deviceToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.devices).toHaveLength(2);
  });
});

describe("PATCH /api/v1/devices/:id/permissions", () => {
  it("allows owner user token to update permissions", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);
    const { deviceId } = await registerDevice(app, bindCode);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/devices/${deviceId}/permissions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { canAutoUpload: true },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.permissions.canAutoUpload).toBe(true);
  });

  it("forbids a plain owner device without canManageSpace", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);
    const { deviceId, deviceToken } = await registerDevice(app, bindCode);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/devices/${deviceId}/permissions`,
      headers: { authorization: `Bearer ${deviceToken}` },
      payload: { canAutoUpload: true },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("PATCH /api/v1/devices/:id", () => {
  it("allows owner user token to rename a device", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);
    const { deviceId } = await registerDevice(app, bindCode, { deviceName: "Old Name" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/devices/${deviceId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "New Name" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.device.name).toBe("New Name");

    const updated = await prisma.device.findUnique({ where: { id: deviceId } });
    expect(updated?.name).toBe("New Name");
  });

  it("forbids a device without canManageSpace from renaming devices", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);
    const { deviceId, deviceToken } = await registerDevice(app, bindCode);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/devices/${deviceId}`,
      headers: { authorization: `Bearer ${deviceToken}` },
      payload: { name: "New Name" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("receive source rules", () => {
  it("allows owner user token to configure selected source devices", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");

    const sourceBindCode = await createBindCode(app, token);
    const { deviceId: sourceDeviceId } = await registerDevice(app, sourceBindCode);
    const targetBindCode = await createBindCode(app, token);
    const { deviceId: targetDeviceId } = await registerDevice(app, targetBindCode);

    const createRule = await app.inject({
      method: "PUT",
      url: `/api/v1/devices/${targetDeviceId}/receive-sources/${sourceDeviceId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });
    expect(createRule.statusCode).toBe(200);

    const listRules = await app.inject({
      method: "GET",
      url: `/api/v1/devices/${targetDeviceId}/receive-sources`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRules.statusCode).toBe(200);
    const body = JSON.parse(listRules.payload);
    expect(body.data.rules).toHaveLength(1);
    expect(body.data.rules[0].sourceDeviceId).toBe(sourceDeviceId);
  });
});

describe("POST /api/v1/devices/:id/revoke", () => {
  it("revokes a device and invalidates its token", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);
    const { deviceId, deviceToken } = await registerDevice(app, bindCode);

    const revokeRes = await app.inject({
      method: "POST",
      url: `/api/v1/devices/${deviceId}/revoke`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(revokeRes.statusCode).toBe(200);

    const revoked = await prisma.device.findUnique({ where: { id: deviceId } });
    expect(revoked?.revokedAt).not.toBeNull();

    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { authorization: `Bearer ${deviceToken}` },
    });

    expect(listRes.statusCode).toBe(401);
    const body = JSON.parse(listRes.payload);
    expect(body.error.code).toBe("DEVICE_REVOKED");
  });
});

describe("DELETE /api/v1/devices/:id", () => {
  it("soft-deletes a revoked device and hides it from the device list", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);
    const { deviceId } = await registerDevice(app, bindCode);

    await app.inject({
      method: "POST",
      url: `/api/v1/devices/${deviceId}/revoke`,
      headers: { authorization: `Bearer ${token}` },
    });
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/${deviceId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(deleteRes.statusCode).toBe(200);
    const deleted = await prisma.device.findUnique({ where: { id: deviceId } });
    expect(deleted?.deletedAt).not.toBeNull();

    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { authorization: `Bearer ${token}` },
    });
    const body = JSON.parse(listRes.payload);
    expect(body.data.devices.some((device: { id: string }) => device.id === deviceId)).toBe(false);
  });

  it("rejects deletion until the device is revoked", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, token);
    const { deviceId } = await registerDevice(app, bindCode);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/${deviceId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload).error.code).toBe("DEVICE_NOT_REVOKED");
  });
});
