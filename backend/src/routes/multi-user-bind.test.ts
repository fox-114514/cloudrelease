import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { buildApp } from "../app.js";
import {
  createOwner,
  createChildUser,
  login,
  createBindCode,
  registerDevice,
} from "../test/helpers.js";
import { hashToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";

async function previewBindCode(
  app: Awaited<ReturnType<typeof buildApp>>,
  bindCode: string
): Promise<{ statusCode: number; body: any }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/bind-codes/preview",
    payload: { bindCode },
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.payload) };
}

describe("POST /api/v1/bind-codes — multi-user authorization", () => {
  it("allows a child user token to create a bind code for themselves (no userId)", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    const childToken = await login(app, childLogin, "password");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      headers: { authorization: `Bearer ${childToken}` },
      payload: { purpose: "bind_device" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.data.bindCode).toBeDefined();
    expect(body.data.targetUser.id).toBe(child.id);
    expect(body.data.targetUser.role).toBe("child");
  });

  it("allows a child user token to create a bind code by explicitly passing their own userId", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    const childToken = await login(app, childLogin, "password");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      headers: { authorization: `Bearer ${childToken}` },
      payload: { purpose: "bind_device", userId: child.id },
    });

    expect(res.statusCode).toBe(201);
  });

  it("forbids a child from creating a bind code for the owner", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    await createChildUser(owner.ownerUserId, childLogin, "password");
    const childToken = await login(app, childLogin, "password");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      headers: { authorization: `Bearer ${childToken}` },
      payload: { purpose: "bind_device", userId: owner.id },
    });

    expect(res.statusCode).toBe(403);
  });

  it("forbids a child from creating a bind code for another child", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childALogin = `a-${randomUUID()}`;
    const childBLogin = `b-${randomUUID()}`;
    await createChildUser(owner.ownerUserId, childALogin, "password");
    const childB = await createChildUser(owner.ownerUserId, childBLogin, "password");
    const childAToken = await login(app, childALogin, "password");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      headers: { authorization: `Bearer ${childAToken}` },
      payload: { purpose: "bind_device", userId: childB.id },
    });

    expect(res.statusCode).toBe(403);
  });

  it("allows owner to create a bind code for any non-disabled same-space member", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { purpose: "bind_device", userId: child.id },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).data.targetUser.id).toBe(child.id);
  });

  it("rejects bind code creation for a user in a different owner space", async () => {
    const app = await buildApp();
    const ownerALogin = `owner-a-${randomUUID()}`;
    const ownerBLogin = `owner-b-${randomUUID()}`;
    const ownerA = await createOwner(ownerALogin, "password");
    const ownerB = await createOwner(ownerBLogin, "password");
    const ownerAToken = await login(app, ownerALogin, "password");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      headers: { authorization: `Bearer ${ownerAToken}` },
      payload: { purpose: "bind_device", userId: ownerB.id },
    });

    expect(res.statusCode).toBe(404);
    // ownerA is a real user — make sure we didn't accidentally find ownerA's own id.
    void ownerA;
  });

  it("returns 409 when the target user is disabled", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    await prisma.user.update({
      where: { id: child.id },
      data: { disabledAt: new Date() },
    });
    const ownerToken = await login(app, ownerLogin, "password");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { purpose: "bind_device", userId: child.id },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload).error.code).toBe("TARGET_USER_DISABLED");
  });

  it("rejects expiresInSeconds greater than 3600", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bind-codes",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { purpose: "bind_device", expiresInSeconds: 3601 },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/v1/bind-codes/preview", () => {
  it("returns target user summary but no login for a valid code", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password", {
      displayName: "张三",
    });
    const ownerToken = await login(app, ownerLogin, "password");

    const bindCode = await createBindCode(app, ownerToken, { userId: child.id });
    const preview = await previewBindCode(app, bindCode);

    expect(preview.statusCode).toBe(200);
    expect(preview.body.data.targetUser.id).toBe(child.id);
    expect(preview.body.data.targetUser.displayName).toBe("张三");
    expect(preview.body.data.targetUser.role).toBe("child");
    expect(preview.body.data.targetUser.emailOrLogin).toBeUndefined();
    expect(preview.body.data.targetUser.passwordHash).toBeUndefined();
    expect(preview.body.data.space.ownerUserId).toBe(owner.ownerUserId);
    expect(preview.body.data.space.displayName).toBeDefined();
  });

  it("does NOT consume the bind code", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const bindCode = await createBindCode(app, ownerToken);

    const preview = await previewBindCode(app, bindCode);
    expect(preview.statusCode).toBe(200);

    // The original code must still register a device.
    const reg = await registerDevice(app, bindCode);
    expect(reg.deviceId).toBeDefined();
  });

  it("returns INVALID_BIND_CODE for used, expired, wrong-case or nonexistent codes", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");

    // Used
    const usedCode = await createBindCode(app, ownerToken);
    await registerDevice(app, usedCode);
    const used = await previewBindCode(app, usedCode);
    expect(used.statusCode).toBe(400);
    expect(used.body.error.code).toBe("INVALID_BIND_CODE");

    // Expired
    const expiredCode = await createBindCode(app, ownerToken);
    await prisma.bindCode.updateMany({
      where: { codeHash: hashToken(expiredCode) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await previewBindCode(app, expiredCode);
    expect(expired.body.error.code).toBe("INVALID_BIND_CODE");

    // Wrong case (uppercase)
    const valid = await createBindCode(app, ownerToken);
    const wrongCase = await previewBindCode(app, valid.toUpperCase());
    expect(wrongCase.body.error.code).toBe("INVALID_BIND_CODE");

    // Nonexistent
    const missing = await previewBindCode(app, "nopenotrealcode");
    expect(missing.body.error.code).toBe("INVALID_BIND_CODE");
  });

  it("rejects disabled-user codes as INVALID_BIND_CODE without leaking the disabled state", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const bindCode = await createBindCode(app, ownerToken, { userId: child.id });
    await prisma.user.update({
      where: { id: child.id },
      data: { disabledAt: new Date() },
    });

    const preview = await previewBindCode(app, bindCode);
    expect(preview.statusCode).toBe(400);
    expect(preview.body.error.code).toBe("INVALID_BIND_CODE");
  });
});

describe("POST /api/v1/devices/register — multi-user profiles", () => {
  it("maps each selectable profile to the documented permission columns", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");

    const profileExpectations: Record<string, {
      canAutoUpload: boolean;
      canManualUpload: boolean;
      canAutoReceive: boolean;
      autoUploadScope: string;
      autoReceiveScope: string;
    }> = {
      manual_only: {
        canAutoUpload: false,
        canManualUpload: true,
        canAutoReceive: false,
        autoUploadScope: "manual_share_only",
        autoReceiveScope: "disabled",
      },
      upload_only: {
        canAutoUpload: true,
        canManualUpload: true,
        canAutoReceive: false,
        autoUploadScope: "screenshot_only",
        autoReceiveScope: "disabled",
      },
      receive_own: {
        canAutoUpload: false,
        canManualUpload: true,
        canAutoReceive: true,
        autoUploadScope: "manual_share_only",
        autoReceiveScope: "same_user_only",
      },
      sync_own: {
        canAutoUpload: true,
        canManualUpload: true,
        canAutoReceive: true,
        autoUploadScope: "screenshot_only",
        autoReceiveScope: "same_user_only",
      },
    };

    for (const [profile, expected] of Object.entries(profileExpectations)) {
      const bindCode = await createBindCode(app, ownerToken);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/devices/register",
        payload: {
          bindCode,
          deviceName: `${profile}-device`,
          platform: "android",
          osVersion: "15",
          appVersion: "0.5.0",
          profile,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.profile).toBe(profile);
      expect(body.data.permissions.canAutoUpload).toBe(expected.canAutoUpload);
      expect(body.data.permissions.canManualUpload).toBe(expected.canManualUpload);
      expect(body.data.permissions.canAutoReceive).toBe(expected.canAutoReceive);
      expect(body.data.permissions.autoUploadScope).toBe(expected.autoUploadScope);
      expect(body.data.permissions.autoReceiveScope).toBe(expected.autoReceiveScope);
      // Privileged fields stay false regardless of profile.
      expect(body.data.permissions.canManageSpace).toBe(false);
      expect(body.data.permissions.canCreateInvite).toBe(false);
      expect(body.data.permissions.canManualDownload).toBe(false);
    }
  });

  it("falls back to legacy default permissions when no profile is supplied", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const bindCode = await createBindCode(app, ownerToken);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/register",
      payload: {
        bindCode,
        deviceName: "Legacy Device",
        platform: "android",
        osVersion: "15",
        appVersion: "0.5.0",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.data.profile).toBe("custom");
    expect(body.data.permissions.canAutoUpload).toBe(false);
    expect(body.data.permissions.canManualUpload).toBe(true);
    expect(body.data.permissions.autoUploadScope).toBe("screenshot_only");
    expect(body.data.permissions.autoReceiveScope).toBe("disabled");
  });

  it("gives a new child device same-user receive plus manual upload/download by default", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const child = await createChildUser(
      owner.ownerUserId,
      `child-${randomUUID()}`,
      "password"
    );
    const ownerToken = await login(app, ownerLogin, "password");
    const bindCode = await createBindCode(app, ownerToken, { userId: child.id });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/register",
      payload: {
        bindCode,
        deviceName: "Child Device",
        platform: "android",
        osVersion: "15",
        appVersion: "0.5.0",
      },
    });
    expect(res.statusCode).toBe(201);
    const permissions = JSON.parse(res.payload).data.permissions;
    expect(permissions.canManualUpload).toBe(true);
    expect(permissions.canManualDownload).toBe(true);
    expect(permissions.canAutoReceive).toBe(true);
    expect(permissions.autoReceiveScope).toBe("same_user_only");
  });

  it("rejects 'custom' as a profile submission", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    await createOwner(ownerLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const bindCode = await createBindCode(app, ownerToken);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/register",
      payload: {
        bindCode,
        deviceName: "Custom Device",
        platform: "android",
        osVersion: "15",
        appVersion: "0.5.0",
        profile: "custom",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects registration against a bind code whose target user was disabled", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childLogin = `child-${randomUUID()}`;
    const child = await createChildUser(owner.ownerUserId, childLogin, "password");
    const ownerToken = await login(app, ownerLogin, "password");
    const bindCode = await createBindCode(app, ownerToken, { userId: child.id });
    await prisma.user.update({
      where: { id: child.id },
      data: { disabledAt: new Date() },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/devices/register",
      payload: {
        bindCode,
        deviceName: "After-Disabled Tablet",
        platform: "android",
        osVersion: "15",
        appVersion: "0.5.0",
        profile: "manual_only",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error.code).toBe("INVALID_BIND_CODE");
  });
});
