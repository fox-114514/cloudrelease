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

async function setDeviceProfile(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  deviceId: string,
  profile: string
) {
  return app.inject({
    method: "PATCH",
    url: `/api/v1/devices/${deviceId}/profile`,
    headers: { authorization: `Bearer ${token}` },
    payload: { profile },
  });
}

async function setReceiveConfig(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  deviceId: string,
  mode: string,
  sourceDeviceIds: string[] = []
) {
  return app.inject({
    method: "PUT",
    url: `/api/v1/devices/${deviceId}/receive-config`,
    headers: { authorization: `Bearer ${token}` },
    payload: { mode, sourceDeviceIds },
  });
}

describe("GET /api/v1/devices/me", () => {
  it("returns the device's identity, user, profile and permissions", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password", {
      displayName: "张三",
    });
    const ownerToken = await login(app, ownerLogin, "password");
    const childBindCode = await createBindCode(app, ownerToken, { userId: child.id });

    const reg = await app.inject({
      method: "POST",
      url: "/api/v1/devices/register",
      payload: {
        bindCode: childBindCode,
        deviceName: "张三的平板",
        platform: "android",
        osVersion: "15",
        appVersion: "0.5.0",
        profile: "sync_own",
      },
    });
    expect(reg.statusCode).toBe(201);
    const { deviceToken, deviceId } = JSON.parse(reg.payload).data;

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/devices/me",
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(me.statusCode).toBe(200);
    const meBody = JSON.parse(me.payload);
    expect(meBody.data.device.id).toBe(deviceId);
    expect(meBody.data.user.id).toBe(child.id);
    expect(meBody.data.user.displayName).toBe("张三");
    expect(meBody.data.user.role).toBe("child");
    expect(meBody.data.profile).toBe("sync_own");
    expect(meBody.data.permissions.canAutoReceive).toBe(true);
    expect(meBody.data.permissions.autoReceiveScope).toBe("same_user_only");
  });

  it("returns 401 DEVICE_AUTH_REQUIRED when called with a user token", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/devices/me",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).error.code).toBe("DEVICE_AUTH_REQUIRED");
  });
});

describe("PATCH /api/v1/devices/:id/profile — multi-user", () => {
  it("allows owner to switch any same-space device's profile", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const bindCode = await createBindCode(app, ownerToken);
    const { deviceId } = await registerDevice(app, bindCode);

    const res = await setDeviceProfile(app, ownerToken, deviceId, "sync_own");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.profile).toBe("sync_own");
    expect(body.data.permissions.autoReceiveScope).toBe("same_user_only");
  });

  it("allows a child user to update their own device's profile", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const childToken = await login(app, childLogin, "password");

    const childBindCode = await createBindCode(app, ownerToken, { userId: child.id });
    const { deviceId } = await registerDevice(app, childBindCode);

    const res = await setDeviceProfile(app, childToken, deviceId, "receive_own");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.profile).toBe("receive_own");
  });

  it("returns 404 when a child updates another member's profile", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childALogin = `a-${randomUUID()}`;
    const childBLogin = `b-${randomUUID()}`;
    const childA = await createChildUser(owner.ownerUserId, childALogin, "password");
    const childB = await createChildUser(owner.ownerUserId, childBLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const childAToken = await login(app, childALogin, "password");

    // Register a device under childA; childB tries to update it.
    void childA;
    const bindB = await createBindCode(app, ownerToken, { userId: childB.id });
    const { deviceId } = await registerDevice(app, bindB);

    const res = await setDeviceProfile(app, childAToken, deviceId, "sync_own");
    expect(res.statusCode).toBe(404);
  });

  it("does not modify canManualDownload, canManageSpace or canCreateInvite", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const childToken = await login(app, childLogin, "password");

    const childBindCode = await createBindCode(app, ownerToken, { userId: child.id });
    const { deviceId } = await registerDevice(app, childBindCode);

    // Owner enables privileged fields manually (only owner can do this).
    await updateDevicePermissions(app, ownerToken, deviceId, {
      canManualDownload: true,
      canManageSpace: true,
      canCreateInvite: true,
    });

    const before = await prisma.devicePermission.findUniqueOrThrow({ where: { deviceId } });
    expect(before.canManualDownload).toBe(true);
    expect(before.canManageSpace).toBe(true);
    expect(before.canCreateInvite).toBe(true);

    const res = await setDeviceProfile(app, childToken, deviceId, "upload_only");
    expect(res.statusCode).toBe(200);

    const after = await prisma.devicePermission.findUniqueOrThrow({ where: { deviceId } });
    expect(after.canManualDownload).toBe(true);
    expect(after.canManageSpace).toBe(true);
    expect(after.canCreateInvite).toBe(true);
    // The four runtime fields were updated by the profile.
    expect(after.autoReceiveScope).toBe("disabled");
    expect(after.canAutoReceive).toBe(false);
  });
});

describe("PATCH /api/v1/devices/:id/permissions — privilege escalation", () => {
  it("blocks a canManageSpace device from granting canManageSpace to another device", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    await createChildUser(owner.ownerUserId, childLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");

    const adminBindCode = await createBindCode(app, ownerToken);
    const { deviceId: adminDeviceId, deviceToken: adminDeviceToken } = await registerDevice(
      app,
      adminBindCode,
      { deviceName: "Admin Laptop" }
    );
    await updateDevicePermissions(app, ownerToken, adminDeviceId, { canManageSpace: true });

    const targetBindCode = await createBindCode(app, ownerToken);
    const { deviceId: targetDeviceId } = await registerDevice(app, targetBindCode);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/devices/${targetDeviceId}/permissions`,
      headers: { authorization: `Bearer ${adminDeviceToken}` },
      payload: { canManageSpace: true },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error.code).toBe("OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION");

    const target = await prisma.devicePermission.findUniqueOrThrow({ where: { deviceId: targetDeviceId } });
    expect(target.canManageSpace).toBe(false);
  });

  it("blocks a canManageSpace device from granting canCreateInvite to itself", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");

    const adminBindCode = await createBindCode(app, ownerToken);
    const { deviceId: adminDeviceId, deviceToken: adminDeviceToken } = await registerDevice(
      app,
      adminBindCode,
      { deviceName: "Admin Laptop" }
    );
    await updateDevicePermissions(app, ownerToken, adminDeviceId, { canManageSpace: true });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/devices/${adminDeviceId}/permissions`,
      headers: { authorization: `Bearer ${adminDeviceToken}` },
      payload: { canCreateInvite: true },
    });
    expect(res.statusCode).toBe(403);

    const after = await prisma.devicePermission.findUniqueOrThrow({ where: { deviceId: adminDeviceId } });
    expect(after.canCreateInvite).toBe(false);
  });

  it("still allows the owner JWT to grant privileged permissions", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const bindCode = await createBindCode(app, ownerToken);
    const { deviceId } = await registerDevice(app, bindCode);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/devices/${deviceId}/permissions`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { canManageSpace: true, canCreateInvite: true },
    });
    expect(res.statusCode).toBe(200);
    const after = await prisma.devicePermission.findUniqueOrThrow({ where: { deviceId } });
    expect(after.canManageSpace).toBe(true);
    expect(after.canCreateInvite).toBe(true);
  });

  it("allows a child to change manual rights on their own device but rejects automatic fields", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const childToken = await login(app, childLogin, "password");
    const childBindCode = await createBindCode(app, ownerToken, { userId: child.id });
    const { deviceId } = await registerDevice(app, childBindCode);

    const manual = await app.inject({
      method: "PATCH",
      url: `/api/v1/devices/${deviceId}/permissions`,
      headers: { authorization: `Bearer ${childToken}` },
      payload: { canManualUpload: false, canManualDownload: false },
    });
    expect(manual.statusCode).toBe(200);
    expect(JSON.parse(manual.payload).data.permissions.canManualUpload).toBe(false);
    expect(JSON.parse(manual.payload).data.permissions.canManualDownload).toBe(false);

    const automatic = await app.inject({
      method: "PATCH",
      url: `/api/v1/devices/${deviceId}/permissions`,
      headers: { authorization: `Bearer ${childToken}` },
      payload: { canAutoUpload: true },
    });
    expect(automatic.statusCode).toBe(403);
    expect(JSON.parse(automatic.payload).error.code).toBe("CHILD_PERMISSION_FIELD_FORBIDDEN");
  });
});

describe("PUT /api/v1/devices/:id/receive-config — atomic configuration", () => {
  it("disabled turns off autoReceive and removes all rules", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const sourceBindCode = await createBindCode(app, ownerToken);
    const { deviceId: sourceId } = await registerDevice(app, sourceBindCode);
    const targetBindCode = await createBindCode(app, ownerToken);
    const { deviceId: targetId } = await registerDevice(app, targetBindCode);

    await app.inject({
      method: "PUT",
      url: `/api/v1/devices/${targetId}/receive-sources/${sourceId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { enabled: true },
    });

    const res = await setReceiveConfig(app, ownerToken, targetId, "disabled");
    expect(res.statusCode).toBe(200);

    const after = await prisma.devicePermission.findUniqueOrThrow({ where: { deviceId: targetId } });
    expect(after.canAutoReceive).toBe(false);
    expect(after.autoReceiveScope).toBe("disabled");

    const remaining = await prisma.receiveSourceRule.count({ where: { targetDeviceId: targetId } });
    expect(remaining).toBe(0);
  });

  it("selected_devices atomically replaces the source rule set", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const aBindCode = await createBindCode(app, ownerToken);
    const a = await registerDevice(app, aBindCode);
    const bBindCode = await createBindCode(app, ownerToken);
    const b = await registerDevice(app, bBindCode);
    const cBindCode = await createBindCode(app, ownerToken);
    const c = await registerDevice(app, cBindCode);

    // Seed with [a]
    await setReceiveConfig(app, ownerToken, c.deviceId, "selected_devices", [a.deviceId]);
    let rules = await prisma.receiveSourceRule.findMany({ where: { targetDeviceId: c.deviceId } });
    expect(rules.map((r) => r.sourceDeviceId).sort()).toEqual([a.deviceId].sort());

    // Replace with [b]
    const res = await setReceiveConfig(app, ownerToken, c.deviceId, "selected_devices", [b.deviceId]);
    expect(res.statusCode).toBe(200);
    rules = await prisma.receiveSourceRule.findMany({ where: { targetDeviceId: c.deviceId } });
    expect(rules.map((r) => r.sourceDeviceId)).toEqual([b.deviceId]);

    // Empty array is rejected
    const empty = await setReceiveConfig(app, ownerToken, c.deviceId, "selected_devices", []);
    expect(empty.statusCode).toBe(400);
    expect(JSON.parse(empty.payload).error.code).toBe("INVALID_RECEIVE_CONFIG");
  });

  it("returns the persisted selected sources in the device list", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const source = await registerDevice(app, await createBindCode(app, ownerToken));
    const target = await registerDevice(app, await createBindCode(app, ownerToken));
    await setReceiveConfig(app, ownerToken, target.deviceId, "selected_devices", [source.deviceId]);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(list.statusCode).toBe(200);
    const targetRow = JSON.parse(list.payload).data.devices.find((d: any) => d.id === target.deviceId);
    expect(targetRow.receiveSourceDeviceIds).toEqual([source.deviceId]);
  });

  it("rejects duplicate and self source ids", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const source = await registerDevice(app, await createBindCode(app, ownerToken));
    const target = await registerDevice(app, await createBindCode(app, ownerToken));

    const duplicate = await setReceiveConfig(app, ownerToken, target.deviceId, "selected_devices", [
      source.deviceId,
      source.deviceId,
    ]);
    expect(duplicate.statusCode).toBe(400);
    expect(JSON.parse(duplicate.payload).error.code).toBe("INVALID_RECEIVE_CONFIG");

    const self = await setReceiveConfig(app, ownerToken, target.deviceId, "selected_devices", [
      target.deviceId,
    ]);
    expect(self.statusCode).toBe(400);
    expect(JSON.parse(self.payload).error.code).toBe("INVALID_RECEIVE_CONFIG");
  });

  it("allows a child to read source rules for their own device only", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const childToken = await login(app, childLogin, "password");
    const source = await registerDevice(app, await createBindCode(app, ownerToken, { userId: child.id }));
    const target = await registerDevice(app, await createBindCode(app, ownerToken, { userId: child.id }));
    const ownerDevice = await registerDevice(app, await createBindCode(app, ownerToken));
    await setReceiveConfig(app, childToken, target.deviceId, "selected_devices", [source.deviceId]);

    const own = await app.inject({
      method: "GET",
      url: `/api/v1/devices/${target.deviceId}/receive-sources`,
      headers: { authorization: `Bearer ${childToken}` },
    });
    expect(own.statusCode).toBe(200);
    expect(JSON.parse(own.payload).data.rules[0].sourceDeviceId).toBe(source.deviceId);

    const other = await app.inject({
      method: "GET",
      url: `/api/v1/devices/${ownerDevice.deviceId}/receive-sources`,
      headers: { authorization: `Bearer ${childToken}` },
    });
    expect(other.statusCode).toBe(404);
  });

  it("rejects selected_devices when any source id is missing in the space", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const bindCode = await createBindCode(app, ownerToken);
    const { deviceId: targetId } = await registerDevice(app, bindCode);

    const res = await setReceiveConfig(app, ownerToken, targetId, "selected_devices", [
      randomUUID(),
    ]);
    expect(res.statusCode).toBe(404);
  });

  it("blocks child users from selecting sources belonging to another member", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childALogin = `a-${randomUUID()}`;
    const childBLogin = `b-${randomUUID()}`;
    const childA = await createChildUser(owner.ownerUserId, childALogin, "password");
    await createChildUser(owner.ownerUserId, childBLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const childAToken = await login(app, childALogin, "password");

    const bindA = await createBindCode(app, ownerToken, { userId: childA.id });
    const a = await registerDevice(app, bindA);
    const bindB = await createBindCode(app, ownerToken);
    const b = await registerDevice(app, bindB);

    // ChildA tries to receive from B (owned by owner, not childA).
    const res = await setReceiveConfig(app, childAToken, a.deviceId, "selected_devices", [
      b.deviceId,
    ]);
    expect(res.statusCode).toBe(404);
  });

  it("forbids child users from selecting all_authorized_sources", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const childToken = await login(app, childLogin, "password");
    const childBindCode = await createBindCode(app, ownerToken, { userId: child.id });
    const { deviceId } = await registerDevice(app, childBindCode);

    const res = await setReceiveConfig(app, childToken, deviceId, "all_authorized_sources");
    expect(res.statusCode).toBe(403);
  });
});

describe("Self-management of devices by child users", () => {
  it("lets a child rename, revoke and delete their own device", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const childToken = await login(app, childLogin, "password");
    const childBindCode = await createBindCode(app, ownerToken, { userId: child.id });
    const { deviceId } = await registerDevice(app, childBindCode);

    const rename = await app.inject({
      method: "PATCH",
      url: `/api/v1/devices/${deviceId}`,
      headers: { authorization: `Bearer ${childToken}` },
      payload: { name: "新名字" },
    });
    expect(rename.statusCode).toBe(200);

    const revoke = await app.inject({
      method: "POST",
      url: `/api/v1/devices/${deviceId}/revoke`,
      headers: { authorization: `Bearer ${childToken}` },
    });
    expect(revoke.statusCode).toBe(200);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/${deviceId}`,
      headers: { authorization: `Bearer ${childToken}` },
    });
    expect(del.statusCode).toBe(200);

    const stored = await prisma.device.findUnique({ where: { id: deviceId } });
    expect(stored?.deletedAt).not.toBeNull();
    expect(stored?.name).toBe("新名字");
  });

  it("returns 404 when a child tries to manage another member's device", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childALogin = `a-${randomUUID()}`;
    const childBLogin = `b-${randomUUID()}`;
    const childA = await createChildUser(owner.ownerUserId, childALogin, "password");
    const childB = await createChildUser(owner.ownerUserId, childBLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const childAToken = await login(app, childALogin, "password");

    // The target device is registered under childB. childA must not be able
    // to rename / revoke / delete it; all responses must be 404 to prevent
    // enumeration of device existence across the space.
    void childA;
    const bindB = await createBindCode(app, ownerToken, { userId: childB.id });
    const { deviceId } = await registerDevice(app, bindB);

    for (const call of [
      { method: "PATCH" as const, url: `/api/v1/devices/${deviceId}`, payload: { name: "x" } },
      { method: "POST" as const, url: `/api/v1/devices/${deviceId}/revoke`, payload: {} },
      { method: "DELETE" as const, url: `/api/v1/devices/${deviceId}`, payload: {} },
    ]) {
      const res = await app.inject({
        method: call.method,
        url: call.url,
        headers: { authorization: `Bearer ${childAToken}` },
        payload: call.payload,
      });
      // Child users always get 404 for cross-member device actions so
      // they cannot enumerate device existence across the space.
      expect(res.statusCode).toBe(404);
    }
  });
});
