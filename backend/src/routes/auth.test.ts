import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { buildApp } from "../app.js";
import { createOwner } from "../test/helpers.js";

describe("POST /api/v1/auth/login", () => {
  it("returns a token for valid owner credentials", async () => {
    const app = await buildApp();
    const login = `owner-${randomUUID()}`;
    await createOwner(login, "correct-password");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { login, password: "correct-password" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();
    expect(body.data.user.role).toBe("owner");
  });

  it("returns 401 for invalid password", async () => {
    const app = await buildApp();
    const login = `owner-${randomUUID()}`;
    await createOwner(login, "correct-password");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { login, password: "wrong-password" },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });
});
