import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { startWebServer } from "../dist/web/server.js";

// The web server reads/writes the user config dir. Point XDG_CONFIG_HOME at
// a per-test tmpdir so we never touch the developer's real config.
async function withTmpConfig(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ssr-web-auth-"));
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmp;
  try {
    return await fn(tmp);
  } finally {
    process.env.XDG_CONFIG_HOME = prev;
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

function parseSetCookie(header) {
  if (!header) return null;
  const parts = Array.isArray(header) ? header : [header];
  for (const h of parts) {
    const seg = h.split(";")[0];
    const idx = seg.indexOf("=");
    if (idx > 0 && seg.slice(0, idx).trim() === "ssr_session") {
      return decodeURIComponent(seg.slice(idx + 1).trim());
    }
  }
  return null;
}

async function call(method, url, { headers, body } = {}) {
  const opts = { method, headers: { ...(headers || {}) } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, headers: res.headers, data };
}

test("unauthenticated /api/* returns 401", async () => {
  await withTmpConfig(async () => {
    const server = await startWebServer(0);
    try {
      const res = await call("GET", `${server.url}/api/config`);
      assert.equal(res.status, 401);
      assert.equal(res.data.success, false);
    } finally {
      await server.close();
    }
  });
});

test("boot token mints a session cookie and is single-use; /api/config after boot is sanitized", async () => {
  await withTmpConfig(async () => {
    const server = await startWebServer(0);
    try {
      // 1. Boot with the wrong token -> forbidden.
      const bad = await call("GET", `${server.url}/api/auth/boot?token=deadbeef`, {
        headers: { redirect: "manual" },
      });
      assert.equal(bad.status, 403);

      // 2. Boot with the right token -> 303 with Set-Cookie.
      const bootRes = await fetch(`${server.bootUrl}`, { redirect: "manual" });
      assert.equal(bootRes.status, 303);
      const cookie = parseSetCookie(bootRes.headers.get("set-cookie"));
      assert.ok(cookie, "boot should set ssr_session cookie");

      // 3. Boot token is single use: replaying it now fails.
      const replay = await fetch(`${server.bootUrl}`, { redirect: "manual" });
      assert.equal(replay.status, 403);

      // 4. Authenticated /api/config works and never exposes deviceToken.
      const cfg = await call("GET", `${server.url}/api/config`, {
        headers: { Cookie: `ssr_session=${cookie}` },
      });
      assert.equal(cfg.status, 200);
      assert.equal(cfg.data.device, undefined, "no device bound in fresh config");
      const text = JSON.stringify(cfg.data);
      assert.equal(text.includes("deviceToken"), false, "DTO must not contain deviceToken");
    } finally {
      await server.close();
    }
  });
});

test("state-changing requests without/with wrong Origin are rejected; correct Origin works", async () => {
  await withTmpConfig(async () => {
    const server = await startWebServer(0);
    try {
      const bootRes = await fetch(server.bootUrl, { redirect: "manual" });
      const cookie = parseSetCookie(bootRes.headers.get("set-cookie"));
      assert.ok(cookie);

      // No Origin -> blocked by CSRF guard.
      const noOrigin = await call("POST", `${server.url}/api/unbind`, {
        headers: { Cookie: `ssr_session=${cookie}` },
      });
      assert.equal(noOrigin.status, 403);

      // Wrong Origin -> blocked.
      const wrongOrigin = await call("POST", `${server.url}/api/unbind`, {
        headers: { Cookie: `ssr_session=${cookie}`, Origin: "http://evil.example" },
      });
      assert.equal(wrongOrigin.status, 403);

      // Correct Origin -> accepted (204-ish success payload).
      const ok = await call("POST", `${server.url}/api/unbind`, {
        headers: { Cookie: `ssr_session=${cookie}`, Origin: server.url },
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.data.success, true);
    } finally {
      await server.close();
    }
  });
});

test("forged session cookie is rejected", async () => {
  await withTmpConfig(async () => {
    const server = await startWebServer(0);
    try {
      const res = await call("GET", `${server.url}/api/config`, {
        headers: { Cookie: `ssr_session=${"a".repeat(64)}` },
      });
      assert.equal(res.status, 401);
    } finally {
      await server.close();
    }
  });
});

test("bootUrl only carries the boot token, not the session cookie token", async () => {
  await withTmpConfig(async () => {
    const server = await startWebServer(0);
    try {
      // bootUrl format: http://127.0.0.1:<port>/api/auth/boot?token=<token>
      const u = new URL(server.bootUrl);
      assert.equal(u.pathname, "/api/auth/boot");
      assert.ok(u.searchParams.get("token"));
      // token must not equal the eventual session cookie
      const bootRes = await fetch(server.bootUrl, { redirect: "manual" });
      const cookie = parseSetCookie(bootRes.headers.get("set-cookie"));
      assert.ok(cookie);
      assert.notEqual(cookie, u.searchParams.get("token"));
    } finally {
      await server.close();
    }
  });
});
