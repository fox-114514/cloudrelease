import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { buildApp } from "../app.js";
import {
  buildMultipartBody,
  createOwner,
  createChildUser,
  createTestImage,
  login,
  createBindCode,
  registerDevice,
  updateDevicePermissions,
} from "../test/helpers.js";
import { prisma } from "../lib/prisma.js";

const BOUNDARY = "----StudyShotTestBoundary";

interface UserHandle {
  login: string;
  id: string;
  token: string;
}

async function uploadImage(
  app: Awaited<ReturnType<typeof buildApp>>,
  deviceToken: string,
  color?: string
) {
  const { buffer, sha256 } = await createTestImage({ color });
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/images",
    headers: {
      authorization: `Bearer ${deviceToken}`,
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
    },
    payload: buildMultipartBody(
      [
        { name: "sha256", value: sha256 },
        { name: "sourceKind", value: "screenshot" },
      ],
      {
        fieldName: "file",
        filename: "test.png",
        contentType: "image/png",
        buffer,
      },
      BOUNDARY
    ),
  });
  return { res, body: JSON.parse(res.payload), sha256 };
}

async function makeUser(
  app: Awaited<ReturnType<typeof buildApp>>,
  ownerUserId: string,
  userLogin: string
): Promise<UserHandle> {
  const child = await createChildUser(ownerUserId, userLogin, "password");
  const token = await login(app, userLogin, "password");
  return { login: userLogin, id: child.id, token };
}

async function registerReceiveDevice(
  app: Awaited<ReturnType<typeof buildApp>>,
  ownerToken: string,
  ownerUserId: string,
  userId: string,
  scope: "same_user_only" | "all_authorized_sources" | "disabled",
  deviceName: string
) {
  const bindCode = await createBindCode(app, ownerToken, { userId });
  const reg = await registerDevice(app, bindCode, { deviceName, platform: "linux" });
  if (scope !== "disabled") {
    await updateDevicePermissions(app, ownerToken, reg.deviceId, {
      canAutoReceive: true,
      autoReceiveScope: scope,
    });
  }
  void ownerUserId;
  return reg;
}

describe("Image isolation between members (spec §14.3)", () => {
  it("delivers A's upload to A's same_user_only device", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childA = await makeUser(app, owner.ownerUserId, `a-${randomUUID()}`);
    const ownerToken = await login(app, ownerLogin, "password");

    const upload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childA.id }), {
      deviceName: "A-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerToken, upload.deviceId, { canAutoUpload: true });

    const receive = await registerReceiveDevice(app, ownerToken, owner.ownerUserId, childA.id, "same_user_only", "A-receiver");

    const up = await uploadImage(app, upload.deviceToken);
    expect(up.res.statusCode).toBe(201);
    expect(up.body.data.createdDeliveriesCount).toBe(1);

    const pending = await app.inject({
      method: "GET",
      url: "/api/v1/deliveries/pending",
      headers: { authorization: `Bearer ${receive.deviceToken}` },
    });
    expect(JSON.parse(pending.payload).data.deliveries).toHaveLength(1);
  });

  it("does NOT deliver A's upload to B's same_user_only device", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childA = await makeUser(app, owner.ownerUserId, `a-${randomUUID()}`);
    const childB = await makeUser(app, owner.ownerUserId, `b-${randomUUID()}`);
    const ownerToken = await login(app, ownerLogin, "password");

    const upload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childA.id }), {
      deviceName: "A-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerToken, upload.deviceId, { canAutoUpload: true });

    const receive = await registerReceiveDevice(app, ownerToken, owner.ownerUserId, childB.id, "same_user_only", "B-receiver");

    const up = await uploadImage(app, upload.deviceToken);
    expect(up.res.statusCode).toBe(201);
    expect(up.body.data.createdDeliveriesCount).toBe(0);

    const pending = await app.inject({
      method: "GET",
      url: "/api/v1/deliveries/pending",
      headers: { authorization: `Bearer ${receive.deviceToken}` },
    });
    expect(JSON.parse(pending.payload).data.deliveries).toHaveLength(0);
  });

  it("does NOT deliver A's upload to owner's same_user_only device", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childA = await makeUser(app, owner.ownerUserId, `a-${randomUUID()}`);
    const ownerToken = await login(app, ownerLogin, "password");

    const upload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childA.id }), {
      deviceName: "A-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerToken, upload.deviceId, { canAutoUpload: true });

    const ownerReceive = await registerReceiveDevice(app, ownerToken, owner.ownerUserId, owner.id, "same_user_only", "owner-receiver");

    const up = await uploadImage(app, upload.deviceToken);
    expect(up.body.data.createdDeliveriesCount).toBe(0);

    const pending = await app.inject({
      method: "GET",
      url: "/api/v1/deliveries/pending",
      headers: { authorization: `Bearer ${ownerReceive.deviceToken}` },
    });
    expect(JSON.parse(pending.payload).data.deliveries).toHaveLength(0);
  });

  it("delivers A's upload after admin explicitly sets an owner device to all_authorized_sources", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childA = await makeUser(app, owner.ownerUserId, `a-${randomUUID()}`);
    const ownerToken = await login(app, ownerLogin, "password");

    const upload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childA.id }), {
      deviceName: "A-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerToken, upload.deviceId, { canAutoUpload: true });

    const ownerReceive = await registerReceiveDevice(
      app,
      ownerToken,
      owner.ownerUserId,
      owner.id,
      "all_authorized_sources",
      "owner-everything"
    );

    const up = await uploadImage(app, upload.deviceToken);
    expect(up.body.data.createdDeliveriesCount).toBe(1);

    const pending = await app.inject({
      method: "GET",
      url: "/api/v1/deliveries/pending",
      headers: { authorization: `Bearer ${ownerReceive.deviceToken}` },
    });
    expect(JSON.parse(pending.payload).data.deliveries).toHaveLength(1);
  });

  it("child A's image list only shows their own uploads", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childA = await makeUser(app, owner.ownerUserId, `a-${randomUUID()}`);
    const childB = await makeUser(app, owner.ownerUserId, `b-${randomUUID()}`);
    const ownerToken = await login(app, ownerLogin, "password");

    const aUpload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childA.id }), {
      deviceName: "A-uploader",
      platform: "android",
    });
    const bUpload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childB.id }), {
      deviceName: "B-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerToken, aUpload.deviceId, { canAutoUpload: true });
    await updateDevicePermissions(app, ownerToken, bUpload.deviceId, { canAutoUpload: true });

    await uploadImage(app, aUpload.deviceToken, "#ff0000");
    await uploadImage(app, bUpload.deviceToken, "#00ff00");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/images",
      headers: { authorization: `Bearer ${childA.token}` },
    });
    expect(list.statusCode).toBe(200);
    const listBody = JSON.parse(list.payload);
    expect(listBody.data.images).toHaveLength(1);
    expect(listBody.data.images[0].uploadedBy.userId).toBe(childA.id);
  });

  it("child B cannot download A's image even when they know the image id", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childA = await makeUser(app, owner.ownerUserId, `a-${randomUUID()}`);
    const childB = await makeUser(app, owner.ownerUserId, `b-${randomUUID()}`);
    const ownerToken = await login(app, ownerLogin, "password");

    const aUpload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childA.id }), {
      deviceName: "A-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerToken, aUpload.deviceId, { canAutoUpload: true });

    const up = await uploadImage(app, aUpload.deviceToken);
    expect(up.res.statusCode).toBe(201);
    const imageId = up.body.data.imageId;

    const dl = await app.inject({
      method: "GET",
      url: `/api/v1/images/${imageId}/download`,
      headers: { authorization: `Bearer ${childB.token}` },
    });
    expect(dl.statusCode).toBe(404);
  });

  it("child B's device with canManualDownload=true still cannot download A's image", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childA = await makeUser(app, owner.ownerUserId, `a-${randomUUID()}`);
    const childB = await makeUser(app, owner.ownerUserId, `b-${randomUUID()}`);
    const ownerToken = await login(app, ownerLogin, "password");

    const aUpload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childA.id }), {
      deviceName: "A-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerToken, aUpload.deviceId, { canAutoUpload: true });

    const bDevice = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childB.id }), {
      deviceName: "B-receiver",
      platform: "linux",
    });
    await updateDevicePermissions(app, ownerToken, bDevice.deviceId, { canManualDownload: true });

    const up = await uploadImage(app, aUpload.deviceToken);
    const imageId = up.body.data.imageId;

    const dl = await app.inject({
      method: "GET",
      url: `/api/v1/images/${imageId}/download`,
      headers: { authorization: `Bearer ${bDevice.deviceToken}` },
    });
    expect(dl.statusCode).toBe(404);
  });

  it("A's own device with canManualDownload=true can download A's image without a delivery", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childA = await makeUser(app, owner.ownerUserId, `a-${randomUUID()}`);
    const ownerToken = await login(app, ownerLogin, "password");

    const aUpload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childA.id }), {
      deviceName: "A-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerToken, aUpload.deviceId, {
      canAutoUpload: true,
      canManualDownload: true,
    });

    const up = await uploadImage(app, aUpload.deviceToken);
    const imageId = up.body.data.imageId;

    const dl = await app.inject({
      method: "GET",
      url: `/api/v1/images/${imageId}/download`,
      headers: { authorization: `Bearer ${aUpload.deviceToken}` },
    });
    expect(dl.statusCode).toBe(200);
  });

  it("child A can delete their own image", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childA = await makeUser(app, owner.ownerUserId, `a-${randomUUID()}`);
    const ownerToken = await login(app, ownerLogin, "password");

    const aUpload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childA.id }), {
      deviceName: "A-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerToken, aUpload.deviceId, { canAutoUpload: true });

    const up = await uploadImage(app, aUpload.deviceToken);
    const imageId = up.body.data.imageId;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/images/${imageId}`,
      headers: { authorization: `Bearer ${childA.token}` },
    });
    expect(del.statusCode).toBe(200);

    const stored = await prisma.image.findUnique({ where: { id: imageId } });
    expect(stored?.deletedAt).not.toBeNull();
  });

  it("child A deleting B's image gets 404 (no enumeration leak)", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childA = await makeUser(app, owner.ownerUserId, `a-${randomUUID()}`);
    const childB = await makeUser(app, owner.ownerUserId, `b-${randomUUID()}`);
    const ownerToken = await login(app, ownerLogin, "password");

    const bUpload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childB.id }), {
      deviceName: "B-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerToken, bUpload.deviceId, { canAutoUpload: true });

    const up = await uploadImage(app, bUpload.deviceToken);
    const imageId = up.body.data.imageId;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/images/${imageId}`,
      headers: { authorization: `Bearer ${childA.token}` },
    });
    expect(del.statusCode).toBe(404);

    // Owner can still see and delete B's image.
    const ownerList = await app.inject({
      method: "GET",
      url: `/api/v1/images?userId=${childB.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerList.statusCode).toBe(200);
    expect(JSON.parse(ownerList.payload).data.images).toHaveLength(1);

    const ownerDel = await app.inject({
      method: "DELETE",
      url: `/api/v1/images/${imageId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerDel.statusCode).toBe(200);
  });

  it("owner can list images per-member via userId filter", async () => {
    const app = await buildApp();
    const ownerLogin = `owner-${randomUUID()}`;
    const owner = await createOwner(ownerLogin, "password");
    const childA = await makeUser(app, owner.ownerUserId, `a-${randomUUID()}`);
    const childB = await makeUser(app, owner.ownerUserId, `b-${randomUUID()}`);
    const ownerToken = await login(app, ownerLogin, "password");

    const aUpload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childA.id }), {
      deviceName: "A-uploader",
      platform: "android",
    });
    const bUpload = await registerDevice(app, await createBindCode(app, ownerToken, { userId: childB.id }), {
      deviceName: "B-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerToken, aUpload.deviceId, { canAutoUpload: true });
    await updateDevicePermissions(app, ownerToken, bUpload.deviceId, { canAutoUpload: true });

    await uploadImage(app, aUpload.deviceToken, "#ff0000");
    await uploadImage(app, bUpload.deviceToken, "#00ff00");

    // Owner sees both.
    const allList = await app.inject({
      method: "GET",
      url: "/api/v1/images",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(JSON.parse(allList.payload).data.images).toHaveLength(2);

    // Owner filters by child A only.
    const aList = await app.inject({
      method: "GET",
      url: `/api/v1/images?userId=${childA.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(aList.statusCode).toBe(200);
    const aBody = JSON.parse(aList.payload);
    expect(aBody.data.images).toHaveLength(1);
    expect(aBody.data.images[0].uploadedBy.userId).toBe(childA.id);

    // Owner filters by unknown user id in the space → 404.
    const missing = await app.inject({
      method: "GET",
      url: `/api/v1/images?userId=${randomUUID()}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("cross owner-space uploads remain isolated end-to-end", async () => {
    const app = await buildApp();
    const ownerALogin = `owner-a-${randomUUID()}`;
    const ownerBLogin = `owner-b-${randomUUID()}`;
    const ownerA = await createOwner(ownerALogin, "password");
    const ownerB = await createOwner(ownerBLogin, "password");
    const ownerAToken = await login(app, ownerALogin, "password");
    const ownerBToken = await login(app, ownerBLogin, "password");

    const aUpload = await registerDevice(app, await createBindCode(app, ownerAToken), {
      deviceName: "A-uploader",
      platform: "android",
    });
    await updateDevicePermissions(app, ownerAToken, aUpload.deviceId, { canAutoUpload: true });

    const bReceiver = await registerReceiveDevice(
      app,
      ownerBToken,
      ownerB.ownerUserId,
      ownerB.id,
      "all_authorized_sources",
      "B-everything"
    );

    const up = await uploadImage(app, aUpload.deviceToken);
    expect(up.body.data.createdDeliveriesCount).toBe(0);

    const download = await app.inject({
      method: "GET",
      url: `/api/v1/images/${up.body.data.imageId}/download`,
      headers: { authorization: `Bearer ${ownerBToken}` },
    });
    expect(download.statusCode).toBe(404);

    // The B receiver also sees no pending deliveries.
    const pending = await app.inject({
      method: "GET",
      url: "/api/v1/deliveries/pending",
      headers: { authorization: `Bearer ${bReceiver.deviceToken}` },
    });
    expect(JSON.parse(pending.payload).data.deliveries).toHaveLength(0);

    void ownerA;
  });
});