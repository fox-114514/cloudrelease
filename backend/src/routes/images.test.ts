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
});
