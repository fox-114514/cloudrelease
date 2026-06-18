import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { buildApp } from "../app.js";
import { createOwner, createChildUser, login, createBindCode, registerDevice, updateDevicePermissions } from "../test/helpers.js";

describe("POST /api/v1/bind-codes", () => {
  it("allows owner user token to create a bind code", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      headers: { authorization: `Bearer ${token}` },
      payload: { purpose: "bind_device" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.bindCode).toBeDefined();
  });

  it("allows a device with canCreateInvite to create a bind code for itself", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const userToken = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, userToken);
    const { deviceId, deviceToken } = await registerDevice(app, bindCode);
    await updateDevicePermissions(app, userToken, deviceId, { canCreateInvite: true });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      headers: { authorization: `Bearer ${deviceToken}` },
      payload: { purpose: "bind_device" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
  });

  it("forbids a device with only canCreateInvite from creating bind codes for other users", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    const owner = await createOwner(loginName, "password");
    const child = await createChildUser(owner.ownerUserId, `child-${randomUUID()}`, "password");
    const userToken = await login(app, loginName, "password");

    // Create a bind code for the child user and register a device on their behalf.
    const bindCodeForChild = await createBindCode(app, userToken, { userId: child.id });
    const { deviceId, deviceToken } = await registerDevice(app, bindCodeForChild);
    await updateDevicePermissions(app, userToken, deviceId, { canCreateInvite: true });

    // The child's device with only canCreateInvite tries to create a bind code for the owner.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      headers: { authorization: `Bearer ${deviceToken}` },
      payload: { purpose: "bind_device", userId: owner.id },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("forbids unauthenticated requests", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      payload: { purpose: "bind_device" },
    });

    expect(res.statusCode).toBe(403);
  });
});
