import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
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

test("/api/config never exposes the deviceToken when a device is bound (R0-2 sanitization)", async () => {
  await withTmpConfig(async (tmp) => {
    // Plant a bound device config so the Web server treats itself as
    // already configured. The server will try to refresh permissions
    // against a bogus token and silently fail (caught in /api/config),
    // which is exactly what we want for the sanitization assertion.
    const configDir = path.join(tmp, "studyshot-relay");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "config.json"),
      JSON.stringify({
        autoUpload: false,
        autoReceive: false,
        copyToClipboard: true,
        uploadedHashes: [],
        receivedHashes: [],
        allowInsecureHttp: false,
        device: {
          serverBaseUrl: "https://example.test",
          deviceId: "device-test",
          deviceToken: "SECRET-SHOULD-NOT-LEAK-12345",
          deviceName: "Test Device",
          user: { id: "user-test", ownerUserId: "user-test", role: "owner" },
          profile: "receive_own",
          permissions: {
            canAutoUpload: false,
            canManualUpload: true,
            canAutoReceive: true,
            canManualDownload: true,
            canManageSpace: true,
            canCreateInvite: true,
            autoUploadScope: "none",
            autoReceiveScope: "same_user_only",
          },
        },
      }),
      { mode: 0o600 },
    );

    const server = await startWebServer(0);
    try {
      const bootRes = await fetch(server.bootUrl, { redirect: "manual" });
      const cookie = parseSetCookie(bootRes.headers.get("set-cookie"));
      assert.ok(cookie);
      const cfg = await call("GET", `${server.url}/api/config`, {
        headers: { Cookie: `ssr_session=${cookie}` },
      });
      assert.equal(cfg.status, 200);
      assert.ok(cfg.data.device, "device should be present in the response");
      const text = JSON.stringify(cfg.data);
      assert.equal(
        text.includes("deviceToken"),
        false,
        "DTO must strip the deviceToken even when a device is bound",
      );
      assert.equal(
        text.includes("SECRET-SHOULD-NOT-LEAK-12345"),
        false,
        "actual token value must not appear in the response",
      );
    } finally {
      await server.close();
    }
  });
});

test("server.close() releases idle keep-alive sockets within the timeout (R0-5)", async () => {
  await withTmpConfig(async () => {
    const server = await startWebServer(0);
    // Open a raw keep-alive connection that we deliberately leave
    // dangling. The request goes out; the response is ignored; the socket
    // sits idle in the keep-alive pool. With forceCloseConnections: "idle"
    // server.close() must tear it down promptly.
    const agent = new http.Agent({ keepAlive: true });
    const u = new URL(server.url);
    http
      .request(
        { method: "GET", host: u.hostname, port: u.port, path: "/api/config", agent },
        (res) => {
          res.on("close", () => undefined);
        },
      )
      .on("error", () => undefined)
      .end();
    // Give the request time to actually arrive so the server side has an
    // idle keep-alive socket to close, not a half-open one.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const start = Date.now();
    const closeP = server.close();
    const winner = await Promise.race([
      closeP.then(() => "closed"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 5000)),
    ]);
    const elapsed = Date.now() - start;
    agent.destroy();
    assert.equal(
      winner,
      "closed",
      `server.close() did not return within 5s while an idle keep-alive socket was open (took ${elapsed}ms)`,
    );
  });
});

test("server.close() terminates an active authenticated SSE stream", async () => {
  await withTmpConfig(async () => {
    const server = await startWebServer(0);
    const bootRes = await fetch(server.bootUrl, { redirect: "manual" });
    const cookie = parseSetCookie(bootRes.headers.get("set-cookie"));
    assert.ok(cookie);

    const u = new URL(server.url);
    const stream = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: "GET",
          host: u.hostname,
          port: u.port,
          path: "/api/logs",
          headers: { Cookie: `ssr_session=${cookie}` },
        },
        (res) => {
          res.once("data", () => resolve({ req, res }));
        },
      );
      req.once("error", reject);
      req.end();
    });

    const winner = await Promise.race([
      server.close().then(() => "closed"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 2000)),
    ]);
    stream.req.destroy();
    stream.res.destroy();
    assert.equal(winner, "closed");
  });
});

test("admin proxy blocks stored remote HTTP before forwarding credentials", async () => {
  await withTmpConfig(async (tmp) => {
    const configDir = path.join(tmp, "studyshot-relay");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, "config.json"), JSON.stringify({
      autoUpload: false,
      autoReceive: false,
      copyToClipboard: false,
      uploadedHashes: [],
      receivedHashes: [],
      allowInsecureHttp: false,
      device: {
        serverBaseUrl: "http://192.0.2.1:3000",
        deviceId: "device-test",
        deviceToken: "secret-token",
        deviceName: "Test Device",
      },
    }));

    const server = await startWebServer(0);
    try {
      const bootRes = await fetch(server.bootUrl, { redirect: "manual" });
      const cookie = parseSetCookie(bootRes.headers.get("set-cookie"));
      assert.ok(cookie);
      const headers = { Cookie: `ssr_session=${cookie}`, Origin: server.url };

      const login = await call("POST", `${server.url}/api/proxy/auth/login`, {
        headers,
        body: { login: "owner", password: "must-not-leak" },
      });
      assert.equal(login.status, 403);

      const remove = await call("DELETE", `${server.url}/api/proxy/images/image-1`, {
        headers: { ...headers, Authorization: "Bearer admin-must-not-leak" },
      });
      assert.equal(remove.status, 403);
    } finally {
      await server.close();
    }
  });
});
