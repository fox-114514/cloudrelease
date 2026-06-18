import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { buildApp } from "../app.js";
import {
  buildMultipartBody,
  createOwner,
  createTestImage,
  login,
  createBindCode,
  registerDevice,
  updateDevicePermissions,
} from "../test/helpers.js";
import { prisma } from "../lib/prisma.js";

const BOUNDARY = "----StudyShotTestBoundary";

async function setupUploaderAndReceiver() {
  const app = await buildApp();
  const loginName = `owner-${randomUUID()}`;
  await createOwner(loginName, "password");
  const userToken = await login(app, loginName, "password");

  const uploadBindCode = await createBindCode(app, userToken);
  const { deviceId: uploadDeviceId, deviceToken: uploadDeviceToken } = await registerDevice(
    app,
    uploadBindCode,
    { deviceName: "Uploader", platform: "android" }
  );
  await updateDevicePermissions(app, userToken, uploadDeviceId, {
    canAutoUpload: true,
  });

  const receiveBindCode = await createBindCode(app, userToken);
  const { deviceId: receiveDeviceId, deviceToken: receiveDeviceToken } = await registerDevice(
    app,
    receiveBindCode,
    { deviceName: "Receiver", platform: "linux" }
  );
  await updateDevicePermissions(app, userToken, receiveDeviceId, {
    canAutoReceive: true,
    autoReceiveScope: "all_authorized_sources",
  });

  return { app, userToken, uploadDeviceId, uploadDeviceToken, receiveDeviceId, receiveDeviceToken };
}

async function uploadTestImage(app: Awaited<ReturnType<typeof buildApp>>, deviceToken: string) {
  const { buffer, sha256 } = await createTestImage();
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

  const body = JSON.parse(res.payload);
  return { res, body, sha256 };
}

describe("POST /api/v1/images", () => {
  it("uploads an image and creates a delivery for authorized receiver", async () => {
    const { app, uploadDeviceToken, receiveDeviceToken } = await setupUploaderAndReceiver();
    const { buffer, sha256 } = await createTestImage();

    const body = buildMultipartBody(
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
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/images",
      headers: {
        authorization: `Bearer ${uploadDeviceToken}`,
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const result = JSON.parse(res.payload);
    expect(result.success).toBe(true);
    expect(result.data.deduplicated).toBe(false);
    expect(result.data.createdDeliveriesCount).toBe(1);

    const pending = await app.inject({
      method: "GET",
      url: "/api/v1/deliveries/pending",
      headers: { authorization: `Bearer ${receiveDeviceToken}` },
    });

    const pendingBody = JSON.parse(pending.payload);
    expect(pendingBody.data.deliveries).toHaveLength(1);
    expect(pendingBody.data.deliveries[0].image.sha256).toBe(sha256);
    expect(pendingBody.data.deliveries[0].source.uploadDeviceName).toBe("Uploader");
  });

  it("rejects upload without device token", async () => {
    const app = await buildApp();
    const { buffer, sha256 } = await createTestImage();

    const body = buildMultipartBody(
      [{ name: "sha256", value: sha256 }],
      {
        fieldName: "file",
        filename: "test.png",
        contentType: "image/png",
        buffer,
      },
      BOUNDARY
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/images",
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects upload when device lacks auto upload permission", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const userToken = await login(app, loginName, "password");
    const bindCode = await createBindCode(app, userToken);
    const { deviceToken } = await registerDevice(app, bindCode);
    const { buffer, sha256 } = await createTestImage();

    const body = buildMultipartBody(
      [{ name: "sha256", value: sha256 }],
      {
        fieldName: "file",
        filename: "test.png",
        contentType: "image/png",
        buffer,
      },
      BOUNDARY
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/images",
      headers: {
        authorization: `Bearer ${deviceToken}`,
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(403);
  });

  it("deduplicates identical sha256 from same device", async () => {
    const { app, uploadDeviceToken } = await setupUploaderAndReceiver();
    const { buffer, sha256 } = await createTestImage();

    const body = buildMultipartBody(
      [{ name: "sha256", value: sha256 }],
      {
        fieldName: "file",
        filename: "test.png",
        contentType: "image/png",
        buffer,
      },
      BOUNDARY
    );

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/images",
      headers: {
        authorization: `Bearer ${uploadDeviceToken}`,
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: body,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/images",
      headers: {
        authorization: `Bearer ${uploadDeviceToken}`,
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: body,
    });
    expect(second.statusCode).toBe(200);
    const result = JSON.parse(second.payload);
    expect(result.data.deduplicated).toBe(true);
  });

  it("creates delivery for selected_devices only when receive source rule exists", async () => {
    const { app, userToken, uploadDeviceId, uploadDeviceToken, receiveDeviceId, receiveDeviceToken } =
      await setupUploaderAndReceiver();
    await updateDevicePermissions(app, userToken, receiveDeviceId, {
      autoReceiveScope: "selected_devices",
    });

    const first = await uploadTestImage(app, uploadDeviceToken);
    expect(first.res.statusCode).toBe(201);
    expect(first.body.data.createdDeliveriesCount).toBe(0);

    const ruleRes = await app.inject({
      method: "PUT",
      url: `/api/v1/devices/${receiveDeviceId}/receive-sources/${uploadDeviceId}`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { enabled: true },
    });
    expect(ruleRes.statusCode).toBe(200);

    const { buffer, sha256 } = await createTestImage({ color: "#00ff00" });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/images",
      headers: {
        authorization: `Bearer ${uploadDeviceToken}`,
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: buildMultipartBody(
        [
          { name: "sha256", value: sha256 },
          { name: "sourceKind", value: "screenshot" },
        ],
        {
          fieldName: "file",
          filename: "test-green.png",
          contentType: "image/png",
          buffer,
        },
        BOUNDARY
      ),
    });
    expect(second.statusCode).toBe(201);
    const secondBody = JSON.parse(second.payload);
    expect(secondBody.data.createdDeliveriesCount).toBe(1);

    const pending = await app.inject({
      method: "GET",
      url: "/api/v1/deliveries/pending",
      headers: { authorization: `Bearer ${receiveDeviceToken}` },
    });
    const pendingBody = JSON.parse(pending.payload);
    expect(pendingBody.data.deliveries).toHaveLength(1);
    expect(pendingBody.data.deliveries[0].image.sha256).toBe(sha256);
  });
});

describe("GET /api/v1/images/:imageId/download", () => {
  it("allows target device to download image", async () => {
    const { app, uploadDeviceToken, receiveDeviceToken } = await setupUploaderAndReceiver();
    const { buffer, sha256 } = await createTestImage();

    const uploadRes = await app.inject({
      method: "POST",
      url: "/api/v1/images",
      headers: {
        authorization: `Bearer ${uploadDeviceToken}`,
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: buildMultipartBody(
        [{ name: "sha256", value: sha256 }],
        {
          fieldName: "file",
          filename: "test.png",
          contentType: "image/png",
          buffer,
        },
        BOUNDARY
      ),
    });

    const { imageId } = JSON.parse(uploadRes.payload).data;

    const downloadRes = await app.inject({
      method: "GET",
      url: `/api/v1/images/${imageId}/download`,
      headers: { authorization: `Bearer ${receiveDeviceToken}` },
    });

    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.headers["content-type"]).toBe("image/png");
    expect(downloadRes.payload).toBeDefined();
  });

  it("forbids manual download across owner spaces", async () => {
    const { app, uploadDeviceToken } = await setupUploaderAndReceiver();
    const upload = await uploadTestImage(app, uploadDeviceToken);
    expect(upload.res.statusCode).toBe(201);

    const otherLogin = `owner-${randomUUID()}`;
    await createOwner(otherLogin, "password");
    const otherUserToken = await login(app, otherLogin, "password");
    const otherBindCode = await createBindCode(app, otherUserToken);
    const { deviceId: otherDeviceId, deviceToken: otherDeviceToken } = await registerDevice(
      app,
      otherBindCode,
      { deviceName: "Other Device", platform: "linux" }
    );
    await updateDevicePermissions(app, otherUserToken, otherDeviceId, { canManualDownload: true });

    const downloadRes = await app.inject({
      method: "GET",
      url: `/api/v1/images/${upload.body.data.imageId}/download`,
      headers: { authorization: `Bearer ${otherDeviceToken}` },
    });

    expect(downloadRes.statusCode).toBe(404);
  });

  it("allows owner user token to download any image in the space", async () => {
    const { app, userToken, uploadDeviceToken } = await setupUploaderAndReceiver();
    const upload = await uploadTestImage(app, uploadDeviceToken);
    expect(upload.res.statusCode).toBe(201);

    const downloadRes = await app.inject({
      method: "GET",
      url: `/api/v1/images/${upload.body.data.imageId}/download`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(downloadRes.statusCode).toBe(200);
  });
});

describe("GET /api/v1/images (admin list)", () => {
  it("lists uploaded images for owner user token", async () => {
    const { app, userToken, uploadDeviceToken } = await setupUploaderAndReceiver();
    const upload = await uploadTestImage(app, uploadDeviceToken);
    expect(upload.res.statusCode).toBe(201);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/images",
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.images).toHaveLength(1);
    expect(body.data.images[0].id).toBe(upload.body.data.imageId);
    expect(body.data.images[0].uploadedBy.deviceName).toBe("Uploader");
    expect(body.data.images[0].uploadedBy.userDisplayName).toBe("Owner");
    expect(body.data.images[0].isExpired).toBe(false);
  });

  it("forbids a non-admin device token from listing images", async () => {
    const { app, uploadDeviceToken } = await setupUploaderAndReceiver();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/images",
      headers: { authorization: `Bearer ${uploadDeviceToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("forbids unauthenticated requests", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/images",
    });
    expect(res.statusCode).toBe(401);
  });

  it("filters expired images when filter=expired", async () => {
    const { app, userToken, uploadDeviceToken } = await setupUploaderAndReceiver();
    const upload = await uploadTestImage(app, uploadDeviceToken);
    expect(upload.res.statusCode).toBe(201);

    // Force the image to be expired.
    await prisma.image.update({
      where: { id: upload.body.data.imageId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/images?filter=expired",
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.images).toHaveLength(1);
    expect(body.data.images[0].isExpired).toBe(true);
  });

  it("paginates using the before cursor", async () => {
    const { app, userToken, uploadDeviceToken } = await setupUploaderAndReceiver();
    // Upload 3 distinct images.
    for (let i = 0; i < 3; i += 1) {
      const { buffer, sha256 } = await createTestImage({ color: `#${(i * 80).toString(16).padStart(2, "0")}00ff` });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/images",
        headers: {
          authorization: `Bearer ${uploadDeviceToken}`,
          "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        },
        payload: buildMultipartBody(
          [
            { name: "sha256", value: sha256 },
            { name: "sourceKind", value: "screenshot" },
          ],
          { fieldName: "file", filename: `t-${i}.png`, contentType: "image/png", buffer },
          BOUNDARY
        ),
      });
      expect(res.statusCode).toBe(201);
    }

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/images?limit=2",
      headers: { authorization: `Bearer ${userToken}` },
    });
    const firstBody = JSON.parse(first.payload);
    expect(firstBody.data.images).toHaveLength(2);
    expect(firstBody.data.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/images?limit=2&before=${encodeURIComponent(firstBody.data.nextCursor)}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    const secondBody = JSON.parse(second.payload);
    expect(secondBody.data.images).toHaveLength(1);
    expect(secondBody.data.nextCursor).toBeNull();

    // No overlap between pages.
    const ids = new Set([
      ...firstBody.data.images.map((img) => img.id),
      ...secondBody.data.images.map((img) => img.id),
    ]);
    expect(ids.size).toBe(3);
  });

  it("excludes soft-deleted images from the default filter=all list", async () => {
    const { app, userToken, uploadDeviceToken } = await setupUploaderAndReceiver();
    const a = await uploadTestImage(app, uploadDeviceToken);
    expect(a.res.statusCode).toBe(201);

    const b = await uploadTestImage(app, uploadDeviceToken);
    expect(b.res.statusCode).toBe(201);

    // Soft-delete a.
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/images/${a.body.data.imageId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(del.statusCode).toBe(200);

    // filter=all should now return only the surviving image.
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/images",
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.payload);
    expect(body.data.images).toHaveLength(1);
    expect(body.data.images[0].id).toBe(b.body.data.imageId);
  });

  it("excludes soft-deleted images from filter=expired", async () => {
    const { app, userToken, uploadDeviceToken } = await setupUploaderAndReceiver();
    const a = await uploadTestImage(app, uploadDeviceToken);
    expect(a.res.statusCode).toBe(201);

    await app.inject({
      method: "DELETE",
      url: `/api/v1/images/${a.body.data.imageId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/images?filter=expired",
      headers: { authorization: `Bearer ${userToken}` },
    });
    const body = JSON.parse(list.payload);
    expect(body.data.images).toHaveLength(0);
  });
});

describe("DELETE /api/v1/images/:imageId", () => {
  it("lets owner user delete an image and cascade-expires pending deliveries", async () => {
    const { app, userToken, uploadDeviceToken, receiveDeviceId } = await setupUploaderAndReceiver();
    const upload = await uploadTestImage(app, uploadDeviceToken);
    expect(upload.res.statusCode).toBe(201);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/images/${upload.body.data.imageId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(deleteRes.statusCode).toBe(200);
    const body = JSON.parse(deleteRes.payload);
    expect(body.success).toBe(true);
    expect(body.data.imageId).toBe(upload.body.data.imageId);

    const stored = await prisma.image.findUnique({ where: { id: upload.body.data.imageId } });
    expect(stored?.deletedAt).not.toBeNull();

    const deliveries = await prisma.delivery.findMany({
      where: { imageId: upload.body.data.imageId, targetDeviceId: receiveDeviceId },
    });
    for (const delivery of deliveries) {
      expect(delivery.status).toBe("expired");
    }
  });

  it("forbids a non-admin device from deleting images", async () => {
    const { app, uploadDeviceToken } = await setupUploaderAndReceiver();
    const upload = await uploadTestImage(app, uploadDeviceToken);
    expect(upload.res.statusCode).toBe(201);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/images/${upload.body.data.imageId}`,
      headers: { authorization: `Bearer ${uploadDeviceToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when the image belongs to another owner space", async () => {
    const { app, userToken, uploadDeviceToken } = await setupUploaderAndReceiver();
    const upload = await uploadTestImage(app, uploadDeviceToken);
    expect(upload.res.statusCode).toBe(201);

    const otherLogin = `owner-${randomUUID()}`;
    await createOwner(otherLogin, "password");
    const otherToken = await login(app, otherLogin, "password");

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/images/${upload.body.data.imageId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for a missing image id", async () => {
    const app = await buildApp();
    const loginName = `owner-${randomUUID()}`;
    await createOwner(loginName, "password");
    const token = await login(app, loginName, "password");
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/images/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
