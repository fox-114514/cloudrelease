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

  it("returns 401 with same error code when user does not exist (no leak)", async () => {
    const app = await buildApp();
    // No user created — exercises the dummy-bcrypt branch.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { login: `no-such-user-${randomUUID()}`, password: "anything" },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("applies a 5/minute per-IP limiter on /auth/login", async () => {
    // A fresh app for isolation; we hit the endpoint twice with a real
    // owner so it's not all routed to the dummy-bcrypt path.
    const app = await buildApp();
    const login = `owner-${randomUUID()}`;
    await createOwner(login, "correct-password");

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        // Flip between wrong and correct, the limiter doesn't care about
        // success/failure — only request count.
        payload: {
          login,
          password: i === 0 ? "correct-password" : "wrong-password",
        },
      });
      statuses.push(res.statusCode);
    }

    // First 5 within the window must be processed (200 or 401); the 6th
    // must be rejected by the per-route limiter with 429.
    expect(statuses.slice(0, 5)).toEqual([200, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
    await app.close();
  });
});
